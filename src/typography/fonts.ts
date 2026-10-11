import fontUrl from '../../assets/fonts/BarlowCondensed-Black.ttf?inline';
import coverage from '../../assets/generated/barlow-condensed-black.coverage.json';
import { graphemes, isEmoji, supportsEmoji } from './emoji';

export { fontUrl };
export const fontMetadata = coverage;
const supported = new Set(coverage.supportedCodepoints);

export class GlyphCoverageError extends Error {
  constructor(readonly characters: string[], readonly kind: 'text' | 'emoji') {
    super(`Unsupported ${kind}: ${characters.join(' ')}`);
    this.name = 'GlyphCoverageError';
  }
}

export function validateGlyphs(text: string): void {
  const clusters = graphemes(text.normalize('NFC'));
  const missingEmoji = [...new Set(clusters.filter(cluster => isEmoji(cluster) && !supportsEmoji(cluster)))];
  if (missingEmoji.length) throw new GlyphCoverageError(missingEmoji, 'emoji');
  const missing = [...new Set(clusters.filter(cluster => !isEmoji(cluster)).flatMap(cluster => [...cluster])
    .filter(char => !/\s/u.test(char) && !supported.has(char.codePointAt(0)!)))];
  if (missing.length) throw new GlyphCoverageError(missing, 'text');
}

export async function loadDisplayFont(): Promise<void> {
  const font = new FontFace('Barlow Condensed', `url(${fontUrl})`, { weight: '900', style: 'normal' });
  await font.load();
  document.fonts.add(font);
}
