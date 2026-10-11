import monkeysDataUrl from '../../assets/audio/monkeys-spinning-monkeys.m4a?inline';
import sneakyDataUrl from '../../assets/audio/sneaky-snitch.m4a?inline';
import phonkDataUrl from '../../assets/audio/phonk-time.m4a?inline';
import synthwaveDataUrl from '../../assets/audio/synthwave-house.m4a?inline';
import ohNoDataUrl from '../../assets/audio/oh-no.m4a?inline';
import endCreditsDataUrl from '../../assets/audio/meme-de-creditos-finales.m4a?inline';
import type { BuiltinAudioId } from './choices';
import type { AudioPlayer } from './player';

const sources = {
  'monkeys-spinning-monkeys': { url: monkeysDataUrl, name: 'monkeys-spinning-monkeys.m4a', type: 'audio/mp4' },
  'sneaky-snitch': { url: sneakyDataUrl, name: 'sneaky-snitch.m4a', type: 'audio/mp4' },
  'phonk-time': { url: phonkDataUrl, name: 'phonk-time.m4a', type: 'audio/mp4' },
  'synthwave-house': { url: synthwaveDataUrl, name: 'synthwave-house.m4a', type: 'audio/mp4' },
  'oh-no': { url: ohNoDataUrl, name: 'oh-no.m4a', type: 'audio/mp4' },
  'meme-de-creditos-finales': { url: endCreditsDataUrl, name: 'meme-de-creditos-finales.m4a', type: 'audio/mp4' },
} satisfies Record<BuiltinAudioId, { url: string; name: string; type: string }>;

// One native decode per player and recording, including concurrent selections.
const decoded = new WeakMap<AudioPlayer, Map<BuiltinAudioId, Promise<AudioBuffer>>>();

/** Decode embedded recording bytes without fetching or creating another context. */
export function loadBuiltinAudio(id: BuiltinAudioId, player: AudioPlayer): Promise<AudioBuffer> {
  let cache = decoded.get(player);
  if (!cache) {
    cache = new Map();
    decoded.set(player, cache);
  }
  const cached = cache.get(id);
  if (cached) return cached;

  const source = sources[id];
  const encoded = source.url.slice(source.url.indexOf(',') + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const file = new File([bytes], source.name, { type: source.type });
  const pending = player.importFile(file).then(({ buffer }) => buffer).catch(error => {
    cache.delete(id);
    throw error;
  });
  cache.set(id, pending);
  return pending;
}

/** Kept for callers selecting the user-provided recording directly. */
export function loadOhNo(player: AudioPlayer): Promise<AudioBuffer> {
  return loadBuiltinAudio('oh-no', player);
}
