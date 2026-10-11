import { parse, type Font, type PathCommand } from 'opentype.js';
import { registerDisplayFont, type DisplayFont } from './fonts';

export const MAX_FONT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_GLYPHS = 12000;
const MAX_PATH_COMMANDS = 1000000;
const OUTLINE_RESOLUTION = 1000;

export type FontImportErrorKind = 'size' | 'format' | 'decode' | 'coverage' | 'unavailable' | 'permission';

export class FontImportError extends Error {
  constructor(readonly kind: FontImportErrorKind) {
    super(`Font import failed: ${kind}`);
    this.name = 'FontImportError';
  }
}

export interface LocalFont {
  readonly postscriptName: string;
  readonly fullName: string;
  readonly family: string;
  readonly style: string;
  blob(): Promise<Blob>;
}

type FontAccessWindow = Window & { queryLocalFonts?: () => Promise<LocalFont[]> };

/** Desktop browsers may expose this API only on HTTPS/localhost, after a click. */
export function localFontsAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && ['https:', 'http:'].includes(window.location.protocol)
    && window.location.origin !== 'null'
    && typeof (window as FontAccessWindow).queryLocalFonts === 'function';
}

/** Invoke directly from the click handler: enumeration requires user activation. */
export async function queryLocalFonts(): Promise<LocalFont[]> {
  if (!localFontsAvailable()) throw new FontImportError('unavailable');
  try {
    const fonts = await (window as FontAccessWindow).queryLocalFonts!.call(window);
    return [...fonts].sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
      throw new FontImportError('permission');
    }
    throw new FontImportError('unavailable');
  }
}

/** Validate the uncompressed SFNT container before the parser reads its tables. */
function inspectContainer(bytes: ArrayBuffer): 'font/ttf' | 'font/otf' {
  if (bytes.byteLength < 12) throw new FontImportError('format');
  const data = new DataView(bytes);
  const signature = data.getUint32(0);
  // Static TTF/OTF only. Collections, compressed webfonts and variable faces
  // need an additional conversion step to keep Troika and extrusion identical.
  if (![0x00010000, 0x74727565, 0x4f54544f].includes(signature)) throw new FontImportError('format');
  const tableCount = data.getUint16(4);
  if (!tableCount || tableCount > 256 || 12 + tableCount * 16 > bytes.byteLength) throw new FontImportError('decode');
  for (let index = 0; index < tableCount; index++) {
    const start = 12 + index * 16;
    const tag = data.getUint32(start);
    const offset = data.getUint32(start + 8);
    const length = data.getUint32(start + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) throw new FontImportError('decode');
    if (tag === 0x66766172) throw new FontImportError('format'); // fvar
  }
  return signature === 0x4f54544f ? 'font/otf' : 'font/ttf';
}

