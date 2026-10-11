import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_RESUME_TIMEOUT_MS, AudioImportError, AudioPlayer, MAX_AUDIO_FILE_BYTES } from '../src/audio/player';
import { audioEnvelopeAt, audioLoopFor, audioLoopPositionAt, renderAudioChunk } from '../src/audio/sampling';
import type { AudioTrack } from '../src/audio/types';

class MemoryAudioBuffer {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  readonly channels: Float32Array[];
  constructor(options: AudioBufferOptions) {
    this.numberOfChannels = options.numberOfChannels ?? 1;
    this.sampleRate = options.sampleRate;
    this.length = options.length;
    this.duration = this.length / this.sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }
  getChannelData(channel: number) { return this.channels[channel]; }
}

function track(duration = 3, sampleRate = 48_000, channels = 1): AudioTrack {
  const buffer = new MemoryAudioBuffer({ length: duration * sampleRate, numberOfChannels: channels, sampleRate });
  buffer.channels.forEach((channel, index) => channel.fill(index ? -0.5 : 1));
  return { buffer: buffer as unknown as AudioBuffer, offset: 0, volume: 1 };
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  currentTime = 10;
  state = 'running';
  destination = {};
  decoded = track().buffer;
  buffers: AudioBuffer[] = [];
  sources: Array<{ buffer: AudioBuffer | null; loop: boolean; loopStart: number; loopEnd: number; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }> = [];
  gains: Array<{ gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => this.decoded);
  constructor(readonly options: AudioContextOptions) { MockAudioContext.instances.push(this); }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = new MemoryAudioBuffer({ numberOfChannels, length, sampleRate }) as unknown as AudioBuffer;
    this.buffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    const source = { buffer: null, loop: false, loopStart: 0, loopEnd: 0, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(gain);
    return gain;
  }
}

