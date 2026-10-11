#!/usr/bin/env python3
"""Build the block runtime font with horizontal OpenType positioning only.

Run with .font-tools/bin/python scripts/prepare-block-font.py. FontTools 4.60.2
is pinned for reproducible bytes. Troika applies every GPOS lookup, including
Bungee's optional stylistic and vertical positioning; retaining only kern,
mark and mkmk makes SDF text use the source font's horizontal metrics.
"""

from hashlib import sha256
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/fonts/Bungee-Regular.ttf"
DESTINATION = ROOT / "assets/fonts/CREACTORSBlock-Regular.ttf"
SOURCE_SHA256 = "c4f5361ce120af3e6b9156d0bf379fa19cda2ea0cd18ac01fd99596c6bf66e3f"
FONTTOOLS_VERSION = "4.60.2"
HORIZONTAL_FEATURES = {"kern", "mark", "mkmk"}


def retain_horizontal_positioning(font):
    table = font["GPOS"].table
    features = table.FeatureList.FeatureRecord
    kept_features = [(i, feature) for i, feature in enumerate(features)
                     if feature.FeatureTag in HORIZONTAL_FEATURES]
    kept_lookups = sorted({index for _, feature in kept_features
                           for index in feature.Feature.LookupListIndex})
    # This pinned Bungee source uses pair positioning and mark attachment for
    # its standard features, with no contextual references to other lookups.
    if kept_lookups != [3, 4, 5, 6, 7]:
        raise RuntimeError("Bungee GPOS changed; review the retained lookups.")
    for index in kept_lookups:
        if table.LookupList.Lookup[index].LookupType not in {2, 4, 6}:
            raise RuntimeError("A retained GPOS lookup needs reference remapping.")

    lookup_map = {old: new for new, old in enumerate(kept_lookups)}
    table.LookupList.Lookup = [table.LookupList.Lookup[index] for index in kept_lookups]
    table.LookupList.LookupCount = len(kept_lookups)
    for _, feature in kept_features:
        feature.Feature.LookupListIndex = [lookup_map[index] for index in feature.Feature.LookupListIndex]
        feature.Feature.LookupCount = len(feature.Feature.LookupListIndex)

    feature_map = {old: new for new, (old, _) in enumerate(kept_features)}
    table.FeatureList.FeatureRecord = [feature for _, feature in kept_features]
    table.FeatureList.FeatureCount = len(kept_features)
    for record in table.ScriptList.ScriptRecord:
        script = record.Script
        languages = [lang.LangSys for lang in script.LangSysRecord]
        if script.DefaultLangSys is not None:
            languages.append(script.DefaultLangSys)
        for language in languages:
            language.FeatureIndex = [feature_map[index] for index in language.FeatureIndex if index in feature_map]
            language.FeatureCount = len(language.FeatureIndex)
            if language.ReqFeatureIndex != 0xFFFF:
                language.ReqFeatureIndex = feature_map.get(language.ReqFeatureIndex, 0xFFFF)


def main():
    if fontTools.version != FONTTOOLS_VERSION:
        raise RuntimeError(f"Use FontTools {FONTTOOLS_VERSION}, found {fontTools.version}")
    if sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("The block source changed; review its provenance before rebuilding.")

    font = TTFont(SOURCE, recalcTimestamp=False)
    retain_horizontal_positioning(font)
    names = {
        1: "CREACTORS Block", 2: "Regular",
        3: "CREACTORS Block Regular 1.0", 4: "CREACTORS Block",
        6: "CREACTORSBlock-Regular", 16: "CREACTORS Block", 17: "Regular",
    }
    name_table = font["name"]
    for record in list(name_table.names):
        value = names.get(record.nameID)
        if value is not None:
            name_table.setName(value, record.nameID, record.platformID, record.platEncID, record.langID)

    font.save(DESTINATION)
    font.close()
    data = DESTINATION.read_bytes()
    print(f"Prepared {DESTINATION.name}: {len(data)} bytes; SHA-256 {sha256(data).hexdigest()}.")


if __name__ == "__main__":
    main()
