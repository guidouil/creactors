# Bundled audio library

All six compact AAC-LC recordings are embedded in the portable HTML and decoded
locally. No runtime request, FFmpeg, or additional audio file is needed on the
FTP server.

| Runtime file | Work / artist | Real source passage | License |
| --- | --- | --- | --- |
| `monkeys-spinning-monkeys.m4a` | Monkeys Spinning Monkeys / Kevin MacLeod | First 16 measures, 26.67 s | CC BY 4.0 |
| `sneaky-snitch.m4a` | Sneaky Snitch / Kevin MacLeod | First 8 measures, 22.07 s | CC BY 4.0 |
| `phonk-time.m4a` | Phonk Time / Play House | 7.5–37.5 s, 30 s | CC0 1.0 |
| `synthwave-house.m4a` | Synthwave House Loop / Fupi | First 12 measures, 25.26 s | CC0 1.0 |
| `oh-no.m4a` | Oh no / user supplied | Complete decoded recording, approximately 18.26 s | User provided |
| `meme-de-creditos-finales.m4a` | Générique de fin / user supplied | Complete decoded recording, approximately 10.18 s | User provided |

The first four passages were extracted from the full, pinned originals, rather
than extending the previous 11–17-second excerpts by copying them. Source URLs,
licenses, original hashes, cues, encoding settings and output hashes are recorded
in `manifest.json`. Licenses were verified again on 10 October 2026 using the
author's Incompetech pages, Free Music Archive and OpenGameArt.

Runtime copies use AAC-LC at a target 96 kb/s, stereo, 44.1 kHz. Licensed passages
have 10 ms anti-click fades at both ends. The two supplied recordings keep their
complete decoded content and have a 10 ms entrance fade. Phonk Time is attenuated
by 8 dB to leave headroom: the official MP3 decodes above full scale.

The six recordings total **1,637,087 bytes**, compared with **1,851,070 bytes**
previously: approximately **11.6% less audio data**, despite increasing the four
licensed excerpts from 57.21 to 104 seconds in total. Base64 embedding contributes
approximately 2.18 MB before HTML compression. These are measured asset sizes;
the full application's HTML size is checked separately at build time.

Playback and export repeat the selected passage when the film outlasts it.
Passage offset and volume remain available; REMIX and photo changes retain them.
The short user-supplied recordings therefore cover longer films without inventing
a new source or storing duplicated audio bytes.

## Credits

`credits.txt` and `src/audio/choices.ts` retain the author, source, license and
processing notices. The in-app dialog provides copyable publication credits for
the two Kevin MacLeod works, which require attribution. CC0 works do not require
attribution; their authors and sources are still acknowledged.

## Archived user-supplied originals

The exact supplied MP3s remain in **`assets/audio-sources/`**, outside runtime
imports and the build's audio-embedding audit. They are not copied into `dist`.
Neither recording is described as public domain or freely licensed.

- `oh-no.mp3`: user attachment `1-oh-no-no-no-tik-tok-song-sound-effect.mp3`,
  supplied on 10 October 2026; 292,861 bytes; MP3 stereo 44.1 kHz; container duration
  approximately 18.29 seconds; SHA-256
  `4218457474baaaa9fd7cc55b905872d3398ff40263202e856717a539b85facb0`.
- `meme-de-creditos-finales.mp3`: user local file
  `/Users/gui/Downloads/meme-de-creditos-finales.mp3`, supplied on 10 October 2026;
  163,821 bytes; MP3 stereo 48 kHz; container duration approximately 10.224 seconds;
  SHA-256 `d0441222c2e0c8d76899754c777c14a2ad548cf1b4cfef460d6af2f4b2c852ed`.

Container durations can include MP3 encoder padding. The compact AAC copies
preserve the full decoded recordings, rather than silence attributed to padding.

## Reproduction

Asset regeneration is a development step, not part of `npm run build`. Obtain
the four original licensed files through the manifest's direct download URLs,
keep their names as specified in the manifest, then run:

```sh
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe \
  node scripts/prepare-audio.mjs --sources /path/to/licensed/originals
```

The script verifies pinned source hashes before encoding. It reads the two
supplied originals from `assets/audio-sources/`, corrects documented iTunes
leading padding, produces the six M4A assets and updates the measured manifest.
The checked-in compact copies are sufficient for normal development and builds.
