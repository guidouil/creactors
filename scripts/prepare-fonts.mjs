/**
 * Rebuild the vendored display-font assets. This script never fetches resources.
 * Each checked-in static TTF is the source of truth for both SDF text and geometry.
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
const specifications = [
  {
    id: 'bungee-regular', file: 'CREACTORSBlock-Regular.ttf',
    familyName: 'CREACTORS Block', displayName: 'CREACTORS Block', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bungee/Bungee-Regular.ttf',
    sha256: 'e183e9f34abd21ef73f152003e96814d34063aa20bce26299d1c355dfcb32d3e',
    derivedFrom: {
      file: 'Bungee-Regular.ttf',
      sha256: 'c4f5361ce120af3e6b9156d0bf379fa19cda2ea0cd18ac01fd99596c6bf66e3f',
      transform: 'Retained horizontal GPOS kern/mark/mkmk; removed ss11/ss12/vkrn positioning; renamed family, full, unique and PostScript names to CREACTORS Block.',
      tool: 'FontTools 4.60.2 scripts/prepare-block-font.py (recalcTimestamp=False)',
    },
  },
  {
    id: 'black-ops-one-regular', file: 'BlackOpsOne-Regular.ttf',
    familyName: 'Black Ops One', displayName: 'Black Ops One Regular', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/blackopsone/BlackOpsOne-Regular.ttf',
    sha256: '282a825b5f294377387e3969f765408157dbea8da0f5d0aae68c6bc704b145b3',
  },
  {
    id: 'alfa-slab-one-regular', file: 'AlfaSlabOne-Regular.ttf',
    familyName: 'CREACTORS Slab Outlines', displayName: 'Alfa Slab One Regular', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf',
    sha256: '28664afa698a3393bd5a29eec750230a0645c5301d62200e5f2d3a027fb2299d',
  },
  {
    id: 'press-start-2p-regular', file: 'CREACTORSArcade-Regular.ttf',
    familyName: 'CREACTORS Arcade', displayName: 'CREACTORS Arcade', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf',
    sha256: '672d7b0e816eb41638b7195921237d523694814b406eea29745238ba937bfbea',
    derivedFrom: {
      file: 'PressStart2P-Regular.ttf',
      sha256: '034c77f1f05ec89421e4a63f0e3a4ca1ecf852cc6d2bf611f126f275728e017d',
      transform: 'Removed GSUB; renamed family, full, unique and PostScript names to CREACTORS Arcade.',
      tool: 'FontTools 4.60.2 scripts/prepare-pixel-font.py (recalcTimestamp=False)',
    },
  },
  {
    id: 'barlow-condensed-black', file: 'BarlowCondensed-Black.ttf',
    familyName: 'Barlow Condensed', displayName: 'Barlow Condensed Black', weight: '900',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/barlowcondensed/BarlowCondensed-Black.ttf',
    sha256: 'e74b750df582c608f35db467b711b2b60d2217618e85e60b72b42dfd00446cab',
  },
  {
    id: 'anton-regular', file: 'Anton-Regular.ttf',
    familyName: 'Anton', displayName: 'Anton Regular', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf',
    sha256: 'a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab',
  },
  {
    id: 'bebas-neue-regular', file: 'BebasNeue-Regular.ttf',
    familyName: 'Bebas Neue', displayName: 'Bebas Neue Regular', weight: '400',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf',
    sha256: '08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73',
  },
  {
    id: 'montserrat-bold', file: 'Montserrat-Bold.ttf',
    familyName: 'Montserrat', displayName: 'Montserrat Bold', weight: '700',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf',
    sha256: 'b1a7b57ab2f53d9c44dd6a304c1af7f485b7c046c0836d4ddf282fd2447e702b',
    derivedFrom: {
      file: 'Montserrat-Variable.ttf',
      sha256: '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7',
      instance: { wght: 700 },
      tool: 'FontTools 4.60.2 varLib.instancer --static --update-name-table --no-recalc-timestamp',
    },
  },
];

// Verify original sources as well as their derived runtime fonts.
for (const specification of specifications) {
  if (specification.derivedFrom) {
    const source = specification.derivedFrom;
    const bytes = await readFile(path.join(root, 'assets/fonts', source.file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== source.sha256) throw new Error(`${source.file} changed. Review its provenance before rebuilding.`);
  }
}

for (const specification of specifications) await prepareFont(specification);

async function prepareFont(specification) {
  const sourcePath = path.join(root, 'assets/fonts', specification.file);
  const outDirectory = path.join(root, 'assets/generated');
  const bytes = await readFile(sourcePath);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const pinnedHash = specification.sha256;
  if (sourceHash !== pinnedHash) throw new Error(`${specification.file} changed. Review the source and update its pinned SHA-256 before rebuilding.`);
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
    file: specification.file,
    url: specification.url,
    sha256: sourceHash,
    bytes: bytes.byteLength,
    license: 'SIL Open Font License 1.1',
    ...(specification.derivedFrom ? { derivedFrom: specification.derivedFrom } : {}),
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
    familyName: specification.familyName,
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
    cssFontWeight: specification.weight,
    cssFontStyle: 'normal',
    source,
  };

  const coverage = {
    version: 1,
    font: specification.displayName,
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
  if (missing.length) throw new Error(`${specification.file}: required glyphs are missing: ${missing.join(' ')}`);

  await mkdir(outDirectory, { recursive: true });
  await writeFile(path.join(outDirectory, `${specification.id}.typeface.json`), `${JSON.stringify(typeface)}\n`);
  await writeFile(path.join(outDirectory, `${specification.id}.coverage.json`), `${JSON.stringify(coverage)}\n`);
  console.log(`Prepared ${specification.displayName}: ${supported.length} Unicode glyphs from ${source.bytes} bytes; SHA-256 ${source.sha256}.`);
}
