import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { builtinAudioTracks, getBuiltinAudio, isBuiltinAudioId } from '../src/audio/choices';
import type { AudioPlayer } from '../src/audio/player';
import { loadBuiltinAudio, loadOhNo } from '../src/audio/recordings';
import manifest from '../assets/audio/manifest.json';
import previousSelection from '../artifacts/audio-candidates/manifest.json';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function playerWith(importFile: ReturnType<typeof vi.fn>): AudioPlayer {
  return { importFile } as unknown as AudioPlayer;
}

describe('bundled recordings', () => {
  it.each(builtinAudioTracks)('decodes the pinned compact AAC bytes and retains the native buffer: $title', async ({ id }) => {
    const buffer = { duration: 15, numberOfChannels: 2 } as AudioBuffer;
    const entry = manifest.tracks.find(track => track.id === id)!;
    const filename = entry.file;
    const importFile = vi.fn(async (_file: File) => ({ name: filename, buffer }));
    const player = playerWith(importFile);
    const pending = loadBuiltinAudio(id, player);
    expect(loadBuiltinAudio(id, player)).toBe(pending);
    expect(await pending).toBe(buffer);
    expect(await loadBuiltinAudio(id, player)).toBe(buffer);
    expect(importFile).toHaveBeenCalledOnce();

    const file = importFile.mock.calls[0][0] as File;
    expect(file.name).toBe(filename);
    expect(file.type).toBe('audio/mp4');
    const original = readFileSync(new URL(`../assets/audio/${filename}`, import.meta.url));
    expect(original.byteLength).toBe(entry.sizeBytes);
    expect(file.size).toBe(entry.sizeBytes);
    // Hashes establish exact identity without constructing a huge failure diff.
    expect(sha256(original)).toBe(entry.sha256);
    expect(sha256(new Uint8Array(await file.arrayBuffer()))).toBe(entry.sha256);
  });

  it.each([
    { id: 'oh-no', bytes: 292861, hash: '4218457474baaaa9fd7cc55b905872d3398ff40263202e856717a539b85facb0' },
    { id: 'meme-de-creditos-finales', bytes: 163821, hash: 'd0441222c2e0c8d76899754c777c14a2ad548cf1b4cfef460d6af2f4b2c852ed' },
  ])('retains the unchanged supplied MP3 outside runtime imports: $id', ({ id, bytes, hash }) => {
    const original = readFileSync(new URL(`../assets/audio-sources/${id}.mp3`, import.meta.url));
    expect(original.byteLength).toBe(bytes);
    expect(sha256(original)).toBe(hash);
    const entry = manifest.tracks.find(track => track.id === id)!;
    expect(entry.sourceSha256).toBe(hash);
    expect(entry.sourceBytes).toBe(bytes);
    expect(entry.file).toBe(`${id}.m4a`);
    expect(entry.selection).toContain('Complete user-supplied recording');
    expect(entry.cue).toBe(0);
    expect(entry.duration).toBeGreaterThan(entry.sourceContainerDuration - 0.06);
  });

  it('ships genuine longer passages from the same pinned sources with less total audio data', () => {
    expect(manifest.tracks.map(track => track.id)).toEqual(builtinAudioTracks.map(track => track.id));
    const bytes = manifest.tracks.reduce((total, track) => total + track.sizeBytes, 0);
    expect(bytes).toBe(manifest.totalBytes);
    expect(bytes).toBeLessThan(1_851_070);
    for (const entry of manifest.tracks) {
      expect(entry).toMatchObject({ codec: 'aac', profile: 'LC', targetBitrate: 96_000, sampleRate: 44_100, channels: 2 });
      expect(entry.sizeBytes / entry.duration).toBeLessThan(13_000);
      if (entry.license === 'user-provided') continue;
      const previous = previousSelection.tracks.find(track => track.id === entry.id)!;
      expect(entry.sourceSha256).toBe(previous.sourceSha256);
      expect(entry.duration).toBeGreaterThanOrEqual(20);
      expect(entry.duration).toBeLessThanOrEqual(30);
      expect(entry.duration).toBeGreaterThan(previous.duration);
      expect(entry.sourceContainerDuration).toBeGreaterThan(entry.cue + entry.duration);
      expect(entry.downloadUrl).toMatch(/^https:\/\//);
    }
  });

  it('keeps decoding caches separate for independent players and recording IDs', async () => {
    const first = vi.fn(async () => ({ buffer: { duration: 18.29 } as AudioBuffer }));
    const second = vi.fn(async () => ({ buffer: { duration: 18.29 } as AudioBuffer }));
    const firstPlayer = playerWith(first);
    const secondPlayer = playerWith(second);
    const firstOhNo = await loadOhNo(firstPlayer);
    const firstMonkeys = await loadBuiltinAudio('monkeys-spinning-monkeys', firstPlayer);
    const secondOhNo = await loadOhNo(secondPlayer);
    expect(firstOhNo).not.toBe(firstMonkeys);
    expect(firstOhNo).not.toBe(secondOhNo);
    expect(await loadBuiltinAudio('oh-no', firstPlayer)).toBe(firstOhNo);
    expect(await loadBuiltinAudio('monkeys-spinning-monkeys', firstPlayer)).toBe(firstMonkeys);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledOnce();
  });

  it('allows retrying a failed recording while retaining other successfully decoded recordings', async () => {
    const buffer = { duration: 18.29 } as AudioBuffer;
    const importFile = vi.fn().mockResolvedValueOnce({ buffer })
      .mockRejectedValueOnce(new Error('Decode failed')).mockResolvedValue({ buffer });
    const player = playerWith(importFile);
    const stable = await loadOhNo(player);
    await expect(loadBuiltinAudio('sneaky-snitch', player)).rejects.toThrow('Decode failed');
    expect(await loadBuiltinAudio('sneaky-snitch', player)).toBe(buffer);
    expect(await loadOhNo(player)).toBe(stable);
    expect(importFile).toHaveBeenCalledTimes(3);
  });
});

describe('audio library credits', () => {
  it('contains six unique recordings and rejects removed synthetic or inherited IDs', () => {
    expect(new Set(builtinAudioTracks.map(track => track.id)).size).toBe(6);
    for (const track of builtinAudioTracks) {
      expect(isBuiltinAudioId(track.id)).toBe(true);
      expect(getBuiltinAudio(track.id)).toBe(track);
    }
    for (const id of ['bounce', 'suspense', 'impact', 'constructor', '__proto__', '']) {
      expect(isBuiltinAudioId(id)).toBe(false);
    }
  });

  it('provides publication-ready attribution, canonical licenses and modification notices', () => {
    const required = builtinAudioTracks.filter(track => track.attributionRequired);
    expect(required.map(track => track.id)).toEqual(['monkeys-spinning-monkeys', 'sneaky-snitch']);
    for (const track of required) {
      expect(track.license).toBe('CC BY 4.0');
      expect(track.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
      expect(track.sourceUrl).toMatch(/^https:\/\/www\.incompetech\.com\//);
      expect(track.credit).toContain(track.title);
      expect(track.credit).toContain('Kevin MacLeod');
      expect(track.credit).toContain(track.licenseUrl!);
      expect(track.credit).toContain('measures extracted');
      expect(track.credit).toContain('10 ms anti-click fades');
      expect(track.credit).toContain('AAC-LC 96 kbps');
      expect(track.credit).toContain('may repeat to cover the video');
    }
    for (const track of builtinAudioTracks.filter(track => track.license === 'CC0 1.0')) {
      expect(track.attributionRequired).toBe(false);
      expect(track.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
      expect(track.credit).toContain(track.title);
      expect(track.credit).toContain(track.sourceUrl!);
    }
  });

  it('does not infer a public license or author for either user-supplied MP3', () => {
    const supplied = builtinAudioTracks.filter(track => track.license === 'user-provided');
    expect(supplied.map(track => track.id)).toEqual(['oh-no', 'meme-de-creditos-finales']);
    for (const track of supplied) {
      expect(track).toMatchObject({
        artist: null, licenseUrl: null, sourceUrl: null, credit: null, attributionRequired: false,
      });
    }
  });
});
