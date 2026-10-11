import emojiUrl from '../../assets/fonts/NotoEmoji-Bold.woff2?inline';
import coverage from '../../assets/generated/emoji-coverage.json';

const supported = new Set(coverage.accepted);
const renderGlyphs = coverage.renderGlyphs as Record<string, string>;
export const emojiCoverage = coverage;
export const EMOJI_ADVANCE = 1.15;
let fontReady: Promise<void> | undefined;

export function loadEmojiFont(): Promise<void> {
  return fontReady ??= (async () => {
    const face = new FontFace('CREACTORS Emoji', `url(${emojiUrl})`, { weight: '700' });
    await face.load();
    document.fonts.add(face);
  })();
}

const isExtension = (character: string) => /[\p{Mark}\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(character);
const regional = (character: string) => /[\u{1F1E6}-\u{1F1FF}]/u.test(character);

/** Versioned scanner keeps ZWJ, selectors, modifiers and flags whole. */
export function graphemes(text: string): string[] {
  const points = [...text];
  const result: string[] = [];
  for (let index = 0; index < points.length; index++) {
    let cluster = points[index];
    if (regional(points[index]) && points[index + 1] && regional(points[index + 1])) cluster += points[++index];
    while (points[index + 1]) {
      if (isExtension(points[index + 1])) cluster += points[++index];
      else if (points[index + 1] === '\u200D' && points[index + 2]) {
        cluster += points[++index] + points[++index];
      } else break;
    }
    result.push(cluster);
  }
  return result;
}

export function isEmoji(text: string): boolean {
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F000}-\u{1FAFF}\u20E3]/u.test(text)
    && !/^\s+$/u.test(text);
}

export function supportsEmoji(sequence: string): boolean { return supported.has(sequence); }

export interface InlineRun { text: string; emoji: boolean }
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const cluster of graphemes(text.normalize('NFC'))) {
    const emoji = isEmoji(cluster);
    const last = runs[runs.length - 1];
    if (!emoji && last && !last.emoji) last.text += cluster;
    else runs.push({ text: cluster, emoji });
  }
  return runs;
}

/** Alpha-only raster from the bundled mono face; the mesh supplies theme color. */
export async function emojiCanvas(sequence: string): Promise<HTMLCanvasElement> {
  if (!supportsEmoji(sequence)) throw new Error(`Uncovered emoji: ${sequence}`);
  await loadEmojiFont();
  const glyph = renderGlyphs[sequence];
  if (!glyph) throw new Error(`Missing verified emoji glyph: ${sequence}`);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const size = 384;
  context.font = `700 ${size}px "CREACTORS Emoji"`;
  const metrics = context.measureText(glyph);
  const pad = 12;
  canvas.width = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + 2 * pad;
  canvas.height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 2 * pad;
  context.font = `700 ${size}px "CREACTORS Emoji"`;
  context.fillStyle = '#FFFFFF';
  context.fillText(glyph, pad + metrics.actualBoundingBoxLeft, pad + metrics.actualBoundingBoxAscent);
  return canvas;
}
