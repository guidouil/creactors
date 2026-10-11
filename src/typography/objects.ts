import { Box3, CanvasTexture, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { Text, configureTextBuilder } from 'troika-three-text';
import { fontUrl, validateGlyphs } from './fonts';
import type { SceneObject } from '../scene/types';
import { getTheme, type Theme } from '../themes';
import { outlineLayout, textAdvance } from './outlines';
import { EMOJI_ADVANCE, emojiCanvas, inlineRuns, isEmoji } from './emoji';

// Supply the embedded font even for the library's error fallback. Glyph coverage
// is validated before synchronization so no Unicode CDN resolver is invoked.
configureTextBuilder({ useWorker: true, defaultFontURL: fontUrl });

export interface PreparedTypography {
  root: Group;
  bounds: Box3;
  recolor(theme: Theme): void;
  dispose(): void;
}

function extruded(spec: SceneObject, theme: Theme): PreparedTypography {
  const { shapes } = outlineLayout(spec.displayText ?? spec.text, spec.fontSize);
  const geometry = new ExtrudeGeometry(shapes, {
    depth: spec.extrusionDepth,
    curveSegments: 14,
    bevelEnabled: true,
    bevelSize: 0.008 * spec.fontSize,
    bevelThickness: 0.008 * spec.fontSize,
    bevelSegments: 2,
    steps: 1,
  });
  // One draw for front faces and one for sidewalls, rather than two per glyph.
  mergeGroups(geometry);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  const front = new MeshBasicMaterial({ color: theme.colors[spec.colorRole] });
  const side = new MeshBasicMaterial({ color: theme.sides[spec.colorRole] });
  const mesh = new Mesh(geometry, [front, side]);
  const root = new Group();
  root.add(mesh);
  return {
    root,
    bounds: geometry.boundingBox!.clone(),
    recolor(next) { front.color.set(next.colors[spec.colorRole]); side.color.set(next.sides[spec.colorRole]); },
    dispose() { geometry.dispose(); front.dispose(); side.dispose(); },
  };
}

async function sdf(spec: SceneObject, theme: Theme): Promise<PreparedTypography> {
  const text = new Text();
  text.text = (spec.displayText ?? spec.text).normalize('NFC');
  text.font = fontUrl;
  text.fontSize = spec.fontSize;
  text.anchorX = 'center';
  text.anchorY = 'middle';
  text.color = theme.colors[spec.colorRole];
  text.sdfGlyphSize = 128;
  text.lineHeight = 1.05;
  const baseMaterial = new MeshBasicMaterial({ color: theme.colors[spec.colorRole] });
  text.material = baseMaterial;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Typography preparation timed out.')), 20000);
    text.sync(() => { window.clearTimeout(timeout); resolve(); });
  }).catch(error => { text.dispose(); baseMaterial.dispose(); throw error; });
  const [x0, y0, x1, y1] = text.textRenderInfo!.blockBounds;
  const root = new Group();
  root.add(text);
  return {
    root,
    bounds: new Box3(new Vector3(x0, y0, 0), new Vector3(x1, y1, 0)),
    recolor(next) { text.color = next.colors[spec.colorRole]; baseMaterial.color.set(next.colors[spec.colorRole]); },
    dispose() { text.dispose(); text.material.dispose(); baseMaterial.dispose(); },
  };
}

async function hybrid(spec: SceneObject, theme: Theme): Promise<PreparedTypography> {
  const root = new Group();
  const bounds = new Box3();
  const items: PreparedTypography[] = [];
  const textures: CanvasTexture[] = [];
  const materials: MeshBasicMaterial[] = [];
  const geometries: PlaneGeometry[] = [];
  try {
    const lines = (spec.displayText ?? spec.text).split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let cursor = 0;
      const baseline = -lineIndex * spec.fontSize * 1.05;
      for (const run of inlineRuns(lines[lineIndex])) {
        if (run.emoji) {
          const canvas = await emojiCanvas(run.text);
          const texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;
          const height = spec.fontSize * 0.9;
          const width = height * canvas.width / canvas.height;
          const geometry = new PlaneGeometry(width, height);
          const material = new MeshBasicMaterial({ map: texture, color: theme.colors[spec.colorRole], transparent: true, alphaTest: 0.025 });
          const mesh = new Mesh(geometry, material);
          mesh.position.set(cursor + spec.fontSize * EMOJI_ADVANCE / 2, baseline + spec.fontSize * 0.35, 0);
          root.add(mesh);
          bounds.expandByPoint(new Vector3(mesh.position.x - width / 2, mesh.position.y - height / 2, 0));
          bounds.expandByPoint(new Vector3(mesh.position.x + width / 2, mesh.position.y + height / 2, 0));
          textures.push(texture); materials.push(material); geometries.push(geometry);
          cursor += spec.fontSize * EMOJI_ADVANCE;
        } else {
          const text = new Text();
          text.text = run.text;
          text.font = fontUrl;
          text.fontSize = spec.fontSize;
          text.anchorX = 'left'; text.anchorY = 'bottom-baseline'; text.lineHeight = 1.05;
          text.sdfGlyphSize = 128; text.color = theme.colors[spec.colorRole];
          const baseMaterial = new MeshBasicMaterial({ color: theme.colors[spec.colorRole] });
          text.material = baseMaterial;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Typography preparation timed out.')), 20000);
            text.sync(() => { clearTimeout(timeout); resolve(); });
          }).catch(error => { text.dispose(); baseMaterial.dispose(); throw error; });
          text.position.set(cursor, baseline, 0); root.add(text);
          const [x0, y0, x1, y1] = text.textRenderInfo!.blockBounds;
          bounds.expandByPoint(new Vector3(cursor + x0, baseline + y0, 0));
          bounds.expandByPoint(new Vector3(cursor + x1, baseline + y1, 0));
          items.push({ root: new Group(), bounds: new Box3(), recolor(next) { text.color = next.colors[spec.colorRole]; baseMaterial.color.set(next.colors[spec.colorRole]); }, dispose() { text.dispose(); text.material.dispose(); baseMaterial.dispose(); } });
          cursor += textAdvance(run.text, spec.fontSize);
        }
      }
    }
    const center = bounds.getCenter(new Vector3());
    root.children.forEach(child => child.position.sub(center));
    bounds.translate(center.negate());
    return { root, bounds, recolor(next) { items.forEach(item => item.recolor(next)); materials.forEach(material => material.color.set(next.colors[spec.colorRole])); },
      dispose() { items.forEach(item => item.dispose()); textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); } };
  } catch (error) {
    items.forEach(item => item.dispose()); textures.forEach(texture => texture.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    throw error;
  }
}

export async function prepareTypography(spec: SceneObject, themeId = 'califormandy-sunset'): Promise<PreparedTypography> {
  validateGlyphs(spec.text);
  const theme = getTheme(themeId);
  return isEmoji(spec.displayText ?? spec.text) ? hybrid(spec, theme) : spec.extruded ? extruded(spec, theme) : sdf(spec, theme);
}
