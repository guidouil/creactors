import { francAll } from 'franc';

export type InputLanguage = 'auto' | 'fr' | 'en';
export type ResolvedLanguage = 'fr' | 'en';

export interface DetectedTextLanguage {
  language: ResolvedLanguage;
  /** A local evidence score, not a calibrated probability from franc. */
  confidence: number;
  uncertain: boolean;
}

const MIN_LETTERS = 3;
const RELIABLE_LETTERS = 20;
const RELIABLE_MARGIN = 0.2;
const FALLBACK_LANGUAGE: ResolvedLanguage = 'en';

/**
 * Only language metadata uses this sample; source text and source spans never
 * change. Removing emoji, digits and punctuation prevents them from supplying
 * artificial length or distorting a short quotation's trigrams.
 */
function languageSample(text: string): string {
  return text.normalize('NFC').replaceAll('’', "'")
    .match(/\p{L}[\p{L}\p{M}]*(?:['\-]\p{L}[\p{L}\p{M}]*)*/gu)?.join(' ') ?? '';
}

/**
 * franc 6.2.0 compares only French and English. minLength=3 lets short quotes
 * retain its best available result, but fewer than 20 letters or a normalized
 * score gap below 0.20 remain uncertain. These conservative product thresholds
 * are not an accuracy guarantee: franc explicitly warns about small samples.
 * Its winning score is always 1, so it cannot be used as a confidence value.
 * Undetermined input and exact ties use English with no claimed confidence;
 * this fallback never depends on the interface/browser language.
 */
export function detectTextLanguage(text: string, override: InputLanguage = 'auto'): DetectedTextLanguage {
  if (override !== 'auto') return { language: override, confidence: 1, uncertain: false };

  const sample = languageSample(text);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  const fallback = { language: FALLBACK_LANGUAGE, confidence: 0, uncertain: true };
  if (letters < MIN_LETTERS) return fallback;

  const ranked = francAll(sample, { only: ['fra', 'eng'], minLength: MIN_LETTERS });
  const best = ranked[0];
  const next = ranked[1];
  if (!best || !next || !['fra', 'eng'].includes(best[0])) return fallback;
  const margin = Math.max(0, Math.min(1, best[1] - next[1]));
  if (margin === 0) return fallback;

  const uncertain = letters < RELIABLE_LETTERS || margin < RELIABLE_MARGIN;
  const confidence = uncertain
    ? 0.49 * Math.min(1, letters / RELIABLE_LETTERS) * Math.min(1, margin / RELIABLE_MARGIN)
    : Math.min(0.99, 0.5 + 0.49 * (margin - RELIABLE_MARGIN) / (1 - RELIABLE_MARGIN));
  return { language: best[0] === 'fra' ? 'fr' : 'en', confidence, uncertain };
}
