import type { SceneRenderer } from '../scene/renderer';
import type { SceneSpec } from '../scene/types';
import { abortError, ExportResourceError } from './errors';
import { GifEncoder, GifSizeError } from './gif-encoder';
import { candidateGifProfiles, GIF_MAX_BYTES, gifFrameTiming, type GifExportProfile } from './gif-profiles';
import { ProgressGuard } from './progress-guard';

export { candidateGifProfiles, type GifExportProfile } from './gif-profiles';

export class GifExportSizeError extends ExportResourceError {
  constructor(options?: ErrorOptions) {
    super('The complete animation could not fit within the GIF upload limit.', false, options);
    this.name = 'GifExportSizeError';
  }
}

export interface GifExportOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
  /** Announced again if a smaller full-duration encoding is needed. */
  onProfile?: (profile: GifExportProfile) => void;
}

export interface GifExportResult {
  blob: Blob;
  format: 'gif';
  width: number;
  height: number;
  fps: number;
}

const activeRenderers = new WeakSet<SceneRenderer>();

function hasGifHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70
    && bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97;
}

/** Offline GIF encoding, with one captured frame in memory and no native codec dependency. */
export class GifExporter {
  async export(renderer: SceneRenderer, spec: SceneSpec, options: GifExportOptions = {}): Promise<GifExportResult> {
    if (activeRenderers.has(renderer)) throw new ExportResourceError('An export is already using this renderer.', false);
    if (!Number.isFinite(spec.duration) || spec.duration <= 0 || spec.duration > 60) {
      throw new ExportResourceError('GIF duration must be between zero and sixty seconds.', false);
    }
    const profiles = candidateGifProfiles(spec.duration, spec.aspect);
    const previousSize = renderer.getSize();
    const previousTime = renderer.lastTime;
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason ?? abortError());
    const onContextLost = () => controller.abort(new ExportResourceError('The WebGL rendering context was lost.', false));
    const guard = new ProgressGuard(controller, () => false);
    let capture: HTMLCanvasElement | null = null;
    let encoder: GifEncoder | null = null;
    let lastSizeError: unknown;
    let progress = 0;
    const reportProgress = (value: number) => {
      // A quality retry can repeat frames, but the UI must not jump backwards.
      progress = Math.max(progress, value);
      options.onProgress?.(progress);
    };
    activeRenderers.add(renderer);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    renderer.canvas.addEventListener('webglcontextlost', onContextLost);
    if (options.signal?.aborted) onAbort();
    try {
      guard.check();
      reportProgress(0);
      capture = document.createElement('canvas');
      const context = capture.getContext('2d', { willReadFrequently: true });
      if (!context) throw new ExportResourceError('The browser cannot capture frames for GIF export.', false);
      // GIF imports are selected synchronously by absolute render time; video
      // imports additionally need the awaited sample decoder before capture.
      const hasMedia = (spec.finalImages?.length ?? 0) > 0;
      for (const profile of profiles) {
        guard.check();
        options.onProfile?.(profile);
        guard.check();
        renderer.resize(profile.width, profile.height);
        capture.width = profile.width;
        capture.height = profile.height;
        encoder = new GifEncoder({ width: profile.width, height: profile.height, paletteSize: profile.paletteSize, maxBytes: profile.maxBytes });
        try {
          for (let index = 0; index < profile.frameCount; index++) {
            guard.check();
            const timing = gifFrameTiming(index, profile.frameCount, spec.duration);
            if (hasMedia) await guard.wait(renderer.renderFrameAsync(timing.time));
            else renderer.renderFrame(timing.time);
            guard.check();
            // Copy the WebGL canvas immediately after rendering: its drawing
            // buffer need not survive a browser paint or a cooperative yield.
            context.drawImage(renderer.canvas, 0, 0);
            encoder.addFrame(context.getImageData(0, 0, profile.width, profile.height).data, timing.delayCentiseconds);
            reportProgress((index + 1) / profile.frameCount * 0.97);
            await guard.wait(new Promise<void>(resolve => setTimeout(resolve, 0)));
          }
          guard.check();
          const bytes = encoder.finish();
          if (bytes.byteLength > GIF_MAX_BYTES) throw new GifSizeError(profile.maxBytes);
          if (!hasGifHeader(bytes)) throw new ExportResourceError('GIF encoding did not create a valid file.', false);
          const blob = new Blob([bytes], { type: 'image/gif' });
          reportProgress(1);
          return { blob, format: 'gif', width: profile.width, height: profile.height, fps: profile.fps };
        } catch (error) {
          guard.check();
          if (!(error instanceof GifSizeError)) throw error;
          lastSizeError = error;
        } finally {
          // The encoder retains only capped compressed chunks. Discard all
          // chunks from a failed attempt before allocating the next one.
          encoder = null;
        }
      }
      throw new GifExportSizeError({ cause: lastSizeError });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? abortError();
      if (error instanceof ExportResourceError) throw error;
      throw new ExportResourceError('GIF encoding failed.', false, { cause: error });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      renderer.canvas.removeEventListener('webglcontextlost', onContextLost);
      encoder = null;
      if (capture) capture.width = capture.height = 0;
      try {
        // resize/renderFrame also invalidates an aborted asynchronous capture,
        // so a late video decoder cannot overwrite the restored preview.
        renderer.resize(...previousSize);
        renderer.renderFrame(previousTime);
      } finally { activeRenderers.delete(renderer); }
    }
  }
}
