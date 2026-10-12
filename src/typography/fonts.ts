import { FontLoader, type Font, type FontData } from 'three/addons/loaders/FontLoader.js';
import fontUrl from '../../assets/fonts/BarlowCondensed-Black.ttf?inline';
import coverage from '../../assets/generated/barlow-condensed-black.coverage.json';
import barlow from '../../assets/generated/barlow-condensed-black.typeface.json';
import montserratUrl from '../../assets/fonts/Montserrat-Bold.ttf?inline';
import montserratCoverage from '../../assets/generated/montserrat-bold.coverage.json';
import montserrat from '../../assets/generated/montserrat-bold.typeface.json';
import bungeeUrl from '../../assets/fonts/CREACTORSBlock-Regular.ttf?inline';
import bungeeCoverage from '../../assets/generated/bungee-regular.coverage.json';
import bungee from '../../assets/generated/bungee-regular.typeface.json';
import blackOpsUrl from '../../assets/fonts/BlackOpsOne-Regular.ttf?inline';
import blackOpsCoverage from '../../assets/generated/black-ops-one-regular.coverage.json';
import blackOps from '../../assets/generated/black-ops-one-regular.typeface.json';
import alfaSlabUrl from '../../assets/fonts/AlfaSlabOne-Regular.ttf?inline';
import alfaSlabCoverage from '../../assets/generated/alfa-slab-one-regular.coverage.json';
import alfaSlab from '../../assets/generated/alfa-slab-one-regular.typeface.json';
import pixelUrl from '../../assets/fonts/CREACTORSArcade-Regular.ttf?inline';
import pixelCoverage from '../../assets/generated/press-start-2p-regular.coverage.json';
import pixel from '../../assets/generated/press-start-2p-regular.typeface.json';
import { graphemes, isEmoji, supportsEmoji } from './emoji';

export { fontUrl };
export const fontMetadata = coverage;
export const DEFAULT_FONT_ID = 'barlow-condensed-black';

export type FontCharacter = 'block' | 'stencil' | 'slab' | 'pixel' | 'condensed' | 'geometric';

export interface DisplayFont {
  id: string;
  name: string;
  family: string;
  weight: string;
  style: string;
  url: string;
  version: string;
  /** Visual family shown in the picker, independent of the original font name. */
  character?: FontCharacter;
  /** Pixel outlines keep square edges rather than acquiring rounded bevels. */
  extrusion?: 'beveled' | 'square';
  typeface: Omit<FontData, 'original_font_information'> & { original_font_information?: unknown };
  metadata: {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    capHeight: number;
    supportedCodepoints: readonly number[];
    kerningPairs: Record<string, number>;
  };
  /** Imported fonts resolve pairs on demand, in original font units. */
  kerning?: (left: string, right: string) => number;
}

const fonts = new Map<string, DisplayFont>();
const outlineFonts = new Map<string, Font>();
const supported = new Map<string, Set<number>>();
const loaded = new Map<string, Promise<void>>();

export function registerDisplayFont(font: DisplayFont): DisplayFont {
  if (fonts.has(font.id)) return fonts.get(font.id)!;
  fonts.set(font.id, font);
  supported.set(font.id, new Set(font.metadata.supportedCodepoints));
  return font;
}

registerDisplayFont({ id: DEFAULT_FONT_ID, name: 'Barlow Condensed Black', family: 'Barlow Condensed', weight: '900', style: 'normal', url: fontUrl, version: 'barlow-condensed-black-1', typeface: barlow, metadata: coverage, character: 'condensed' });
registerDisplayFont({ id: 'bungee', name: 'Bungee', family: 'CREACTORS Block', weight: '400', style: 'normal', url: bungeeUrl, version: 'bungee-1', typeface: bungee, metadata: bungeeCoverage, character: 'block' });
registerDisplayFont({ id: 'black-ops-one', name: 'Black Ops One', family: 'Black Ops One', weight: '400', style: 'normal', url: blackOpsUrl, version: 'black-ops-one-1', typeface: blackOps, metadata: blackOpsCoverage, character: 'stencil' });
registerDisplayFont({ id: 'alfa-slab-one', name: 'Alfa Slab One', family: 'Alfa Slab One', weight: '400', style: 'normal', url: alfaSlabUrl, version: 'alfa-slab-one-1', typeface: alfaSlab, metadata: alfaSlabCoverage, character: 'slab' });
registerDisplayFont({ id: 'press-start-2p', name: 'Pixel Arcade', family: 'CREACTORS Arcade', weight: '400', style: 'normal', url: pixelUrl, version: 'pixel-arcade-1', typeface: pixel, metadata: pixelCoverage, character: 'pixel', extrusion: 'square' });
registerDisplayFont({ id: 'montserrat-bold', name: 'Montserrat Bold', family: 'Montserrat', weight: '700', style: 'normal', url: montserratUrl, version: 'montserrat-bold-1', typeface: montserrat, metadata: montserratCoverage, character: 'geometric' });

export function listDisplayFonts(): readonly DisplayFont[] { return [...fonts.values()]; }

export function getDisplayFont(id = DEFAULT_FONT_ID): DisplayFont {
  const font = fonts.get(id);
  if (!font) throw new Error(`Unknown font: ${id}`);
  return font;
}

export function getOutlineFont(id = DEFAULT_FONT_ID): Font {
  if (!outlineFonts.has(id)) {
    const { typeface } = getDisplayFont(id);
    outlineFonts.set(id, new FontLoader().parse({ ...typeface, original_font_information: { family: typeface.familyName } }));
  }
  return outlineFonts.get(id)!;
}

export function fontKerning(left: string, right: string, id = DEFAULT_FONT_ID): number {
  const font = getDisplayFont(id);
  const a = left.normalize('NFC'), b = right.normalize('NFC');
  return (font.kerning?.(a, b) ?? font.metadata.kerningPairs[`${a.codePointAt(0)},${b.codePointAt(0)}`] ?? 0) / font.metadata.unitsPerEm;
}

export class GlyphCoverageError extends Error {
  constructor(readonly characters: string[], readonly kind: 'text' | 'emoji') {
    super(`Unsupported ${kind}: ${characters.join(' ')}`);
    this.name = 'GlyphCoverageError';
  }
}

export function validateGlyphs(text: string, fontId = DEFAULT_FONT_ID): void {
  getDisplayFont(fontId);
  const clusters = graphemes(text.normalize('NFC'));
  const missingEmoji = [...new Set(clusters.filter(cluster => isEmoji(cluster) && !supportsEmoji(cluster)))];
  if (missingEmoji.length) throw new GlyphCoverageError(missingEmoji, 'emoji');
  const missing = [...new Set(clusters.filter(cluster => !isEmoji(cluster)).flatMap(cluster => [...cluster])
    .filter(char => !/\s/u.test(char) && !supported.get(fontId)!.has(char.codePointAt(0)!)))];
  if (missing.length) throw new GlyphCoverageError(missing, 'text');
}

export function loadDisplayFont(id = DEFAULT_FONT_ID): Promise<void> {
  if (!loaded.has(id)) {
    const choice = getDisplayFont(id);
    const pending = (async () => {
      const font = new FontFace(choice.family, `url(${choice.url})`, { weight: choice.weight, style: choice.style });
      await font.load();
      document.fonts.add(font);
    })();
    loaded.set(id, pending);
    pending.catch(() => loaded.delete(id));
  }
  return loaded.get(id)!;
}
