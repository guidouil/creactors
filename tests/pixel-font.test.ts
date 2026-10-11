import { describe, expect, it } from 'vitest';
import { Mesh, Raycaster, Vector3 } from 'three';
import type { SceneObject } from '../src/scene/types';
import { prepareTypography } from '../src/typography/objects';
import { outlineLayout } from '../src/typography/outlines';
import { findPortal } from '../src/typography/portals';

const FONT_ID = 'press-start-2p';

function object(text: string): SceneObject {
  return {
    id: 'pixels', text, fontSize: 2.4,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: 1,
    colorRole: 'cyan', extruded: true, extrusionDepth: 0.24,
    readingInterval: [1, 3],
  };
}

describe('pixel font extrusion', () => {
  it('retains the stepped outline footprint and authored depth with finite geometry', async () => {
    const spec = object('PIXEL\nÉTÉ !');
    const outline = outlineLayout(spec.text, spec.fontSize, FONT_ID);
    const prepared = await prepareTypography(spec, 'califormandy-sunset', FONT_ID);
    try {
      const mesh = prepared.root.children[0] as Mesh;
      const positions = mesh.geometry.getAttribute('position');
      const size = prepared.bounds.getSize(new Vector3());
      const center = prepared.bounds.getCenter(new Vector3());
      expect(size.x).toBeCloseTo(outline.bounds.max.x - outline.bounds.min.x, 6);
      expect(size.y).toBeCloseTo(outline.bounds.max.y - outline.bounds.min.y, 6);
      expect(size.z).toBeCloseTo(spec.extrusionDepth, 6);
      expect(center.length()).toBeLessThan(1e-6);
      expect(positions.count).toBeGreaterThan(0);
      for (let index = 0; index < positions.count; index++) {
        expect([positions.getX(index), positions.getY(index), positions.getZ(index)].every(Number.isFinite)).toBe(true);
        // Every contour reaches both flat caps, with no rounded intermediate rim.
        expect(Math.abs(positions.getZ(index))).toBeCloseTo(spec.extrusionDepth / 2, 6);
      }
    } finally {
      prepared.dispose();
    }
  });

  it('keeps the rendered O counter open for a camera portal', async () => {
    const spec = object('O');
    const portal = findPortal(spec.text, spec.fontSize, FONT_ID)!;
    expect(portal.radius).toBeGreaterThan(0.01 * spec.fontSize);
    const prepared = await prepareTypography(spec, 'califormandy-sunset', FONT_ID);
    try {
      prepared.root.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(...portal.center, 1), new Vector3(0, 0, -1));
      expect(ray.intersectObject(prepared.root, true)).toHaveLength(0);
      // The glyph still has solid caps around the open counter.
      ray.ray.origin.set(prepared.bounds.min.x + 0.1 * spec.fontSize, portal.center[1], 1);
      expect(ray.intersectObject(prepared.root, true).length).toBeGreaterThan(0);
    } finally {
      prepared.dispose();
    }
  });
});
