"""Pinned build-only font instancing and real sequence shaping; no runtime NLP/WASM."""
from pathlib import Path
import hashlib
import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
import uharfbuzz as hb

root = Path(__file__).resolve().parent.parent
source = root / 'assets/fonts/NotoEmoji-Variable.ttf'
data = source.read_bytes()
sha = hashlib.sha256(data).hexdigest()
assert sha == 'de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551', 'Review changed font before regenerating.'
font = instantiateVariableFont(TTFont(source), {'wght': 700}, inplace=False)
font.recalcTimestamp = False
static = root / 'assets/fonts/NotoEmoji-Bold.ttf'
font.save(static)
static_data = static.read_bytes()
face = hb.Face(static_data)
shaper = hb.Font(face)
hb.ot_font_set_funcs(shaper)
accepted = []
rejected = []
render_glyphs = {}
private_cmap = {}
glyph_names = font.getGlyphOrder()
emoji_test = root / 'assets/generated/emoji-test.txt'
assert hashlib.sha256(emoji_test.read_bytes()).hexdigest() == '8f3735cda1f92a779d78af67cf86066bb1f07143dc22f2ac29394d9bc57ab21a'
for line in emoji_test.read_text().splitlines():
    if not line or line.startswith('#'): continue
    points, tail = line.split(';', 1)
    status = tail.split('#', 1)[0].strip()
    if status == 'component': continue
    text = ''.join(chr(int(value, 16)) for value in points.split())
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(shaper, buffer)
    # One supported outline means a joined family/modifier/flag is really
    # supported, rather than silently rendered as separate fallback symbols.
    # Variation selectors may produce a zero-advance invisible space glyph.
    # Count visible outlines, while still rejecting every .notdef and any
    # unjoined sequence with multiple visible outlines.
    visible = []
    covered = True
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        if info.codepoint == 0:
            covered = False
            break
        extent = shaper.get_glyph_extents(info.codepoint)
        if extent and extent.width and extent.height:
            visible.append(info.codepoint)
        elif position.x_advance or position.y_advance:
            covered = False
    covered = covered and len(visible) == 1
    (accepted if covered else rejected).append(text)
    if covered:
        # Font fallback for VS16 emoji differs between browser text stacks.
        # Map each verified complete sequence to its actual outline in plane-15
        # private use, ensuring Canvas draws exactly this bundled monochrome face.
        private_point = 0xF0000 + visible[0]
        private_cmap[private_point] = glyph_names[visible[0]]
        render_glyphs[text] = chr(private_point)
table = CmapSubtable.newSubtable(12)
table.platformID = 3
table.platEncID = 10
table.language = 0
table.cmap = {**font.getBestCmap(), **private_cmap}
font['cmap'].tables = [entry for entry in font['cmap'].tables if not (entry.platformID == 3 and entry.platEncID == 10)] + [table]
font.flavor = None
font.save(static)
font.flavor = 'woff2'
woff = root / 'assets/fonts/NotoEmoji-Bold.woff2'
font.save(woff)
manifest = {
    'version': 3, 'unicodeVersion': '18.0', 'weight': 700,
    'fontSha256': sha, 'woffSha256': hashlib.sha256(woff.read_bytes()).hexdigest(),
    'accepted': sorted(set(accepted)), 'uncovered': sorted(set(rejected)),
    'renderGlyphs': render_glyphs,
    'source': 'https://github.com/google/fonts/tree/main/ofl/notoemoji',
}
(root / 'assets/generated/emoji-coverage.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({'accepted': len(manifest['accepted']), 'uncovered': len(manifest['uncovered']), 'woffBytes': woff.stat().st_size}))
