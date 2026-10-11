import { Box3, Color, Group, LinearFilter, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Texture, Vector3, WebGLRenderer } from 'three';
import { prepareTypography, type PreparedTypography } from '../typography/objects';
import { evaluateScene } from './evaluator';
import type { FinalImageObject, SceneSpec } from './types';
import { getTheme } from '../themes';
import { imageFrameIndex } from '../image/animation';

interface PreparedImage {
  root: Group;
  bounds: Box3;
  texture: Texture;
  updateFrame(time: number): void;
  dispose(): void;
}

async function prepareImage(object: FinalImageObject): Promise<PreparedImage> {
  const frames: HTMLImageElement[] = [];
  try {
    for (const source of object.asset.animation?.frames.map(frame => frame.source) ?? [object.asset.source]) {
      const image = new Image();
      frames.push(image);
      image.src = source;
      await image.decode();
    }
  } catch (error) {
    frames.forEach(image => { image.src = ''; });
    throw error;
  }
  // One GPU texture per animation: its bounded, composed frames share a canvas.
  const canvas = object.asset.animation ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = object.asset.width; canvas.height = object.asset.height; }
  const context = canvas?.getContext('2d') ?? null;
  if (canvas && !context) {
    frames.forEach(image => { image.src = ''; });
    throw new Error('The animated final image could not be prepared.');
  }
  let currentFrame = 0;
  context?.drawImage(frames[0]!, 0, 0);
  const texture = new Texture(canvas ?? frames[0]!);
  if (canvas) { texture.generateMipmaps = false; texture.minFilter = LinearFilter; }
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  const geometry = new PlaneGeometry(object.width, object.height);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const root = new Group();
  root.name = object.id;
  root.visible = false;
  root.add(new Mesh(geometry, material));
  return {
    root,
    texture,
    bounds: new Box3(new Vector3(-object.width / 2, -object.height / 2, 0), new Vector3(object.width / 2, object.height / 2, 0)),
    updateFrame(time) {
      if (!context || !canvas) return;
      const nextFrame = imageFrameIndex(object.asset, time - object.entrance.end);
      if (nextFrame === currentFrame) return;
      currentFrame = nextFrame;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(frames[nextFrame]!, 0, 0);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose(); geometry.dispose(); material.dispose();
      frames.forEach(image => { image.src = ''; });
      if (canvas) canvas.width = canvas.height = 0;
    },
  };
}

