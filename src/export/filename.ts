/** Includes the actual container extension, keeping the complete filename short. */
export const MAX_VIDEO_FILENAME_LENGTH = 76;

/** Preserve readable words and accents while removing filesystem-reserved characters. */
export function videoFilename(text: string, format: 'mp4' | 'webm'): string {
  const extension = `.${format}`;
  let title = text.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '');

  // Windows device names are reserved even when followed by an extension.
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(title)) title = `_${title}`;

  const parts = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title), part => part.segment)
    : Array.from(title);
  let stem = '';
  const limit = MAX_VIDEO_FILENAME_LENGTH - extension.length;
  for (const part of parts) {
    // A UTF-16 cap also keeps UTF-8 filename bytes below filesystem limits.
    if (stem.length + part.length > limit) break;
    stem += part;
  }
  stem = stem.replace(/[. ]+$/gu, '') || 'CREACTORS';
  return `${stem}${extension}`;
}
