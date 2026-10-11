#!/usr/bin/env python3
"""Build the vendored arcade runtime font from its unchanged OFL source.

Run with .font-tools/bin/python scripts/prepare-pixel-font.py. FontTools 4.60.2
is pinned so the resulting TTF and its SHA-256 remain reproducible. GSUB is
removed because its fi/fl ligatures halve the advance of the pixel font in
SDF text, while geometry uses one outline per Unicode codepoint.
"""

from hashlib import sha256
from pathlib import Path

import fontTools
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/fonts/PressStart2P-Regular.ttf"
DESTINATION = ROOT / "assets/fonts/CREACTORSArcade-Regular.ttf"
SOURCE_SHA256 = "034c77f1f05ec89421e4a63f0e3a4ca1ecf852cc6d2bf611f126f275728e017d"
FONTTOOLS_VERSION = "4.60.2"


def main():
    if fontTools.version != FONTTOOLS_VERSION:
        raise RuntimeError(f"Use FontTools {FONTTOOLS_VERSION}, found {fontTools.version}")
    if sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("The arcade source changed; review its provenance before rebuilding.")

    font = TTFont(SOURCE, recalcTimestamp=False)
    if "GSUB" in font:
        del font["GSUB"]

    # The original font reserves its name. Rename this modified runtime while
    # preserving the source copyright and OFL records (name IDs 0, 13 and 14).
    names = {
        1: "CREACTORS Arcade",
        2: "Regular",
        3: "CREACTORS Arcade Regular 1.0",
        4: "CREACTORS Arcade",
        6: "CREACTORSArcade-Regular",
        16: "CREACTORS Arcade",
        17: "Regular",
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
