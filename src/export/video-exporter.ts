import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny';
import type { SceneRenderer } from '../scene/renderer';
import type { SceneSpec } from '../scene/types';
import { abortError, ExportCapabilityError, ExportResourceError } from './errors';
import { candidateProfiles, encodingConfig, isExportAvailable, profileIsSupported, type ExportProfile } from './profiles';
import { ProgressGuard } from './progress-guard';
import { NativeAvcEncoder } from './native-avc-encoder';
import type { AudioTrack } from '../audio/types';
import { AudioExportCapabilityError, ExportAudioTrack, audioProfileIsSupported, normalizedExportAudio } from './audio-track';

export { ExportCapabilityError, ExportResourceError } from './errors';
export { AudioExportCapabilityError } from './audio-track';
export { detectProfiles, isExportAvailable, type ExportProfile } from './profiles';

export interface VideoExportOptions {
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
  /** Announced before full encoding so the UI can disclose a fallback format/size. */
  onProfile?: (profile: ExportProfile) => void;
  preferredHeight?: 1920 | 1280;
  /** Decoded local audio, captured before export. Never silently dropped. */
  audio?: AudioTrack;
}

export interface VideoExportResult {
  blob: Blob;
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: 30;
  audioCodec?: 'aac' | 'opus';
}

const activeRenderers = new WeakSet<SceneRenderer>();

interface EncodingJob {
  output: Output<Mp4OutputFormat | WebMOutputFormat, BufferTarget>;
  encoder: { add(timestamp: number, duration: number, options: VideoEncoderEncodeOptions): Promise<void>; finish(): Promise<void>; abort(): void };
  target: BufferTarget;
  audio?: ExportAudioTrack;
}

function createJob(renderer: SceneRenderer, profile: ExportProfile, frames: number, title: string, track?: AudioTrack): EncodingJob {
  const target = new BufferTarget();
  const output = new Output({
    format: profile.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'reserve' }) : new WebMOutputFormat(),
    target,
  });
  const native = profile.codec === 'avc' ? new NativeAvcEncoder(renderer.canvas, profile) : null;
  const source = native?.source ?? new CanvasSource(renderer.canvas, encodingConfig(profile));
  const encoder = native ?? {
    add: (timestamp: number, duration: number, options: VideoEncoderEncodeOptions) => (source as CanvasSource).add(timestamp, duration, options),
    finish: async () => { source.close(); },
    abort: () => { source.close(); },
  };
  let audio: ExportAudioTrack | undefined;
  try {
    output.addVideoTrack(source, { frameRate: 30, maximumPacketCount: frames });
    audio = track ? new ExportAudioTrack(track, profile.format === 'mp4' ? 'aac' : 'opus', frames) : undefined;
    if (audio) output.addAudioTrack(audio.source, { maximumPacketCount: Math.ceil(frames / 30 * 150) + 16 });
    output.setMetadataTags({ title, artist: 'CREACTORS' });
    return { output, encoder, target, audio };
  } catch (error) {
    audio?.abort();
    try { encoder.abort(); } catch { /* An unstarted packet source cannot be closed. */ }
    void output.cancel().catch(() => {});
    throw error;
  }
}

async function release(job: EncodingJob | null): Promise<void> {
  if (!job) return;
  try {
    job.audio?.abort();
    job.encoder.abort();
    if (job.output.state !== 'finalized' && job.output.state !== 'canceled') {
      // cancel() closes native encoders; cleanup must not wait indefinitely on a
      // broken browser driver after the foreground watchdog has already fired.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          job.output.cancel(),
          new Promise<void>(resolve => { timeout = setTimeout(resolve, 2000); }),
        ]);
      } finally { clearTimeout(timeout); }
    }
  } catch { /* Preserve the original encoding/cancellation error. */ }
  finally { job.target.buffer = null; }
}

function hasContainerHeader(buffer: ArrayBuffer, format: 'mp4' | 'webm'): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  return format === 'mp4'
    ? bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    : bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

export function keyframeIndices(spec: SceneSpec): Set<number> {
  const frames = Math.ceil(spec.duration * 30);
  const keys = new Set<number>();
  for (let index = 0; index < frames; index += 60) keys.add(index);
  for (const track of spec.cameraTracks) {
    // A non-aligned input cut belongs to the first rendered frame after it.
    if (track.cutBefore) keys.add(Math.ceil(track.start * 30 - 1e-9));
  }
  return keys;
}

