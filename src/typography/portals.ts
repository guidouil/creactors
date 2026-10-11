import { Vector2 } from 'three';
import { outlineLayout } from './outlines';
import { isEmoji } from './emoji';

export interface PortalCandidate {
  center: readonly [number, number];
  radius: number;
  character: string;
  index: number;
}

function inside(point: Vector2, polygon: Vector2[]): boolean {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) yes = !yes;
  }
  return yes;
}

function clearance(point: Vector2, polygon: Vector2[]): number {
  let radius = Infinity;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const edge = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(edge) / Math.max(edge.lengthSq(), 1e-12)));
    radius = Math.min(radius, point.distanceTo(a.clone().addScaledVector(edge, t)));
  }
  return radius;
}

/** A real closed outline hole, not a guess from the character's identity. */
export function findPortal(displayText: string, fontSize = 1): PortalCandidate | null {
  if (isEmoji(displayText)) return null;
  const layout = outlineLayout(displayText, fontSize);
  const origin = layout.bounds.getCenter(new Vector2());
  let best: PortalCandidate | null = null;
  for (const glyph of layout.glyphs) for (const shape of glyph.shapes) for (const hole of shape.holes) {
    const polygon = hole.getPoints(48);
    if (polygon.length < 4 || polygon[0].distanceTo(polygon[polygon.length - 1]) > 0.002 * fontSize) continue;
    const min = new Vector2(Infinity, Infinity), max = new Vector2(-Infinity, -Infinity);
    polygon.forEach(point => { min.min(point); max.max(point); });
    for (let x = 1; x < 16; x++) for (let y = 1; y < 16; y++) {
      const point = new Vector2(min.x + (max.x - min.x) * x / 16, min.y + (max.y - min.y) * y / 16);
      if (!inside(point, polygon)) continue;
      const radius = clearance(point, polygon);
      // Discovery remains permissive; the director separately validates the
      // full near-frustum, bevel and safety margin at the chosen hero scale.
      if (radius > 0.01 * fontSize && (!best || radius > best.radius)) {
        best = { character: glyph.character, index: glyph.index, center: [point.x - origin.x, point.y - origin.y], radius };
      }
    }
  }
  return best;
}