export class SceneRenderer {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(38, 9 / 16, 0.05, 180);
  readonly world = new Scene();
  private prepared = new Map<string, PreparedTypography>();
  private preparedImages = new Map<string, PreparedImage>();
  private spec: SceneSpec | null = null;
  private pixels: [number, number] = [540, 960];
  private preparationGeneration = 0;
  private latestPreparation: Promise<void> | null = null;
  private disposed = false;
  frameTime = 0;
  lastTime = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.world.background = new Color(getTheme('califormandy-sunset').background);
    this.renderer.setSize(...this.pixels, false);
  }

  prepare(spec: SceneSpec): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Cannot prepare a disposed scene renderer.'));
    const generation = ++this.preparationGeneration;
    this.clear();
    this.world.background = new Color(getTheme(spec.themeId).background);
    const preparation = this.prepareGeneration(spec, generation);
    this.latestPreparation = preparation;
    return preparation;
  }

  private async prepareGeneration(spec: SceneSpec, generation: number): Promise<void> {
    try {
      // Sequential setup bounds font-generation work and makes cleanup complete
      // even when one asynchronous text object fails to prepare.
      for (const object of spec.objects) {
        const typography = await prepareTypography(object, spec.themeId, spec.fontId);
        // A restored context can begin preparation while an older text sync is
        // pending. That result belongs to the old generation, never the world.
        if (generation !== this.preparationGeneration) {
          typography.dispose();
          return this.latestPreparation ?? undefined;
        }
        this.prepared.set(object.id, typography);
        this.world.add(typography.root);
      }
      for (const object of spec.finalImages ?? []) {
        const image = await prepareImage(object);
        if (generation !== this.preparationGeneration) {
          image.dispose();
          return this.latestPreparation ?? undefined;
        }
        this.preparedImages.set(object.id, image);
        // Upload while generation is busy, avoiding a first-appearance hitch.
        // compileAsync below also traverses hidden meshes in the pinned Three.
        this.renderer.initTexture(image.texture);
        this.world.add(image.root);
      }
      this.spec = spec;
      this.camera.aspect = spec.aspect;
      this.renderFrame(0);
      await this.renderer.compileAsync(this.world, this.camera);
      // Keep superseded callers waiting for the replacement scene. In
      // particular, the initial ready promise must not resolve mid-recovery.
      if (generation !== this.preparationGeneration) return this.latestPreparation ?? undefined;
      this.renderFrame(0);
    } catch (error) {
      // A stale failure must not clear resources owned by a newer preparation.
      if (generation !== this.preparationGeneration) return this.latestPreparation ?? undefined;
      this.clear();
      throw error;
    }
  }

  renderFrame(time: number): void {
    if (!this.spec) return;
    const start = performance.now();
    const state = evaluateScene(this.spec, time);
    this.camera.position.fromArray(state.camera.position);
    this.camera.quaternion.fromArray(state.camera.quaternion);
    this.camera.fov = state.camera.fov;
    this.camera.updateProjectionMatrix();
    for (const object of state.objects) {
      const root = this.prepared.get(object.id)!.root;
      root.position.fromArray(object.position);
      root.rotation.set(...object.rotation);
      root.scale.setScalar(object.scale);
    }
    for (const image of state.finalImages ?? []) {
      const prepared = this.preparedImages.get(image.id)!;
      const root = prepared.root;
      root.visible = image.visible && image.scale > 0;
      if (root.visible) prepared.updateFrame(state.time);
      root.position.fromArray(image.position);
      root.rotation.set(...image.rotation);
      root.scale.setScalar(image.scale);
    }
    this.renderer.render(this.world, this.camera);
    this.lastTime = state.time;
    this.frameTime = performance.now() - start;
  }

  resize(width = 540, height = 960): void {
    this.pixels = [width, height];
    this.renderer.setSize(width, height, false);
    this.renderFrame(this.lastTime);
  }

  getSize(): [number, number] { return [...this.pixels]; }

  setTheme(themeId: string): void {
    const theme = getTheme(themeId);
    if (this.spec) this.spec = { ...this.spec, themeId: theme.id };
    this.world.background = new Color(theme.background);
    this.prepared.forEach(item => item.recolor(theme));
    this.renderFrame(this.lastTime);
  }

  /** Project real prepared text/image bounds for inspection and framing checks. */
  projectedBounds(): { id: string; min: number[]; max: number[] }[] {
    this.world.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const objects = [...this.prepared].map(([id, { root, bounds }]) => ({ id, root, bounds }));
    for (const [id, { root, bounds }] of this.preparedImages) objects.push({ id, root, bounds });
    return objects.map(({ id, root, bounds }) => {
      const projected = new Box3();
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            projected.expandByPoint(new Vector3(x, y, z).applyMatrix4(root.matrixWorld).project(this.camera));
          }
        }
      }
      return { id, min: projected.min.toArray(), max: projected.max.toArray() };
    });
  }

  get objectRoots(): Group[] {
    return [...this.prepared.values(), ...this.preparedImages.values()].map(item => item.root);
  }

  private clear(): void {
    for (const item of this.prepared.values()) { this.world.remove(item.root); item.dispose(); }
    this.prepared.clear();
    for (const item of this.preparedImages.values()) { this.world.remove(item.root); item.dispose(); }
    this.preparedImages.clear();
    this.spec = null;
  }

  dispose(): void {
    this.disposed = true;
    ++this.preparationGeneration;
    this.latestPreparation = null;
    this.clear();
    this.renderer.dispose();
  }
}