/** Native, absolute-time export. The caller pauses preview during this job. */
export class VideoExporter {
  async export(renderer: SceneRenderer, spec: SceneSpec, options: VideoExportOptions = {}): Promise<VideoExportResult> {
    if (activeRenderers.has(renderer)) throw new ExportResourceError('An export is already using this renderer.', false);
    if (!Number.isFinite(spec.duration) || spec.duration <= 0 || spec.duration > 60) {
      throw new ExportResourceError('Video duration must be between zero and sixty seconds.', false);
    }
    if (!isExportAvailable()) throw new ExportCapabilityError();
    const audio = options.audio ? normalizedExportAudio(options.audio) : undefined;
    activeRenderers.add(renderer);
    const previousSize = renderer.getSize();
    const previousTime = renderer.lastTime;
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason ?? abortError());
    let attemptedHeight: 1920 | 1280 = options.preferredHeight ?? 1920;
    const onContextLost = () => controller.abort(new ExportResourceError('The WebGL rendering context was lost.', attemptedHeight === 1920));
    let selected: ExportProfile | null = null;
    const guard = new ProgressGuard(controller, () => attemptedHeight === 1920);
    let job: EncodingJob | null = null;
    options.signal?.addEventListener('abort', onAbort, { once: true });
    renderer.canvas.addEventListener('webglcontextlost', onContextLost);
    if (options.signal?.aborted) onAbort();
    try {
      guard.check();
      options.onProgress?.(0);
      // Probe the actual portrait configuration, then encode and finalize a
      // disposable 24-frame file, exercising repeated encoder batches.
      // isConfigSupported() and a single tiny batch can both overpromise.
      for (const candidate of candidateProfiles(options.preferredHeight)) {
        guard.check();
        attemptedHeight = candidate.height;
        let supported = false;
        try { supported = await guard.wait(profileIsSupported(candidate)); }
        catch (error) { guard.check(); if (error instanceof ExportResourceError) throw error; }
        if (!supported) continue;
        if (audio) {
          try { supported = await guard.wait(audioProfileIsSupported(candidate.format === 'mp4' ? 'aac' : 'opus', audio)); }
          catch { guard.check(); supported = false; }
          if (!supported) continue;
        }
        try {
          renderer.resize(candidate.width, candidate.height);
          job = createJob(renderer, candidate, 24, 'CREACTORS compatibility check', audio);
          await guard.wait(job.output.start());
          for (let index = 0; index < 24; index++) {
            // Include typography rather than testing only the loop's empty frame.
            const time = Math.min(1 + index / 30, spec.duration / 2);
            if (spec.finalImages?.some(image => image.asset.video)) await guard.wait(renderer.renderFrameAsync(time));
            else renderer.renderFrame(time);
            if (job.audio) await guard.wait(job.audio.add(index));
            await guard.wait(job.encoder.add(index / 30, 1 / 30, { keyFrame: index === 0 }));
          }
          await guard.wait(job.encoder.finish());
          if (job.audio) await guard.wait(job.audio.finish());
          await guard.wait(job.output.finalize());
          if (!job.target.buffer || !hasContainerHeader(job.target.buffer, candidate.format)) {
            throw new Error('Native codec did not produce a valid container header.');
          }
          selected = candidate;
        } catch { guard.check(); }
        finally { await release(job); job = null; }
        if (selected) break;
      }
      if (!selected) throw audio ? new AudioExportCapabilityError() : new ExportCapabilityError();
      options.onProfile?.(selected);
      guard.check();
      const frames = Math.ceil(spec.duration * 30);
      const keys = keyframeIndices(spec);
      job = createJob(renderer, selected, frames, spec.sourceText, audio);
      await guard.wait(job.output.start());
      for (let index = 0; index < frames; index++) {
        guard.check();
        if (spec.finalImages?.some(image => image.asset.video)) await guard.wait(renderer.renderFrameAsync(index / 30));
        else renderer.renderFrame(index / 30);
        if (job.audio) await guard.wait(job.audio.add(index));
        // add() captures synchronously before yielding. Never retain frame arrays
        // and always respect both writer and encoder backpressure.
        await guard.wait(job.encoder.add(index / 30, 1 / 30, { keyFrame: keys.has(index) }));
        options.onProgress?.((index + 1) / frames * 0.97);
        if (index % 8 === 7) await guard.wait(new Promise<void>(resolve => setTimeout(resolve, 0)));
      }
      await guard.wait(job.encoder.finish());
      if (job.audio) await guard.wait(job.audio.finish());
      await guard.wait(job.output.finalize());
      guard.check();
      const buffer = job.target.buffer;
      if (!buffer || !hasContainerHeader(buffer, selected.format)) {
        throw new ExportResourceError('Video finalization did not create a valid file.', selected.height === 1920);
      }
      const blob = new Blob([buffer], { type: selected.format === 'mp4' ? 'video/mp4' : 'video/webm' });
      options.onProgress?.(1);
      return { blob, format: selected.format, width: selected.width, height: selected.height, fps: 30,
        ...(audio ? { audioCodec: selected.format === 'mp4' ? 'aac' as const : 'opus' as const } : {}) };
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? abortError();
      if (error instanceof ExportCapabilityError || error instanceof ExportResourceError) throw error;
      throw new ExportResourceError('Native video encoding failed.', selected?.height === 1920, { cause: error });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      renderer.canvas.removeEventListener('webglcontextlost', onContextLost);
      await release(job);
      try { renderer.resize(...previousSize); renderer.renderFrame(previousTime); }
      finally { activeRenderers.delete(renderer); }
    }
  }
}
