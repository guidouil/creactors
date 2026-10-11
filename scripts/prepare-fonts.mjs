/**
 * Rebuild the vendored Barlow assets. This script never fetches resources.
 * The checked-in TTF is the source of truth for both SDF text and geometry.
 *
 * OpenType paths use font units with Y pointing up. Three's typeface format
 * also uses Y-up, but puts the end point before the control points in q/b.
 * A Z is converted to an explicit closing line because FontLoader supports
 * only m/l/q/b. Coordinates are rounded only after converting to 1000 units.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import opentype from 'opentype.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(root, 'assets/fonts/BarlowCondensed-Black.ttf');
const outDirectory = path.join(root, 'assets/generated');
const bytes = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(bytes).digest('hex');
const pinnedHash = 'e74b750df582c608f35db467b711b2b60d2217618e85e60b72b42dfd00446cab';
if (sourceHash !== pinnedHash) throw new Error('The vendored font changed. Review the source and update its pinned SHA-256 before rebuilding.');
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const resolution = 1000;
const scale = resolution / font.unitsPerEm;
const number = (value) => Math.round(value * scale * 1000) / 1000;

function outline(commands) {
  const result = [];
  let start;
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        start = [command.x, command.y];
        result.push('m', number(command.x), number(command.y));
        break;
      case 'L':
        result.push('l', number(command.x), number(command.y));
        break;
      case 'Q':
        result.push('q', number(command.x), number(command.y), number(command.x1), number(command.y1));
        break;
      case 'C':
        result.push('b', number(command.x), number(command.y), number(command.x1), number(command.y1), number(command.x2), number(command.y2));
        break;
      case 'Z':
        if (start) result.push('l', number(start[0]), number(start[1]));
        break;
      default:
        throw new Error(`Unsupported OpenType command: ${command.type}`);
    }
  }
  return result.join(' ');
}

const glyphs = {};
const supported = [];
const entries = Object.entries(font.tables.cmap.glyphIndexMap)
  .map(([point, glyphIndex]) => [Number(point), glyphIndex])
  .sort(([a], [b]) => a - b);

for (const [codepoint, glyphIndex] of entries) {
  // Glyph zero is .notdef, not supported text. Surrogates are not scalars.
  if (glyphIndex === 0 || (codepoint >= 0xd800 && codepoint <= 0xdfff)) continue;
  const glyph = font.glyphs.get(glyphIndex);
  const bounds = glyph.getBoundingBox();
  glyphs[String.fromCodePoint(codepoint)] = {
    ha: number(glyph.advanceWidth ?? 0),
    x_min: number(bounds.x1),
    x_max: number(bounds.x2),
    o: outline(glyph.path.commands),
  };
  supported.push(codepoint);
}

const source = {
  file: 'BarlowCondensed-Black.ttf',
  url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/BarlowCondensed-Black.ttf',
  sha256: sourceHash,
  bytes: bytes.byteLength,
  license: 'SIL Open Font License 1.1',
};

// Export codepoint pairs (not OpenType glyph-index pairs). getKerningValue
// also reads GPOS pair positioning, which many modern fonts use instead of
// the legacy kern table. Cache each glyph pair because cmap aliases share it.
// This bounded build-time scan is never shipped or run in the browser.
const kernByGlyphPair = new Map();
const kerningPairs = {};
const coveredEntries = entries.filter(([point]) => glyphs[String.fromCodePoint(point)]);
for (const [leftPoint, leftIndex] of coveredEntries) {
  for (const [rightPoint, rightIndex] of coveredEntries) {
    const glyphKey = `${leftIndex},${rightIndex}`;
    let kern = kernByGlyphPair.get(glyphKey);
    if (kern === undefined) {
      kern = font.getKerningValue(font.glyphs.get(leftIndex), font.glyphs.get(rightIndex));
      kernByGlyphPair.set(glyphKey, kern);
    }
    if (kern !== 0) kerningPairs[`${leftPoint},${rightPoint}`] = kern;
  }
}

const typeface = {
  glyphs,
  familyName: 'Barlow Condensed',
  ascender: number(font.ascender),
  descender: number(font.descender),
  underlinePosition: number(font.tables.post.underlinePosition),
  underlineThickness: number(font.tables.post.underlineThickness),
  boundingBox: {
    xMin: number(font.tables.head.xMin), xMax: number(font.tables.head.xMax),
    yMin: number(font.tables.head.yMin), yMax: number(font.tables.head.yMax),
  },
  resolution,
  original_font_information: font.names,
  cssFontWeight: '900',
  cssFontStyle: 'normal',
  source,
};

const coverage = {
  version: 1,
  font: 'Barlow Condensed Black',
  fontVersion: (font.names.windows?.version ?? font.names.macintosh?.version ?? font.names.version)?.en,
  source,
  unitsPerEm: font.unitsPerEm,
  outlineResolution: resolution,
  ascender: font.ascender,
  descender: font.descender,
  lineGap: font.tables.hhea.lineGap,
  capHeight: font.tables.os2.sCapHeight,
  supportedCodepoints: supported,
  kerningUnits: 'font units',
  kerningPairs,
};

// A broken asset must fail the build instead of being rendered as .notdef.
const required = "Le futur n'est pas ce qui nous attend. C'est ce que nous créons. ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸàâäçéèêëîïôöùûüÿŒœ’“”«»?!";
const missing = [...new Set([...required])].filter((character) => !glyphs[character]);
if (missing.length) throw new Error(`Required glyphs are missing: ${missing.join(' ')}`);

await mkdir(outDirectory, { recursive: true });
await writeFile(path.join(outDirectory, 'barlow-condensed-black.typeface.json'), `${JSON.stringify(typeface)}\n`);
await writeFile(path.join(outDirectory, 'barlow-condensed-black.coverage.json'), `${JSON.stringify(coverage)}\n`);
console.log(`Prepared ${supported.length} Unicode glyphs from ${source.bytes} bytes; SHA-256 ${source.sha256}.`);
