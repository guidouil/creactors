import type { AudioTrack } from './types';

export type { AudioTrack, AudioSelection } from './types';

export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_ATTACK_SECONDS = 0.01;
export const AUDIO_RELEASE_SECONDS = 0.08;
export const AUDIO_CROSSFADE_SECONDS = 0.02;

export interface AudioLoop {
  offset: number;
  sampleRate: number;
  sourceDuration: number;
  sourceFrames: number;
  crossfade: number;
  crossfadeFrames: number;
  period: number;
  periodFrames: number;
}

export function audioVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
}

export function audioOffset(offset: number): number {
  return Number.isFinite(offset) ? Math.max(0, offset) : 0;
}

/** Frame-aligned loop points keep native playback and export on the same clock. */
export function audioLoopFor(buffer: AudioBuffer, requestedOffset: number): AudioLoop | null {
  const offset = audioOffset(requestedOffset);
  const sampleRate = buffer.sampleRate;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const sourceFrames = Math.floor(Math.max(0, buffer.duration - offset) * sampleRate + 1e-7);
  if (!Number.isSafeInteger(sourceFrames) || sourceFrames < 1) return null;
  // Tiny selected excerpts still loop without an overlap consuming the whole clip.
  const crossfadeFrames = Math.min(Math.round(AUDIO_CROSSFADE_SECONDS * sampleRate), Math.floor(sourceFrames / 4));
  const periodFrames = sourceFrames - crossfadeFrames;
  return {
    offset, sampleRate, sourceFrames, crossfadeFrames, periodFrames,
    sourceDuration: sourceFrames / sampleRate,
    crossfade: crossfadeFrames / sampleRate,
    period: periodFrames / sampleRate,
  };
}

/** Shared by native preview gain automation and frame-by-frame audio export. */
export function audioEnvelopeAt(time: number, filmDuration: number, sourceDuration: number): number {
  if (!Number.isFinite(time) || time < 0 || time >= filmDuration || filmDuration <= 0 || sourceDuration <= 0) return 0;
  return Math.max(0, Math.min(1, time / AUDIO_ATTACK_SECONDS, (filmDuration - time) / AUDIO_RELEASE_SECONDS));
}

function sourceSampleAt(samples: Float32Array, position: number): number {
  const frame = Math.floor(position);
  if (frame < 0 || frame >= samples.length) return 0;
  const left = samples[frame];
  const right = samples[Math.min(frame + 1, samples.length - 1)];
  return left + (right - left) * (position - frame);
}

/**
 * The prepared native buffer contains the unchanged intro, then a 20 ms blend
 * from its tail into the selected start. Looping resumes just after that blend.
 */
export function audioLoopFrameAt(samples: Float32Array, loop: AudioLoop, frame: number): number {
  const sourceStart = loop.offset * loop.sampleRate;
  if (frame < loop.periodFrames || loop.crossfadeFrames === 0) {
    return Math.fround(sourceSampleAt(samples, sourceStart + frame));
  }
  const blendFrame = frame - loop.periodFrames;
  const blend = blendFrame / loop.crossfadeFrames;
  const tail = sourceSampleAt(samples, sourceStart + frame);
  const head = sourceSampleAt(samples, sourceStart + blendFrame);
  return Math.fround(tail * (1 - blend) + head * blend);
}

/** Native buffer offset at an absolute film time; never accumulates deltas. */
export function audioLoopPositionAt(time: number, loop: AudioLoop): number {
  const position = Math.max(0, time) * loop.sampleRate;
  if (position < loop.sourceFrames) return position / loop.sampleRate;
  const wrapped = loop.crossfadeFrames + (position - loop.sourceFrames) % loop.periodFrames;
  return wrapped / loop.sampleRate;
}

/** Resample precisely the same prepared cyclic buffer used by Web Audio. */
export function audioSampleAt(samples: Float32Array, loop: AudioLoop, time: number): number {
  const position = audioLoopPositionAt(time, loop) * loop.sampleRate;
  const frame = Math.floor(position);
  const fraction = position - frame;
  const next = frame + 1 < loop.sourceFrames ? frame + 1 : loop.crossfadeFrames;
  const left = audioLoopFrameAt(samples, loop, frame);
  const right = audioLoopFrameAt(samples, loop, next);
  return left + (right - left) * fraction;
}

/** Sample one bounded chunk at absolute film positions, repeating the excerpt. */
export function renderAudioChunk(
  track: AudioTrack,
  startFrame: number,
  frameCount: number,
  totalFrames: number,
  sampleRate = AUDIO_SAMPLE_RATE,
): Float32Array[] {
  if (!Number.isSafeInteger(frameCount) || frameCount < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Invalid audio chunk dimensions');
  }
  const channels = Math.min(2, Math.max(1, track.buffer.numberOfChannels));
  const output = Array.from({ length: channels }, () => new Float32Array(frameCount));
  const loop = audioLoopFor(track.buffer, track.offset);
  if (!loop) return output;
  const sourceChannels = output.map((_, channel) => track.buffer.getChannelData(channel));
  const volume = audioVolume(track.volume);
  const filmDuration = Math.max(0, totalFrames) / sampleRate;
  const repeats = filmDuration > loop.period;
  for (let frame = 0; frame < frameCount; frame++) {
    const absoluteFrame = startFrame + frame;
    if (absoluteFrame < 0 || absoluteFrame >= totalFrames) continue;
    const time = absoluteFrame / sampleRate;
    const gain = volume * audioEnvelopeAt(time, filmDuration, loop.sourceDuration);
    if (!gain) continue;
    for (let channel = 0; channel < channels; channel++) {
      const sample = repeats
        ? audioSampleAt(sourceChannels[channel], loop, time)
        : sourceSampleAt(sourceChannels[channel], (loop.offset + time) * loop.sampleRate);
      output[channel][frame] = Math.max(-1, Math.min(1, sample * gain));
    }
  }
  return output;
}