function hashBytes(bytes: ArrayBuffer): string {
  // Two independent 32-bit streams make stable, local IDs without requiring
  // SubtleCrypto, which is absent on ordinary HTTP origins.
  let left = 2166136261;
  let right = 2246822519;
  for (const byte of new Uint8Array(bytes)) {
    left = Math.imul(left ^ byte, 16777619);
    right = Math.imul(right ^ byte, 3266489917);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

function dataUrl(bytes: ArrayBuffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new FontImportError('decode'));
    reader.onerror = () => reject(new FontImportError('decode'));
    reader.onabort = () => reject(new FontImportError('decode'));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
}

function pathOutline(commands: PathCommand[], scale: number): string {
  const values: (string | number)[] = [];
  let start: readonly [number, number] | undefined;
  const coordinate = (value: number | undefined): number => {
    if (value === undefined || !Number.isFinite(value)) throw new FontImportError('decode');
    return Math.round(value * scale * 1000) / 1000;
  };
  for (const command of commands) {
    switch (command.type) {
      case 'M':
        start = [coordinate(command.x), coordinate(command.y)];
        values.push('m', ...start);
        break;
      case 'L': values.push('l', coordinate(command.x), coordinate(command.y)); break;
      case 'Q': values.push('q', coordinate(command.x), coordinate(command.y), coordinate(command.x1), coordinate(command.y1)); break;
      case 'C': values.push('b', coordinate(command.x), coordinate(command.y), coordinate(command.x1), coordinate(command.y1), coordinate(command.x2), coordinate(command.y2)); break;
      case 'Z': if (start) values.push('l', ...start); break;
      default: throw new FontImportError('decode');
    }
  }
  return values.join(' ');
}

function assets(font: Font): Pick<DisplayFont, 'typeface' | 'metadata' | 'kerning'> {
  if (font.glyphs.length > MAX_GLYPHS) throw new FontImportError('size');
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0
    || !Number.isFinite(font.ascender) || !Number.isFinite(font.descender)
    || font.ascender <= font.descender) throw new FontImportError('decode');
  const entries = Object.entries(font.tables.cmap.glyphIndexMap)
    .map(([point, index]) => [Number(point), index] as const)
    .filter(([point, index]) => index !== 0 && point >= 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff));
  if (entries.length > MAX_GLYPHS) throw new FontImportError('size');
  entries.sort(([a], [b]) => a - b);
  const basicText = ' ?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  if ([...basicText].some(character => !font.charToGlyph(character).index)) throw new FontImportError('coverage');
  const scale = OUTLINE_RESOLUTION / font.unitsPerEm;
  const number = (value: number) => Math.round(value * scale * 1000) / 1000;
  const glyphs: DisplayFont['typeface']['glyphs'] = {};
  const supportedCodepoints: number[] = [];
  const converted = new Map<number, DisplayFont['typeface']['glyphs'][string]>();
  let commandCount = 0;
  for (const [point, glyphIndex] of entries) {
    let convertedGlyph = converted.get(glyphIndex);
    if (!convertedGlyph) {
      const glyph = font.glyphs.get(glyphIndex);
      const commands = glyph.path.commands;
      commandCount += commands.length;
      if (commandCount > MAX_PATH_COMMANDS) throw new FontImportError('size');
      const bounds = glyph.getBoundingBox();
      const advance = glyph.advanceWidth ?? 0;
      if (![advance, bounds.x1, bounds.x2, bounds.y1, bounds.y2].every(Number.isFinite)) throw new FontImportError('decode');
      convertedGlyph = { ha: number(advance), x_min: number(bounds.x1), x_max: number(bounds.x2), o: pathOutline(commands, scale) };
      converted.set(glyphIndex, convertedGlyph);
    }
    glyphs[String.fromCodePoint(point)] = convertedGlyph;
    supportedCodepoints.push(point);
  }
  const family = font.getEnglishName('fontFamily') || 'Imported font';
  const capHeight = font.tables.os2?.sCapHeight || font.charToGlyph('H').getBoundingBox().y2;
  return {
    typeface: {
      glyphs, familyName: family, resolution: OUTLINE_RESOLUTION,
      ascender: number(font.ascender), descender: number(font.descender),
      underlinePosition: number(font.tables.post?.underlinePosition ?? -font.unitsPerEm * 0.1),
      underlineThickness: number(font.tables.post?.underlineThickness ?? font.unitsPerEm * 0.05),
      boundingBox: {
        xMin: number(font.tables.head.xMin), xMax: number(font.tables.head.xMax),
        yMin: number(font.tables.head.yMin), yMax: number(font.tables.head.yMax),
      },
    },
    metadata: {
      unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender,
      capHeight, supportedCodepoints, kerningPairs: {},
    },
    // Resolve only pairs needed by this film rather than scanning every glyph pair.
    kerning(left, right) {
      return font.getKerningValue(font.charToGlyph(left), font.charToGlyph(right));
    },
  };
}

/** Import a static TTF/OTF locally; font bytes never leave the browser. */
export async function importDisplayFont(blob: Blob, name: string): Promise<DisplayFont> {
  if (blob.size > MAX_FONT_FILE_BYTES) throw new FontImportError('size');
  try {
    const bytes = await blob.arrayBuffer();
    const mime = inspectContainer(bytes);
    const font = parse(bytes);
    const prepared = assets(font);
    const hash = hashBytes(bytes);
    const family = `CREACTORS Local ${hash}`;
    const weight = `${Math.max(1, Math.min(1000, font.tables.os2?.usWeightClass ?? 400))}`;
    const style = (font.tables.os2?.fsSelection ?? 0) & 1 || font.tables.post?.italicAngle ? 'italic' : 'normal';
    const url = await dataUrl(bytes, mime);
    const face = new FontFace(family, `url(${url})`, { weight, style });
    await face.load();
    const imported: DisplayFont = {
      id: `local-${hash}`, name: font.getEnglishName('fullName') || name.replace(/\.(ttf|otf)$/iu, ''),
      family, weight, style, url, version: `local-${hash}`, ...prepared,
    };
    const registered = registerDisplayFont(imported);
    if (registered === imported) document.fonts.add(face);
    return registered;
  } catch (error) {
    if (error instanceof FontImportError) throw error;
    throw new FontImportError('decode');
  }
}
