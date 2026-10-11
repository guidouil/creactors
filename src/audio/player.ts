import type { AudioTrack } from './types';
import {
  AUDIO_ATTACK_SECONDS, AUDIO_RELEASE_SECONDS, AUDIO_SAMPLE_RATE,
  audioEnvelopeAt, audioLoopFor, audioLoopFrameAt, audioLoopPositionAt, audioOffset, audioVolume,
  type AudioLoop,
} from './sampling';

export const MAX_AUDIO_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_AUDIO_DURATION = 120;
export const AUDIO_RESUME_TIMEOUT_MS = 3_000;

export class AudioImportError extends Error {
  constructor(readonly kind: 'size' | 'duration' | 'decode' | 'unsupported') {
    super(`Audio import failed: ${kind}`);
    this.name = 'AudioImportError';
  }
}

interface ScheduledSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface PendingResume {
  cancel: () => void;
  transport: boolean;
}

interface PreparedLoop {
  original: AudioBuffer;
  offset: number;
  buffer: AudioBuffer;
}

function filmTime(time: number, duration: number): number {
  return duration > 0 && Number.isFinite(time) ? ((time % duration) + duration) % duration : 0;
}

/** A small Web Audio transport anchored to the context clock, independent of RAF. */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private selection: AudioTrack | null = null;
  private duration = 0;
  private playing = false;
  private disposed = false;
  private revision = 0;
  private anchorTime = 0;
  private anchorFilmTime = 0;
  private nextCycle = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sources = new Set<ScheduledSource>();
  private resumes = new Set<PendingResume>();
  // One selected excerpt only: dragging its offset never accumulates PCM caches.
  private preparedLoop: PreparedLoop | null = null;

  get track(): AudioTrack | null { return this.selection; }

  /** Call directly from a user event, before asynchronous scene preparation. */
  async unlock(): Promise<void> {
    await this.resumeContext(this.ensureContext(), false);
  }

  async importFile(file: File): Promise<{ name: string; buffer: AudioBuffer }> {
    if (file.size > MAX_AUDIO_FILE_BYTES) throw new AudioImportError('size');
    const context = this.ensureContext();
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(await file.arrayBuffer());
    } catch (error) {
      if (error instanceof AudioImportError) throw error;
      throw new AudioImportError('decode');
    }
    if (this.disposed) throw new AudioImportError('unsupported');
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new AudioImportError('decode');
    if (buffer.duration > MAX_AUDIO_DURATION) throw new AudioImportError('duration');
    if (buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2) throw new AudioImportError('unsupported');
    return { name: file.name, buffer };
  }

  setTrack(track: AudioTrack | null, filmDuration: number): void {
    this.pause();
    this.selection = track ? { buffer: track.buffer, offset: audioOffset(track.offset), volume: audioVolume(track.volume) } : null;
    if (!this.selection || this.preparedLoop?.original !== this.selection.buffer || this.preparedLoop.offset !== this.selection.offset) {
      this.preparedLoop = null;
    }
    this.duration = Math.max(0, filmDuration);
  }

  async play(time: number, filmDuration: number): Promise<void> {
    this.pause();
    if (!this.selection || filmDuration <= 0 || this.disposed) return;
    const context = this.ensureContext();
    const revision = this.revision;
    let resumed: boolean;
    try { resumed = await this.resumeContext(context, true); }
    catch (error) {
      // A later user action owns its own transport; this timeout cannot stop it.
      if (revision === this.revision) this.pause();
      throw error;
    }
    if (!resumed) return;
    if (revision !== this.revision || this.disposed || !this.selection) return;
    this.startAt(time, filmDuration);
  }

  pause(): void {
    this.revision++;
    this.playing = false;
    for (const pending of this.resumes) if (pending.transport) pending.cancel();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopSources();
  }

  async seek(time: number, playing: boolean, filmDuration: number): Promise<void> {
    this.pause();
    if (playing) await this.play(time, filmDuration);
  }

  /** Repair actual clock drift without continually rebuilding stable playback. */
  synchronize(time: number, filmDuration: number): void {
    if (!this.playing || !this.context || this.context.state !== 'running' || filmDuration <= 0) return;
    const expected = filmTime(time, filmDuration);
    const actual = filmTime(this.anchorFilmTime + this.context.currentTime - this.anchorTime, this.duration);
    const difference = ((expected - actual + filmDuration * 1.5) % filmDuration) - filmDuration / 2;
    if (Math.abs(difference) > 0.065 || filmDuration !== this.duration) this.startAt(expected, filmDuration);
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
    for (const pending of this.resumes) pending.cancel();
    this.selection = null;
    this.preparedLoop = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  private ensureContext(): AudioContext {
    if (this.disposed) throw new AudioImportError('unsupported');
    if (this.context) return this.context;
    const constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!constructor) throw new AudioImportError('unsupported');
    try { this.context = new constructor({ sampleRate: AUDIO_SAMPLE_RATE }); }
    catch {
      try { this.context = new constructor(); }
      catch { throw new AudioImportError('unsupported'); }
    }
    return this.context;
  }

  private resumeContext(context: AudioContext, transport: boolean): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (resumed: boolean, error?: unknown): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        this.resumes.delete(pending);
        if (error) reject(error);
        else resolve(resumed);
      };
      const pending: PendingResume = { transport, cancel: () => finish(false) };
      this.resumes.add(pending);
      timer = setTimeout(() => finish(false, new Error('Audio context resume timed out')), AUDIO_RESUME_TIMEOUT_MS);
      // Invoke resume synchronously here to retain the originating user gesture.
      try { void context.resume().then(() => finish(true), error => finish(false, error)); }
      catch (error) { finish(false, error); }
    });
  }

  private startAt(time: number, duration: number): void {
    if (!this.context || !this.selection) return;
    this.stopSources();
    if (this.timer !== null) clearInterval(this.timer);
    const loop = audioLoopFor(this.selection.buffer, this.selection.offset);
    // Finish synchronous PCM preparation before anchoring the running clock.
    if (loop && duration > loop.period) this.prepareLoop(this.selection, loop);
    this.duration = duration;
    this.playing = true;
    this.anchorTime = this.context.currentTime;
    this.anchorFilmTime = filmTime(time, duration);
    this.scheduleSegment(this.anchorFilmTime, this.anchorTime);
    this.nextCycle = 0;
    this.scheduleAhead();
    this.timer = setInterval(() => this.scheduleAhead(), 250);
  }

  private scheduleAhead(): void {
    if (!this.playing || !this.context || this.duration <= 0) return;
    const horizon = this.context.currentTime + this.duration;
    const firstBoundary = this.anchorTime + this.duration - this.anchorFilmTime;
    this.nextCycle = Math.max(this.nextCycle, Math.ceil((this.context.currentTime - 0.01 - firstBoundary) / this.duration));
    // Every loop comes directly from the anchor, including after timer suspension.
    while (firstBoundary + this.nextCycle * this.duration <= horizon) {
      this.scheduleSegment(0, firstBoundary + this.nextCycle * this.duration);
      this.nextCycle++;
    }
  }

  private scheduleSegment(time: number, when: number): void {
    const context = this.context;
    const track = this.selection;
    if (!context || !track) return;
    const loop = audioLoopFor(track.buffer, track.offset);
    if (!loop) return;
    const end = this.duration;
    const length = end - time;
    if (length <= 0) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    // The buffer is copied only when this film reaches an audio-loop boundary.
    // Its length is the selected excerpt, never the film's repeated duration.
    if (end > loop.period) {
      source.buffer = this.prepareLoop(track, loop);
      source.loop = true;
      source.loopStart = loop.crossfade;
      source.loopEnd = loop.sourceDuration;
    } else source.buffer = track.buffer;
    source.connect(gain);
    gain.connect(context.destination);
    const scheduled = { source, gain };
    this.sources.add(scheduled);
    source.onended = () => {
      this.sources.delete(scheduled);
      source.disconnect();
      gain.disconnect();
    };
    gain.gain.setValueAtTime(track.volume * audioEnvelopeAt(time, this.duration, loop.sourceDuration), when);
    const crossover = end * AUDIO_ATTACK_SECONDS / (AUDIO_ATTACK_SECONDS + AUDIO_RELEASE_SECONDS);
    const breakpoints = [AUDIO_ATTACK_SECONDS, end - AUDIO_RELEASE_SECONDS, crossover, end]
      .filter(point => point > time && point <= end)
      .sort((a, b) => a - b);
    for (const point of new Set(breakpoints)) {
      gain.gain.linearRampToValueAtTime(track.volume * audioEnvelopeAt(point, this.duration, loop.sourceDuration), when + point - time);
    }
    const offset = source.loop ? audioLoopPositionAt(time, loop) : track.offset + time;
    source.start(when, offset, length);
  }

  private prepareLoop(track: AudioTrack, loop: AudioLoop): AudioBuffer {
    if (this.preparedLoop?.original === track.buffer && this.preparedLoop.offset === track.offset) return this.preparedLoop.buffer;
    const buffer = this.context!.createBuffer(track.buffer.numberOfChannels, loop.sourceFrames, loop.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const original = track.buffer.getChannelData(channel);
      const prepared = buffer.getChannelData(channel);
      for (let frame = 0; frame < loop.sourceFrames; frame++) prepared[frame] = audioLoopFrameAt(original, loop, frame);
    }
    this.preparedLoop = { original: track.buffer, offset: track.offset, buffer };
    return buffer;
  }

  private stopSources(): void {
    for (const { source, gain } of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
      gain.disconnect();
    }
    this.sources.clear();
  }
}
