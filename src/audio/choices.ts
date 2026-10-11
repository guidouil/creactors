interface AudioCredit {
  id: string;
  title: string;
  artist: string | null;
  license: 'CC BY 4.0' | 'CC0 1.0' | 'user-provided';
  licenseUrl: string | null;
  sourceUrl: string | null;
  attributionRequired: boolean;
  credit: string | null;
}

// Titles and authors are work metadata, independent of the interface language.
// Longer passages come from the pinned originals; all runtime copies use compact AAC.
export const builtinAudioTracks = [
  {
    id: 'monkeys-spinning-monkeys',
    title: 'Monkeys Spinning Monkeys',
    artist: 'Kevin MacLeod',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011',
    attributionRequired: true,
    credit: 'Monkeys Spinning Monkeys — Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License. https://creativecommons.org/licenses/by/4.0/ First 16 measures extracted (26.67 seconds); 10 ms anti-click fades; re-encoded to AAC-LC 96 kbps. The passage may repeat to cover the video.',
  },
  {
    id: 'sneaky-snitch',
    title: 'Sneaky Snitch',
    artist: 'Kevin MacLeod',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1100772',
    attributionRequired: true,
    credit: 'Sneaky Snitch — Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License. https://creativecommons.org/licenses/by/4.0/ First 8 measures extracted (22.07 seconds); 10 ms anti-click fades; re-encoded to AAC-LC 96 kbps. The passage may repeat to cover the video.',
  },
  {
    id: 'phonk-time',
    title: 'Phonk Time',
    artist: 'Play House',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://freemusicarchive.org/music/play-house/single/phonk-time/',
    attributionRequired: false,
    credit: 'Phonk Time — Play House. CC0 1.0. https://freemusicarchive.org/music/play-house/single/phonk-time/ Excerpt from 7.5 to 37.5 seconds; 8 dB attenuation for headroom; 10 ms anti-click fades; re-encoded to AAC-LC 96 kbps. The passage may repeat to cover the video.',
  },
  {
    id: 'synthwave-house',
    title: 'Synthwave House Loop',
    artist: 'Fupi',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://opengameart.org/content/synthwave-house-loop',
    attributionRequired: false,
    credit: 'Synthwave House Loop — Fupi. CC0 1.0. https://opengameart.org/content/synthwave-house-loop First 12 measures extracted (25.26 seconds); 10 ms anti-click fades; re-encoded to AAC-LC 96 kbps. The passage may repeat to cover the video.',
  },
  {
    id: 'oh-no',
    title: 'Oh no',
    artist: null,
    license: 'user-provided',
    licenseUrl: null,
    sourceUrl: null,
    attributionRequired: false,
    credit: null,
  },
  {
    id: 'meme-de-creditos-finales',
    title: 'Générique de fin',
    artist: null,
    license: 'user-provided',
    licenseUrl: null,
    sourceUrl: null,
    attributionRequired: false,
    credit: null,
  },
] as const satisfies readonly AudioCredit[];

export type BuiltinAudioId = typeof builtinAudioTracks[number]['id'];
export type BuiltinAudioTrack = typeof builtinAudioTracks[number];

export function isBuiltinAudioId(id: string): id is BuiltinAudioId {
  return builtinAudioTracks.some(track => track.id === id);
}

export function getBuiltinAudio(id: BuiltinAudioId): BuiltinAudioTrack {
  const track = builtinAudioTracks.find(candidate => candidate.id === id);
  if (!track) throw new RangeError(`Unknown built-in audio: ${id}`);
  return track;
}
