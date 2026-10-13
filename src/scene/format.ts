export type FilmFormat = 'vertical' | 'square';

/** The composition, preview and encoded video share this width/height ratio. */
export function filmAspect(format: FilmFormat): number {
  return format === 'square' ? 1 : 9 / 16;
}

export function filmFormat(aspect: number): FilmFormat {
  return aspect === 1 ? 'square' : 'vertical';
}

export function previewSize(format: FilmFormat): [number, number] {
  return format === 'square' ? [540, 540] : [540, 960];
}