beforeEach(() => {
  MockAudioContext.instances.length = 0;
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.stubGlobal('AudioBuffer', MemoryAudioBuffer);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('absolute-time audio samples', () => {
  it('uses identical 10 ms attack and 80 ms ending release in preview and export', () => {
    expect(audioEnvelopeAt(0, 2, 3)).toBe(0);
    expect(audioEnvelopeAt(0.005, 2, 3)).toBeCloseTo(0.5);
    expect(audioEnvelopeAt(1, 2, 3)).toBe(1);
    expect(audioEnvelopeAt(1.96, 2, 3)).toBeCloseTo(0.5);
    expect(audioEnvelopeAt(2, 2, 3)).toBe(0);
    expect(audioEnvelopeAt(0.96, 2, 1)).toBe(1);
    expect(audioEnvelopeAt(1, 2, 1)).toBe(1);
    expect(audioEnvelopeAt(1, 2, 0)).toBe(0);
  });

  it('keeps an imported excerpt offset and stereo channels while repeating past its end', () => {
    const selection = track(3, 1_000, 2);
    selection.offset = 2;
    selection.volume = 0.5;
    const sampled = renderAudioChunk(selection, 950, 100, 2_000, 1_000);
    expect(sampled).toHaveLength(2);
    expect(sampled[0][0]).toBeCloseTo(0.5);
    expect(sampled[1][0]).toBeCloseTo(-0.25);
    expect([...sampled[0].slice(50)]).toEqual(Array(50).fill(0.5));
    expect([...sampled[1].slice(50)]).toEqual(Array(50).fill(-0.25));
  });

  it('crossfades each selected tail into its start without a silent beat', () => {
    const selection = track(2.5);
    selection.offset = 1;
    const samples = selection.buffer.getChannelData(0);
    for (let frame = 0; frame < samples.length; frame++) samples[frame] = 0.4 + 0.1 * Math.sin(frame * 0.013);
    const loop = audioLoopFor(selection.buffer, selection.offset)!;
    expect(loop).toMatchObject({ crossfade: 0.02, period: 1.48, sourceDuration: 1.5 });
    const seam = renderAudioChunk(selection, loop.periodFrames - 10, loop.crossfadeFrames + 20, 60 * 48_000)[0];
    expect(Math.min(...seam)).toBeGreaterThan(0.25);
    const steps = [...seam.slice(1)].map((sample, index) => Math.abs(sample - seam[index]));
    expect(Math.max(...steps)).toBeLessThan(0.004);
    const late = renderAudioChunk(selection, 58 * 48_000, 48_000, 60 * 48_000)[0];
    expect(Math.min(...late)).toBeGreaterThan(0.25);
    expect(renderAudioChunk(selection, 60 * 48_000 - 1, 1, 60 * 48_000)[0][0]).toBeLessThan(0.001);
  });

  it('is identical across chunk boundaries, repeated cycles and non-native sample rates', () => {
    const selection = track(2.5, 44_100, 2);
    selection.offset = 1.037;
    for (let channel = 0; channel < 2; channel++) {
      const samples = selection.buffer.getChannelData(channel);
      for (let frame = 0; frame < samples.length; frame++) samples[frame] = Math.sin(frame * 0.03 + channel) * 0.7;
    }
    const start = 58 * 48_000 + 337;
    const whole = renderAudioChunk(selection, start, 10_003, 60 * 48_000);
    const chunks = [
      renderAudioChunk(selection, start, 3_337, 60 * 48_000),
      renderAudioChunk(selection, start + 3_337, 6_666, 60 * 48_000),
    ];
    for (let channel = 0; channel < 2; channel++) {
      expect([...chunks[0][channel], ...chunks[1][channel]]).toEqual([...whole[channel]]);
    }
  });

  it('bounds crossfades for tiny excerpts and returns silence for a fully consumed selection', () => {
    const selection = track(1);
    selection.offset = 0.999;
    const loop = audioLoopFor(selection.buffer, selection.offset)!;
    expect(loop.crossfadeFrames).toBe(12);
    expect(loop.periodFrames).toBe(36);
    const sampled = renderAudioChunk(selection, 48_000, 200, 60 * 48_000)[0];
    expect([...sampled].every(sample => Number.isFinite(sample) && sample === 1)).toBe(true);
    selection.offset = 1;
    expect(audioLoopFor(selection.buffer, selection.offset)).toBeNull();
    expect([...renderAudioChunk(selection, 48_000, 200, 60 * 48_000)[0]]).toEqual(Array(200).fill(0));
  });

  it('resamples from absolute positions without accumulating chunk rounding', () => {
    const selection = track(2, 44_100);
    const channel = selection.buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index++) channel[index] = Math.sin(index * 0.07);
    selection.offset = 0.037;
    const whole = renderAudioChunk(selection, 0, 4_800, 48_000)[0];
    const chunks = [0, 1_600, 3_200].map(start => renderAudioChunk(selection, start, 1_600, 48_000)[0]);
    expect([...chunks[0], ...chunks[1], ...chunks[2]]).toEqual([...whole]);
    const position = (selection.offset + 2_401 / 48_000) * 44_100;
    const left = Math.floor(position);
    const expected = channel[left] + (channel[left + 1] - channel[left]) * (position - left);
    expect(whole[2_401]).toBeCloseTo(expected, 6);
  });

  it('clamps amplitude and volume and ignores samples outside the film', () => {
    const selection = track();
    selection.volume = 9;
    selection.buffer.getChannelData(0).fill(4);
    expect(renderAudioChunk(selection, 1_000, 1, 96_000)[0][0]).toBe(1);
    selection.volume = -1;
    expect(renderAudioChunk(selection, 1_000, 1, 96_000)[0][0]).toBe(0);
    selection.volume = 1;
    expect([...renderAudioChunk(selection, -2, 2, 96_000)[0]]).toEqual([0, 0]);
    expect([...renderAudioChunk(selection, 96_000, 2, 96_000)[0]]).toEqual([0, 0]);
    expect(() => renderAudioChunk(selection, 0, -1, 96_000)).toThrow(RangeError);
  });
});

describe('local audio import and transport', () => {
  it('decodes locally at 48 kHz and rejects oversized files before reading', async () => {
    const player = new AudioPlayer();
    const oversized = { size: MAX_AUDIO_FILE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
    await expect(player.importFile(oversized)).rejects.toMatchObject({ kind: 'size' });
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    expect(MockAudioContext.instances).toHaveLength(0);
    const file = new File([new Uint8Array([1, 2])], 'beat.wav', { type: 'audio/wav' });
    const result = await player.importFile(file);
    expect(result.name).toBe('beat.wav');
    expect(MockAudioContext.instances[0].options).toEqual({ sampleRate: 48_000 });
    player.dispose();
  });

  it('reports failed decoding, overlong clips and unsupported multichannel audio', async () => {
    const player = new AudioPlayer();
    const file = new File([], 'music.mp3');
    await player.importFile(file);
    const context = MockAudioContext.instances[0];
    context.decodeAudioData.mockRejectedValueOnce(new Error('Invalid compressed data'));
    await expect(player.importFile(file)).rejects.toMatchObject({ kind: 'decode' });
    context.decoded = track(121).buffer;
    await expect(player.importFile(file)).rejects.toMatchObject({ kind: 'duration' });
    context.decoded = track(1, 48_000, 3).buffer;
    await expect(player.importFile(file)).rejects.toMatchObject({ kind: 'unsupported' });
    player.dispose();
  });

  it('starts at the film position and schedules the next absolute loop boundary', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    const selection = track(12);
    selection.offset = 1;
    selection.volume = 0.6;
    player.setTrack(selection, 4);
    await player.play(2, 4);
    const context = MockAudioContext.instances[0];
    expect(context.sources.map(source => source.start.mock.calls[0])).toEqual([[10, 3, 2], [12, 1, 4]]);
    expect(context.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.6, 10);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 12);
    context.currentTime = 12.3;
    await vi.advanceTimersByTimeAsync(250);
    expect(context.sources[2].start).toHaveBeenCalledWith(16, 1, 4);
    player.pause();
    expect(context.sources.every(source => source.stop.mock.calls.length === 1 && source.disconnect.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('keeps stable audio running and repairs a real seek/drift with matching offset', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    player.setTrack(track(12), 4);
    await player.play(0.5, 4);
    const context = MockAudioContext.instances[0];
    context.currentTime = 10.5;
    player.synchronize(1.02, 4);
    expect(context.sources).toHaveLength(2);
    player.synchronize(2, 4);
    expect(context.sources[2].start).toHaveBeenCalledWith(10.5, 2, 2);
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    await player.seek(3, false, 4);
    expect(vi.getTimerCount()).toBe(0);
    await player.seek(3, true, 4);
    expect(context.sources.at(-2)?.start).toHaveBeenCalledWith(10.5, 3, 1);
    player.dispose();
  });

  it('uses one cached native loop per movie passage and releases it when its excerpt changes', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    const selection = track(2.5, 48_000, 2);
    selection.offset = 1;
    selection.volume = 0.6;
    player.setTrack(selection, 60);
    await player.play(5, 60);
    const context = MockAudioContext.instances[0];
    const loop = audioLoopFor(selection.buffer, selection.offset)!;
    expect(context.buffers).toHaveLength(1);
    expect(context.buffers[0].length).toBe(72_000);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]).toMatchObject({ loop: true, loopStart: 0.02, loopEnd: 1.5 });
    expect(context.sources[0].start).toHaveBeenCalledWith(10, audioLoopPositionAt(5, loop), 55);
    expect(context.sources[1].start).toHaveBeenCalledWith(65, 0, 60);
    expect(context.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 65);
    await player.seek(48, true, 60);
    expect(context.buffers).toHaveLength(1);
    player.setTrack({ ...selection, volume: 0.3 }, 60);
    await player.play(0, 60);
    expect(context.buffers).toHaveLength(1);
    player.setTrack({ ...selection, offset: 0.5 }, 60);
    await player.play(0, 60);
    expect(context.buffers).toHaveLength(2);
    player.pause();
    expect(context.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
  });

  it('cancels a pending resume and old sources when track selection changes', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    await player.importFile(new File([], 'track.wav'));
    const context = MockAudioContext.instances[0];
    let finish!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    player.setTrack(track(), 2);
    const pending = player.play(0, 2);
    player.setTrack(null, 2);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await Promise.resolve();
    expect(context.sources).toHaveLength(0);
    expect(player.track).toBeNull();
    player.dispose();
  });

  it('unlocks synchronously from the user event and survives the preparation pause', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    const unlocking = player.unlock();
    const context = MockAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalledOnce();
    player.pause();
    await unlocking;
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
  });

  it('bounds a stuck resume and never starts audio when its promise eventually resolves', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    await player.importFile(new File([], 'track.wav'));
    const context = MockAudioContext.instances[0];
    let finish!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    player.setTrack(track(), 2);
    const playback = player.play(0.5, 2);
    const rejection = expect(playback).rejects.toThrow('Audio context resume timed out');
    await vi.advanceTimersByTimeAsync(AUDIO_RESUME_TIMEOUT_MS);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(context.sources).toHaveLength(0);
    await player.play(1, 2);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 1, 1);
    player.dispose();
  });

  it('releases unlock timers on dispose without waiting for browser activation', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer();
    await player.importFile(new File([], 'track.wav'));
    const context = MockAudioContext.instances[0];
    context.resume.mockImplementationOnce(() => new Promise<void>(() => {}));
    const unlocking = player.unlock();
    expect(vi.getTimerCount()).toBe(1);
    player.dispose();
    await unlocking;
    expect(vi.getTimerCount()).toBe(0);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('returns a clear unavailable error when Web Audio is absent', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const player = new AudioPlayer();
    await expect(player.importFile(new File([], 'track.wav'))).rejects.toBeInstanceOf(AudioImportError);
    await expect(player.importFile(new File([], 'track.wav'))).rejects.toMatchObject({ kind: 'unsupported' });
  });
});

