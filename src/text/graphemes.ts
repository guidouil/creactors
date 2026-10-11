/** A small pinned scanner: browser Unicode segmentation never changes scene layout. */
export function graphemes(text: string): string[] {
  const points = [...text];
  const output: string[] = [];
  const isExtension = (point: string) => /[\p{M}\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(point);
  const isRegional = (point: string) => /[\u{1F1E6}-\u{1F1FF}]/u.test(point);
  let index = 0;
  while (index < points.length) {
    let cluster = points[index++]!;
    if (isRegional(cluster) && index < points.length && isRegional(points[index]!)) cluster += points[index++]!;
    while (index < points.length) {
      const point = points[index]!;
      if (isExtension(point)) { cluster += point; index++; continue; }
      if (point === '\u200D' && index + 1 < points.length) {
        cluster += point + points[index + 1]!;
        index += 2;
        continue;
      }
      break;
    }
    output.push(cluster);
  }
  return output;
}

export function isEmojiCluster(cluster: string): boolean {
  return /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u20E3/u.test(cluster);
}
