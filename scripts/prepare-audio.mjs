// Development-only asset preparation. No encoder or source downloads ship in the app.
// FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe node scripts/prepare-audio.mjs --sources /path/to/originals
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFlag = process.argv.indexOf('--sources');
if (sourceFlag === -1 || !process.argv[sourceFlag + 1]) {
  throw new Error('Pass --sources /path/to/the/four/licensed/originals. User-supplied originals are read from assets/audio-sources.');
}
const sourceDirectory = resolve(process.argv[sourceFlag + 1]);
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE ?? 'ffprobe';
const outputDirectory = join(root, 'assets/audio');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
};
const probe = file => JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));

const tracks = [
  {
    id: 'monkeys-spinning-monkeys', title: 'Monkeys Spinning Monkeys', artist: 'Kevin MacLeod',
    sourceFile: 'monkeys-spinning-monkeys.mp3',
    sourceUrl: 'https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011',
    downloadUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Monkeys%20Spinning%20Monkeys.mp3',
    sourceSha256: 'a5bb345c23849ad0786aa0bc5157a9f2d4039660fe00282e55754d475f36dc14',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    cue: 0, duration: 64 * 60 / 144, sourceLeadingSamples: 528, sourceSampleRate: 44100,
    selection: 'First 16 measures at 144 BPM', gainDb: 0,
  },
  {
    id: 'sneaky-snitch', title: 'Sneaky Snitch', artist: 'Kevin MacLeod',
    sourceFile: 'sneaky-snitch.mp3',
    sourceUrl: 'https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1100772',
    downloadUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3',
    sourceSha256: 'db1710333d68a215277f77e4e17e1a64bf4ed38f87c70f8d0f56b16b6aa4f884',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    cue: 0, duration: 32 * 60 / 87, sourceLeadingSamples: 528, sourceSampleRate: 44100,
    selection: 'First 8 measures at 87 BPM', gainDb: 0,
  },
  {
    id: 'phonk-time', title: 'Phonk Time', artist: 'Play House',
    sourceFile: 'phonk-time.mp3',
    sourceUrl: 'https://freemusicarchive.org/music/play-house/single/phonk-time/',
    downloadUrl: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/guYbvdpC3UIp9rqPyVZ9cQYq6vEENSQsr4KYoqIb.mp3',
    sourceSha256: 'ed2f9bf87ffb0d6aced541e72e19e31f268236fc804aa108b6240ad9ace2f84e',
    license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    cue: 7.5, duration: 30, sourceLeadingSamples: 0, sourceSampleRate: 48000,
    selection: 'Passage from 7.5 to 37.5 seconds; 128 BPM estimated from audio, not author metadata', gainDb: -8,
  },
  {
    id: 'synthwave-house', title: 'Synthwave House Loop', artist: 'Fupi',
    sourceFile: 'synthwave-house.wav',
    sourceUrl: 'https://opengameart.org/content/synthwave-house-loop',
    downloadUrl: 'https://opengameart.org/sites/default/files/synthwavehouse.wav',
    sourceSha256: '5d3bacaf3c1807540665c01735e44126da485d0e4800c168227ebf5a7892e230',
    license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    cue: 0, duration: 48 * 60 / 114, sourceLeadingSamples: 0, sourceSampleRate: 44100,
    selection: 'First 12 measures at 114 BPM', gainDb: 0,
  },
  {
    id: 'oh-no', title: 'Oh no', artist: null, sourceFile: 'oh-no.mp3',
    sourceUrl: null, downloadUrl: null,
    sourceSha256: '4218457474baaaa9fd7cc55b905872d3398ff40263202e856717a539b85facb0',
    license: 'user-provided', licenseUrl: null,
    cue: 0, duration: null, sourceLeadingSamples: 0, sourceSampleRate: 44100,
    selection: 'Complete user-supplied recording, not a longer replacement', gainDb: 0,
  },
  {
    id: 'meme-de-creditos-finales', title: 'Générique de fin', artist: null, sourceFile: 'meme-de-creditos-finales.mp3',
    sourceUrl: null, downloadUrl: null,
    sourceSha256: 'd0441222c2e0c8d76899754c777c14a2ad548cf1b4cfef460d6af2f4b2c852ed',
    license: 'user-provided', licenseUrl: null,
    cue: 0, duration: null, sourceLeadingSamples: 0, sourceSampleRate: 48000,
    selection: 'Complete user-supplied recording, not a longer replacement', gainDb: 0,
  },
];

mkdirSync(outputDirectory, { recursive: true });
const measured = [];
for (const track of tracks) {
  const source = join(track.license === 'user-provided' ? join(root, 'assets/audio-sources') : sourceDirectory, track.sourceFile);
  if (!existsSync(source)) throw new Error(`Missing original: ${source}`);
  if (sha256(readFileSync(source)) !== track.sourceSha256) throw new Error(`Unexpected source hash: ${source}`);
  const original = probe(source);
  const start = track.cue + track.sourceLeadingSamples / track.sourceSampleRate;
  const filters = [`atrim=start=${start}${track.duration === null ? '' : `:duration=${track.duration}`}`, 'asetpts=PTS-STARTPTS'];
  if (track.gainDb) filters.push(`volume=${track.gainDb}dB`);
  filters.push('afade=t=in:st=0:d=0.01');
  if (track.duration !== null) filters.push(`afade=t=out:st=${track.duration - 0.01}:d=0.01`);
  const file = `${track.id}.m4a`;
  const output = join(outputDirectory, file);
  run(ffmpeg, ['-v', 'error', '-y', '-i', source, '-vn', '-map_metadata', '-1', '-af', filters.join(','),
    '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '96k', '-movflags', '+faststart', output]);
  const encoded = probe(output);
  const stream = encoded.streams.find(candidate => candidate.codec_type === 'audio');
  const result = {
    ...track, file, sourceBytes: statSync(source).size, sourceContainerDuration: Number(original.format.duration),
    duration: Number(stream.duration), codec: stream.codec_name, profile: stream.profile,
    sampleRate: Number(stream.sample_rate), channels: stream.channels, targetBitrate: 96000,
    measuredBitrate: Number(stream.bit_rate), sizeBytes: statSync(output).size,
    sha256: sha256(readFileSync(output)),
    processing: 'Trim source passage; correct documented iTunes leading padding where present; 10 ms entrance/exit anti-click fades for licensed passages; AAC-LC 96 kb/s stereo 44.1 kHz. User recordings keep their complete decoded content, with a 10 ms entrance fade.',
  };
  measured.push(result);
  console.log(`${track.title}: ${result.duration.toFixed(3)} s, ${(result.sizeBytes / 1024).toFixed(1)} KiB`);
}
const totalBytes = measured.reduce((sum, track) => sum + track.sizeBytes, 0);
writeFileSync(join(outputDirectory, 'manifest.json'), `${JSON.stringify({
  version: '2026-10-long-audio-1', verifiedAt: '2026-10-10',
  encoder: run(ffmpeg, ['-version']).split('\n')[0],
  packaging: 'Only the six generated M4A assets are imported into the HTML. Archived source MP3s are not runtime resources.',
  totalBytes, estimatedBase64Bytes: Math.ceil(totalBytes / 3) * 4, tracks: measured,
}, null, 2)}\n`);
console.log(`Total audio: ${(totalBytes / 1024).toFixed(1)} KiB before HTML embedding.`);
