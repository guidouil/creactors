import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FontImportError, MAX_FONT_FILE_BYTES, importDisplayFont, localFontsAvailable, queryLocalFonts, type LocalFont,
} from '../src/typography/font-import';
import { DEFAULT_FONT_ID, getDisplayFont, validateGlyphs } from '../src/typography/fonts';
import { measureLine } from '../src/typography/measure';
import { outlineLayout, textAdvance } from '../src/typography/outlines';

const realFont = () => new Blob([new Uint8Array(readFileSync(new URL('../assets/fonts/BarlowCondensed-Black.ttf', import.meta.url)))]);

function stubFontDecoder(load = vi.fn(async function (this: object) { return this; })) {
  const add = vi.fn();
  vi.stubGlobal('document', { fonts: { add } });
  vi.stubGlobal('FontFace', class {
    load = load;
    constructor(readonly family: string, readonly source: string, readonly descriptors: object) {}
  });
  vi.stubGlobal('FileReader', class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  });
  return { add, load };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('font file import', () => {
  it('preserves real source bytes, coverage, kerning and geometry from the checked-in font', async () => {
    const { add, load } = stubFontDecoder();
    const source = realFont();
    const imported = await importDisplayFont(source, 'font.ttf');
    const original = getDisplayFont(DEFAULT_FONT_ID);
    expect(imported.name).toBe('Barlow Condensed Black');
    expect(imported.metadata.supportedCodepoints).toEqual(original.metadata.supportedCodepoints);
    expect(imported.typeface.glyphs).toEqual(original.typeface.glyphs);
    expect(Buffer.from(imported.url.split(',')[1]!, 'base64')).toEqual(Buffer.from(await source.arrayBuffer()));
    expect(load).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    const text = 'AV — Créons un cœur, Œ !';
    expect(() => validateGlyphs(text, imported.id)).not.toThrow();
    expect(() => validateGlyphs('你好', imported.id)).toThrow(/Unsupported text/);
    expect(measureLine(text, imported.id)).toEqual(measureLine(text));
    expect(textAdvance(text, 1, imported.id)).toBe(textAdvance(text));
    expect(outlineLayout('O\nAV', 2.4, imported.id).bounds).toEqual(outlineLayout('O\nAV', 2.4).bounds);
    // The same bytes, even under a different filename, identify the same font.
    expect(await importDisplayFont(source, 'renamed.ttf')).toBe(imported);
    expect(add).toHaveBeenCalledOnce();
  });

  it('refuses oversized files before reading or decoding them', async () => {
    const { load } = stubFontDecoder();
    const read = vi.fn();
    const oversized = { size: MAX_FONT_FILE_BYTES + 1, arrayBuffer: read } as unknown as Blob;
    await expect(importDisplayFont(oversized, 'oversized.ttf')).rejects.toMatchObject({ kind: 'size' });
    expect(read).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects unknown files, font collections, variable fonts and damaged SFNT tables', async () => {
    const { load } = stubFontDecoder();
    await expect(importDisplayFont(new Blob(['This is not a font.']), 'fake.ttf')).rejects.toMatchObject({ kind: 'format' });
    await expect(importDisplayFont(new Blob(['ttcf000000000000']), 'collection.ttc')).rejects.toMatchObject({ kind: 'format' });
    const variable = new Blob([new Uint8Array(readFileSync(new URL('../assets/fonts/NotoEmoji-Variable.ttf', import.meta.url)))]);
    await expect(importDisplayFont(variable, 'variable.ttf')).rejects.toMatchObject({ kind: 'format' });
    const bytes = await realFont().arrayBuffer();
    new DataView(bytes).setUint32(20, bytes.byteLength + 1); // A table points beyond the file.
    await expect(importDisplayFont(new Blob([bytes]), 'damaged.ttf')).rejects.toMatchObject({ kind: 'decode' });
    expect(load).not.toHaveBeenCalled();
  });

  it('reports a failed browser font decode without accepting it as a usable import', async () => {
    const { add } = stubFontDecoder(vi.fn().mockRejectedValue(new DOMException('Invalid font', 'SyntaxError')));
    await expect(importDisplayFont(realFont(), 'rejected.ttf')).rejects.toBeInstanceOf(FontImportError);
    await expect(importDisplayFont(realFont(), 'rejected.ttf')).rejects.toMatchObject({ kind: 'decode' });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('local font enumeration', () => {
  it.each([
    undefined,
    { isSecureContext: false, location: { origin: 'http://example.test' }, queryLocalFonts: vi.fn() },
    { isSecureContext: true, location: { origin: 'null' }, queryLocalFonts: vi.fn() },
    { isSecureContext: true, location: { origin: 'file://', protocol: 'file:' }, queryLocalFonts: vi.fn() },
    { isSecureContext: true, location: { origin: 'https://example.test' } },
  ])('keeps unavailable browsers and origins away from the permission API', async browser => {
    vi.stubGlobal('window', browser);
    expect(localFontsAvailable()).toBe(false);
    await expect(queryLocalFonts()).rejects.toMatchObject({ kind: 'unavailable' });
    if (browser?.queryLocalFonts) expect(browser.queryLocalFonts).not.toHaveBeenCalled();
  });

  it('invokes the permission API immediately and retains selected font bytes', async () => {
    const blob = vi.fn(async () => realFont());
    const entry = (name: string): LocalFont => ({ fullName: name, family: name, style: 'Regular', postscriptName: name, blob });
    const native = vi.fn(async () => [entry('Zulu'), entry('Alpha')]);
    vi.stubGlobal('window', { isSecureContext: true, location: { origin: 'https://example.test', protocol: 'https:' }, queryLocalFonts: native });
    expect(localFontsAvailable()).toBe(true);
    const pending = queryLocalFonts();
    expect(native).toHaveBeenCalledOnce(); // No await may consume the click's activation first.
    const fonts = await pending;
    expect(fonts.map(font => font.fullName)).toEqual(['Alpha', 'Zulu']);
    expect((await fonts[0]!.blob()).size).toBe(realFont().size);
  });

  it.each(['NotAllowedError', 'SecurityError'])('reports a denied browser grant as permission: %s', async name => {
    vi.stubGlobal('window', {
      isSecureContext: true, location: { origin: 'https://example.test', protocol: 'https:' },
      queryLocalFonts: vi.fn().mockRejectedValue(new DOMException('Access denied', name)),
    });
    await expect(queryLocalFonts()).rejects.toMatchObject({ kind: 'permission' });
  });
});
