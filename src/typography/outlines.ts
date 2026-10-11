import { Box2, Shape, Vector2 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import typeface from '../../assets/generated/barlow-condensed-black.typeface.json';
import coverage from '../../assets/generated/barlow-condensed-black.coverage.json';

const font = new FontLoader().parse({ ...typeface, original_font_information: { family: typeface.familyName } });
const kerning = coverage.kerningPairs as Record<string, number>;
const glyphs = typeface.glyphs as Record<string, { ha: number }>;

export function textAdvance(text: string, fontSize = 1): number {
  let width = 0, previous: number | undefined;
  for (const character of text.normalize('NFC')) {
    const point = character.codePointAt(0)!;
    if (previous !== undefined) width += (kerning[`${previous},${point}`] ?? 0) * fontSize / coverage.unitsPerEm;
    width += (glyphs[character]?.ha ?? 1000) * fontSize / typeface.resolution;
    previous = point;
  }
  return width;
}

export interface OutlineLayout {
  shapes: Shape[];
  glyphs: { character: string; index: number; shapes: Shape[] }[];
  bounds: Box2;
}

/** Same positioning is shared by extrusions and aperture inspection. */
export function outlineLayout(text: string, fontSize: number): OutlineLayout {
  let cursor = 0, baseline = 0, previous: number | undefined, index = 0;
  const shapes: Shape[] = [];
  const laidOut: OutlineLayout['glyphs'] = [];
  const bounds = new Box2();
  for (const character of text.normalize('NFC')) {
    if (character === '\n') { cursor = 0; baseline -= fontSize * 1.05; previous = undefined; index++; continue; }
    const point = character.codePointAt(0)!;
    if (previous !== undefined) cursor += (kerning[`${previous},${point}`] ?? 0) * fontSize / coverage.unitsPerEm;
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
    cursor += (glyphs[character]?.ha ?? 1000) * fontSize / typeface.resolution;
    previous = point;
    index += character.length;
  }
  return { shapes, glyphs: laidOut, bounds };
}
