import { Box2, Shape, Vector2 } from 'three';
import { DEFAULT_FONT_ID, fontKerning, getDisplayFont, getOutlineFont } from './fonts';

export function textAdvance(text: string, fontSize = 1, fontId = DEFAULT_FONT_ID): number {
  const { glyphs, resolution } = getDisplayFont(fontId).typeface;
  let width = 0, previous: string | undefined;
  for (const character of text.normalize('NFC')) {
    if (previous !== undefined) width += fontKerning(previous, character, fontId) * fontSize;
    width += (glyphs[character]?.ha ?? 1000) * fontSize / resolution;
    previous = character;
  }
  return width;
}

export interface OutlineLayout {
  shapes: Shape[];
  glyphs: { character: string; index: number; shapes: Shape[] }[];
  bounds: Box2;
}

/** Same positioning is shared by extrusions and aperture inspection. */
export function outlineLayout(text: string, fontSize: number, fontId = DEFAULT_FONT_ID): OutlineLayout {
  const { glyphs, resolution } = getDisplayFont(fontId).typeface;
  const font = getOutlineFont(fontId);
  let cursor = 0, baseline = 0, previous: string | undefined, index = 0;
  const shapes: Shape[] = [];
  const laidOut: OutlineLayout['glyphs'] = [];
  const bounds = new Box2();
  for (const character of text.normalize('NFC')) {
    if (character === '\n') { cursor = 0; baseline -= fontSize * 1.05; previous = undefined; index++; continue; }
    if (previous !== undefined) cursor += fontKerning(previous, character, fontId) * fontSize;
    const glyphShapes = font.generateShapes(character, fontSize);
    for (const shape of glyphShapes) {
      for (const curve of [...shape.curves, ...shape.holes.flatMap(hole => hole.curves)]) {
        for (const key of ['v0', 'v1', 'v2', 'v3'] as const) {
          const point = (curve as unknown as Record<string, Vector2>)[key];
          if (point) { point.x += cursor; point.y += baseline; }
        }
      }
      for (const point of shape.getPoints(24)) bounds.expandByPoint(point);
      shapes.push(shape);
    }
    laidOut.push({ character, index, shapes: glyphShapes });
    cursor += (glyphs[character]?.ha ?? 1000) * fontSize / resolution;
    previous = character;
    index += character.length;
  }
  return { shapes, glyphs: laidOut, bounds };
}
