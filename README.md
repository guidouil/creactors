# CREACTORS — Make words move.

CREACTORS turns a sentence or quotation into a deterministic, vertical 3D
kinetic typography film. Enter French or English text, press CREATE, then REMIX
for another choreography or download the resulting video.

Everything runs in the browser. There is no application backend, account,
database or AI API. Creation, local imports and export work offline. Optional
GIPHY search connects directly to GIPHY only when the media picker is opened;
the quotation is never sent to GIPHY. The original text is preserved;
interface language and input language are independent.

## Run and build

```sh
npm ci
npm run dev
npm run build
npm run build:static
```

Development uses TypeScript, Vite, Three.js, Troika Three Text and Mediabunny.
The production interface is ordinary DOM/CSS with inline SVG icons.

GIPHY search uses the official `@giphy/js-fetch-api` Web SDK. Configure its public
Web SDK key in an ignored `.env.local` file, then restart development or rebuild:

```dotenv
VITE_GIPHY_API_KEY=your_giphy_web_sdk_key
```

Create a key in the [GIPHY developer dashboard](https://developers.giphy.com/dashboard/).
The client key is included in the shipped HTML, as required by this browser-only
integration. `.env.example` documents the setting without a real key. With no
key, the media picker retains local import and explains that search is unavailable.

Two distributions are produced:

- `dist/index.html`: one portable file containing application code, fonts,
  outlines, emoji coverage, worker code, shaders, styles, all bundled audio
  recordings and license notices.
  Open it directly in a WebGL2-capable browser, even without a network.
- `dist-static/`: the same self-contained page plus manifest, service worker
  and installation icons. Serve this directory over HTTPS; localhost also
  works for development. After its first successful load, the application can
  reopen offline. Static hosting is sufficient; no server application is needed.

The service worker caches a versioned application shell. Updated builds wait
until existing sessions close, so an installation never replaces an active
preview or export. The relative manifest and scope support hosting in a
subdirectory. Mobile local-file launching and installation menus remain
browser/OS dependent.

`npm run build` prints the measured portable HTML and gzip sizes. The narrow
Vite inliner rejects external chunks/assets, and the build audit rejects leaked
development tools. The audit also verifies that every MP3/M4A in `assets/audio/`
is embedded byte-for-byte. `dist/` contains exactly one file: upload its
`index.html` to the FTP hosting directory. No separate audio directory or local
Downloads file is needed on the server. For installable offline reopening,
upload the complete `dist-static/` distribution instead.
The current complete build measures 4.99 MiB uncompressed and 2722 KiB gzip,
including fonts, six recorded clips and license notices.

## Create, remix and export

On opening, the randomly preloaded example receives its own silent animated
preview, with a fresh seed and palette. The editor remains ready for input;
focusing or changing the draft stops this welcome loop. A reduced-motion
preference shows its readable poster instead. Hiding the page suspends the
welcome loop; returning resumes it only if editing has not begun.
Each CREATE chooses a fresh seed, including when the quotation has not changed. REMIX also
generates another interpretation while retaining the current colors. The last five directions for each quotation
are remembered within the session to avoid recent motion combinations. Playback,
replay and export retain the resolved seed and choreography. The authored film
remains available through its fixed seed in development inspection.

Preview loops continuously. After each phrase has been read, the final
composition settles briefly for 0.4 seconds, then the
physical text objects accelerate through the camera and leave an empty frame
matching the opening. Pause, replay, REMIX, download and theme controls sit below
the portrait stage. Edit reopens the input on mobile without clearing it.
Ctrl/Cmd+Enter also creates a film.

The playback bar supports clicking, dragging and touch to inspect any instant.
Scrubbing pauses the picture and soundtrack during the gesture, then resumes at
the selected time only when the film was already playing. A paused film stays
paused. Arrow keys move one second (Shift: five seconds), Page Up/Down move five
seconds, and Home/End select the beginning/end. The control is unavailable during
scene preparation, media imports and video export.

On phones and tablets, pinch and double-tap gestures keep the interface at its
initial scale. Vertical scrolling remains available, including inside dialogs
and the text editor; horizontal photo and color galleries still scroll normally.

The discreet question-mark button in the header opens a short French/English
help dialog covering text and examples, REMIX, colors, music, up to five final
photos or GIFs and portrait video downloads. It is available before or after generation;
opening it retains the current film. Escape, the close button or a click outside
the dialog closes it and restores keyboard focus. Help is also bundled offline.

The image button opens a final-media picker with local import and GIPHY search.
Search opens on trending GIFs, accepts an explicit search submission, and offers
paginated results in GIPHY's original order. Loading, empty results, missing or
invalid configuration, rate limits and network failures retain local import and
the current film. Closing the picker cancels a pending download. Result cards
show source/creator attribution and the official Powered By GIPHY mark.

The image button adds up to five local photos or animated GIFs, either before
CREATE or beside the playback controls. They appear in selection order after the complete text:
the first approaches in 0.4 seconds during the words' final departure, eliminating
the internal empty pause without changing the reading shots or final text poster.
Each photo approaches from the background, holds briefly, then accelerates through the
camera while the following photo is already approaching behind it. Overlapping
arrivals avoid empty gaps between photos; only the last photo leaves a short
empty frame to preserve the video loop. The first photo receives a full reading
hold after the words have left; subsequent still photos start 1.15 seconds apart.
Each GIF plays for at least one full cycle while settled; longer GIFs extend the
ending and the next media's arrival accordingly. The complete film stays within
60 seconds. Removing individual media updates the ending without regenerating
the typography. REMIX keeps the selected photos and GIFs.

PNG, JPEG, WebP, browser-supported AVIF and GIF files are accepted, up to 16 MiB each.
Images stay on the device and are embedded in the prepared scene. Import retains
orientation, transparency and aspect ratio, downsampling large images to a
maximum edge of 2048 pixels to bound texture memory. Photos fit intact inside the
portrait frame and keep their colors when the theme changes. Preview and video
export evaluate their movements from the same absolute-time scene specification.

GIFs are decoded locally with bundled `gifuct-js`, preserving variable frame
delays, transparency and partial-frame disposal. Their normalized PNG frames use
the film's absolute timeline: seeking selects the same frame, pause freezes the
animation, and MP4/WebM exports include the animation without depending on a
separate browser GIF clock. The gallery shows a static thumbnail with a GIF badge.
GIF imports allow up to 300 frames and 30 seconds per cycle. They are resized to
an edge of at most 1024 pixels and a total decoded frame budget of 32 MiB; input
dimensions, patch decoding (64 megapixels) and full-canvas composition (128
megapixels) are also bounded before frame allocation. Single-frame GIFs use the
normal still-photo hold. A rejected import leaves the existing ending available.

Selecting a GIPHY result downloads its GIF directly from the complete API media
URL, with a timeout and a streamed 16 MiB limit, then runs the same bounded GIF
decoder used for local imports. The prepared frames and source attribution live
only in the current browser session. Search results and media are not written to
local storage, the service-worker cache, a server or a media library. The SDK
uses its own transient request cache and anonymous session identifier. The
selected GIF remains available for playback, seeking, remix and export after
the download, including if the connection is subsequently lost. Search itself
requires Internet access. GIPHY source/creator links remain beside the selection.

GIPHY's [integration requirements](https://developers.giphy.com/docs/api/best-practices/)
require direct client requests, complete unmodified media URLs and attribution;
partner-operated media caching requires their approval. This integration provides
no persistent media cache. The API does not grant a general licence to publish
every returned GIF; users remain responsible for the rights to content in their
exported videos. See the [GIPHY terms](https://support.giphy.com/hc/en-us/articles/360028134111-GIPHY-API-Terms-of-Service).

The text field starts with a randomly selected original example in the browser's
interface language. The dice button offers another: 48 French and 48 English
phrases are bundled, with independent shuffle bags that avoid repetitions until
each list is exhausted. The current interface language determines the next
example. Choosing an example only
updates the draft; CREATE generates its film. Changing interface language leaves
the user's current text intact.

FR/EN in the header changes interface labels. Text language is detected locally
with `franc`, independently of the interface language; there is no second language
selector and the quotation is never translated. Detection is restricted to French
and English. Short or ambiguous samples can remain uncertain. Six palette
families are included: CaliforMandy Sunset, Monochrome, Coral Night, Cobalt,
Orchid and Acid, each with a dark and light variant. The interface and film
follow the operating system's appearance, including live changes. Automatic
colors are enabled initially: CREATE generates a seeded harmony rather
than selecting one of six fixed palettes. REMIX retains the exact current palette,
including automatically generated colors. Hues, saturation, ink luminosity,
backgrounds, accent assignment and conclusion colors vary. Automatic direction
avoids the two most recent families and chooses among sixteen harmonies according
to their perceptual difference from the recent palettes. Faces keep at least
4.8:1 contrast and sidewalls at least 1.6:1. The palette's versioned identifier
reproduces its colors; switching OS appearance retains its chosen harmony.
A swatch locks its family through later
remixes; the two circular arrows restore automatic colors and immediately change
the palette. Changing a palette or OS appearance preserves the choreography
and playback position. Export freezes its resolved palette; an OS change during
encoding applies to the preview after the file is complete. Reduced-motion preferences initially
show the final readable composition; explicit playback still runs the film.

Timing normally falls between 6 and 15 seconds and expands for longer passages,
up to 60 seconds. Input requiring more time receives a localized message rather
than truncation or silent omission. Reading units retain punctuation, apostrophes
and accents; display wrapping does not rewrite the source. Very short phrases
can finish sooner, without added pauses to meet an artificial minimum duration.

The music-note button opens an optional soundtrack panel. Choose Monkeys
Spinning Monkeys, Sneaky Snitch, Phonk Time, Synthwave House Loop, the bundled
user-provided “Oh no” and “Générique de fin” excerpts, or import a local audio
file. These recorded clips replace the earlier generated Bounce, Suspense and
Impact presets. The first four use real 22–30-second passages from the full
original recordings. The supplied clips retain their complete content, about
18.26 and 10.18 seconds respectively, and repeat when needed.

All six runtime recordings use AAC-LC at 96 kb/s and total 1.56 MiB, 11.6% less
than the previous shorter library. Their compressed copies are embedded in the
HTML; exact user-supplied MP3 originals are archived in `assets/audio-sources/`
and do not enter the build. Source URLs, hashes, durations and encoding settings
are recorded in `assets/audio/manifest.json`.
A starting-position slider selects
the passage and a volume slider
sets its level. Imported files remain on the device. The browser decodes supported
MP3/M4A/WAV/OGG and other native formats; invalid formats receive a localized
message while retaining the previous soundtrack. Imports are limited to 32 MiB,
120 seconds, and mono/stereo to bound decoded memory.

Playback, pause, replay and film looping use the same selected passage. When
the selected excerpt is shorter than the film, it repeats automatically from
the chosen starting position, using a short crossfade to avoid clicks and
silence at the join. The same loop is included in the exported video. Each
built-in recording is decoded once per player from its embedded bytes.
The selected passage and volume survive REMIX and photo changes. All six
recordings are included in both distributions and need no network access. Audio selection, offset and
volume leave typography and camera choreography unchanged.

The Audio credits button opens a keyboard-accessible modal listing the composers,
source pages and licenses. Monkeys Spinning Monkeys and Sneaky Snitch are Kevin
MacLeod tracks under CC BY 4.0; their copyable credits include the source, license
link and excerpt changes, for inclusion in the description of a publication.
Phonk Time by Play House and Synthwave House Loop by Fupi are under CC0 1.0.
The supplied Oh no and Générique de fin files are identified as user-provided, with no free-license
claim. Credit copying reports clipboard failures and leaves the text selectable
for manual copying. Credits and notices remain available offline.

Video export uses native WebCodecs and Mediabunny, with actual portrait
configuration checks followed by a disposable encoding/finalization test:

1. H.264 MP4 at 1080×1920, 30 fps, approximately 12 Mbps.
2. H.264 MP4 at 720×1280 when full resolution is unavailable.
3. Genuine VP9 or VP8 WebM at a supported portrait resolution.
4. A clear unavailable state when none of the native encoders succeeds.

The selected format and resolution are displayed during export. WebM files keep
their real extension. Download filenames come from the generated film's original
text, preserve accents, remove filesystem-reserved characters, and are limited to
76 characters including `.mp4` or `.webm`. Editing an ungenerated draft does not
rename the existing film. A resource failure offers a subsequent 720p retry. Export
is frame-by-frame; no real-time recording or FFmpeg/WASM is used. With a soundtrack,
MP4 carries AAC and WebM carries Opus at 48 kHz. Both video and audio must pass
an actual encode/mux smoke check. If selected audio cannot be encoded, export
reports that limitation rather than silently removing it. Bounded audio chunks
share the preview's offset, gain and brief fades, and are interleaved with video
frames to respect muxer backpressure. See [Mediabunny media sources](https://mediabunny.dev/guide/media-sources).
Frames are captured at absolute timestamps with awaited encoder backpressure.
Preview pauses during encoding and is restored afterward. Cancellation,
context loss, stalled progress and repeated exports release resources.

H.264 uses a small native encoder adapter feeding Mediabunny's packet source.
It encodes in quality mode, flushes after at most three frames, restores exact
frame timestamps and verifies that every submitted frame was emitted. This
avoids the macOS Safari encoder queue stall documented in
[WebKit issue 324943](https://bugs.webkit.org/show_bug.cgi?id=324943), without
real-time frame dropping. Each batch begins with a keyframe, so files can be
larger: the validated 12-second desktop files are approximately 6 MB.

WebCodecs requires a suitable secure context and browser encoder. A local HTML
file is feature-detected; opening it does not guarantee video export. Export can
run slower than real time. Output remains in memory until downloaded, so a
60-second file can still exceed available resources on some phones. Actual
Safari 27.0.1 on macOS has passed an actual silent 1080p MP4 download. On
2026-10-10, the user also confirmed successful MP4 generation on real iPhone
and iPad devices. Native Safari soundtrack export remains to be confirmed.

## Typography and local direction

Most phrases are sharp world-space Troika SDF text. Selected semantic anchors
use shallow extrusion from the same bundled Barlow Condensed Black outlines,
providing visible sidewalls and real depth. Geometry, typography and shaders
are prepared before playback; a frame never reshapes the quotation.

`TextDirector` uses a versioned Unicode scanner, `franc` language detection and
small French/English rules. The scanner owns final source spans so browser segmentation
data does not change a saved specification. Reading groups have a strict maximum
of four words and normally contain two or three. Long or visually dense words
favor shorter groups; short connected expressions can retain four. A deterministic
partition balances punctuation, estimated width, emphasis and grammatical ties,
keeping recognized articles, auxiliary/verb combinations and short negations
together where possible. Two or more consecutive spaces between words force a
group boundary, overriding grammatical ties while preserving the original source.
Automatic compact grouping still applies within each passage. Longer scopes are distributed across compact groups
without altering or omitting the source. Scores separate linguistic, narrative, visual, readability and
composition signals. This is practical local analysis, not a complete grammar
parser. `franc` operates on the original text using its bundled character trigrams;
its scores are relative distances, not statistical confidence probabilities.
The detector does not change grouping rules or source text. Explicit language
overrides remain available only to development inspection and internal tests.
No downloadable model, language-detection request or AI API is used.

`MotionDirector` consumes measured groups and independently combines seeded
spatial layouts, entries, camera journeys, reveals and physical finales.
Transitions can use wider orbital arcs, whip-like travel, camera rolls and
rotating typography. Finales include twisting, staggered and diverging launches,
with a short damped landing impact before the stable poster hold. Rotations and
recoil settle before reading intervals; text stays still while it is being read.
The underlying vocabulary remains DEPTH, ORBIT, HOLD, occasional rhetorical CUT,
and a final REVEAL. Eligible
sequences can include a real PORTAL or a bounded three-plane TUNNEL. PORTAL
selection inspects closed counters in the actual font geometry and checks
clearance for the camera's near-frustum corners through the extruded slab;
character identity alone never enables a portal. Emoji are excluded from portal
geometry. Reading holds use conservative projected safe margins.

The grammar combines eight spatial layouts, five entrance treatments, six
camera travel styles, four reveals and five finales. A full camera revolution
is limited to one deliberate event per film and remains anchored on visible
typography. Moving reveals track the actual assembling conclusion. Final
choices include a vortex, staggered punches, a fan-out, a converging slam and a
straight rush, all ending on the matching empty loop frame.

Random choices occur during direction, using separate named seed streams.
CREATE obtains a new seed from browser entropy; subsequent decisions are fully
deterministic. REMIX changes the seed and checks structural and discrete motion
choices so a palette change or small positional jitter cannot count as a remix.
`SceneSpec` stores resolved language,
versions, original text, layouts, reading intervals and camera tracks. Absolute
state evaluation gives the same transforms at a timestamp regardless of seeking
or playback history. GPU pixels and encoded file bytes can vary across devices.

## Bundled emoji and fonts

Emoji render as monochrome shapes tinted by the selected theme. Noto Emoji is
instanced at weight 700 and embedded as a 471,848-byte WOFF2. Build-time HarfBuzz
shaping verifies complete sequences, including joiners, modifiers, flags,
keycaps and variation selectors. Verified sequences map directly to the bundled
outline through private-use font codepoints, avoiding browser emoji font
substitution without changing the input. The pinned Unicode 18 fixture yields 5,051
accepted sequences and 184 uncovered sequences for this font version.

Uncovered emoji are reported before generation; no operating-system fallback
silently substitutes a different shape or breaks a joined sequence into parts.
This is explicit versioned coverage, not support for every current or future
emoji. Emoji alpha textures are prepared once from the bundled face and placed
inline in the spatial scene.

Barlow assets are checked in with their source fingerprint, coverage, kerning
and generated outlines. Regenerate them with:

```sh
npm run fonts
python3 -m venv .font-tools
.font-tools/bin/pip install -r scripts/font-requirements.txt
.font-tools/bin/python scripts/prepare-emoji.py
```

FontTools, HarfBuzz and Brotli are pinned build-time tools only. None ships as
runtime code. Font source and OFL licenses are vendored; JavaScript license
notices, including Mediabunny's MPL notice, are retained in the production HTML.

## Development inspection

Open `/?inspect=1` during development for absolute-time scrubbing, seed selection,
analysis/grouping scores, scene hierarchy, camera paths, text bounds, frame
capture and rendering measurements. Inspector controls and their imports are
removed from production. PNG capture is a development aid, not a product export
fallback.

The pipeline remains explicit:

```text
src/text/         lossless segmentation, protected spans, emphasis scores
src/typography/   measured wrapping, SDF, outlines, portals, emoji
src/direction/    seeded spatial grammar and timing
src/scene/        serializable specification, evaluator, Three.js renderer
src/export/       native codec capabilities, progress guard, encoding
src/audio/        recorded library, credits, local decoding, synchronized sampling
src/image/        bounded local photos/GIF decoding and absolute-time frame selection
src/themes/       palette roles and contrast
src/app/          minimal DOM interface and centralized FR/EN strings
src/demos/        approved authored reference film
src/dev/          development-only inspection
assets/           pinned fonts, generated coverage/outlines and licenses
scripts/          asset preparation, packaging and artifact validation
```

Preview uses a 540×960 drawing buffer independently of device pixel ratio.
Export temporarily changes rendering resolution while preserving the same
scene specification and projection. Hidden previews suspend playback.

## Hidden studio

Twenty easter eggs are bundled offline: fourteen miniature interface scenes
and six secret film directions. The first discovery reveals a small collection
button in the footer. Its bilingual notebook keeps discoveries for the current
session, offers clues for the remaining secrets, and can replay discovered scenes.
Interface scenes run outside the video canvas; secret film directions use the
normal absolute-time renderer and are included in video downloads.

Try five clicks/taps on the CREACTORS name, hold the logo's sun or the example
dice, or tap the footer copyright three times. Long presses also accept
Shift+Enter on a focused control. A short normal click retains its usual action;
dragging, scrolling or cancelling a press does not count as a discovery.
Hidden gestures are suspended while preparing a film, importing media or
exporting. Dialogs support Escape, backdrop dismissal and focus restoration;
reduced-motion preferences show still versions of the miniature scenes.

The six complete phrases below trigger exportable secret directions on CREATE.
Case, accents, apostrophe variants, surrounding whitespace and final punctuation
do not affect discovery. Ordinary quotations containing these words keep their
usual direction. REMIX retains the secret while choosing a fresh choreography.

| Secret | French phrase | English phrase |
| --- | --- | --- |
| Gravity | La gravité est une suggestion. | Gravity is a suggestion. |
| Boomerang | Les mots reviennent toujours. | Words always come back. |
| Vertigo | Les mots ont le vertige. | Words are feeling dizzy. |
| Tunnel | Il y a un monde derrière les lettres. | There is a world behind the letters. |
| Supernova | Une petite phrase peut devenir une supernova. | A little sentence can become a supernova. |
| Seventh face | Même le hasard cache quelque chose. | Even chance is hiding something. |

## Validation

```sh
npm test
npm run typecheck
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
npm run build:static
node scripts/check-portable.mjs
npm run test:offline
```

With a configured SDK key, opt into live GIPHY checks:

```sh
CREACTORS_GIPHY_LIVE=1 PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- --grep 'live GIPHY'
CREACTORS_GIPHY_LIVE=1 PLAYWRIGHT_CHANNEL=chrome node scripts/check-portable.mjs
```

Normal browser tests mock GIPHY and never use the configured key. The optional
portable check searches GIPHY from the built local HTML, adds an animated GIF
and verifies the extended video export.

If Chrome is not installed, install Playwright Chromium and run browser tests
without `PLAYWRIGHT_CHANNEL`. Artifact scripts default to installed Chrome;
portable, offline and export checks accept the same channel environment variable.

Tests cover the ten French/English reference quotations across 20 seeds,
lossless source partitioning, apostrophes/accents, protected negations,
deterministic seeking, meaningful remix variation, eligible portal geometry,
bounded tunnels, readable projected bounds, duration limits and theme contrast.
Browser checks cover the silent animated example on arrival, reduced-motion
posters, editing and visibility interruption, CREATE during font preparation,
free input, automatic text-language detection independent of the UI, accessible
pointer/keyboard scrubbing with synchronized playback, mobile layout,
random palette variety, manual palette retention, live OS appearance and
palette stability during export, animated GIF timing, transparency and disposal,
decoded GIF preview/export agreement, keyboard focus, loop continuity, WebGL recovery, export cancellation and the
absence of external runtime requests before an explicit GIPHY interaction. The static-app check exercises deployment
under `/studio/`, offline reopening and delayed service-worker updates.

For visual contact sheets and native media validation against a running
development server:

```sh
node scripts/inspect-demo.mjs
node scripts/inspect-generated.mjs http://127.0.0.1:5173/ 20
node scripts/inspect-variety.mjs http://127.0.0.1:5173/ 12
node scripts/export-smoke.mjs http://127.0.0.1:5173/ 12,30,60
CREACTORS_EXPORT_WEBM=1 node scripts/export-smoke.mjs http://127.0.0.1:5173/ 12
CREACTORS_EXPORT_720=1 node scripts/export-smoke.mjs http://127.0.0.1:5173/ 12
node scripts/export-variety-smoke.mjs http://127.0.0.1:5173/ 5
```

Set `CREACTORS_PREVIEW_URL` or pass the server URL when the port differs. Artifacts
are saved under `artifacts/`. The current build passes 222 unit tests. The browser
suite contains 72 cases (71 regular cases and one optional live GIPHY check),
including demand-driven GIPHY search, pagination, source attribution, missing-key
local import, retry, cancellation and focus restoration, GIF import/composition, mixed photo/GIF endings,
absolute-time animation and decoded GIF video frames, automatic text-language detection, pointer,
touch and keyboard seeking, touch zoom prevention with scrolling, the animated
welcome, brief final posters, all six recorded soundtracks, bilingual
credits and clipboard fallback, decoded Monkeys/Oh no/Générique de fin AAC waveforms,
native preview/export sample agreement over 60 seconds and repeated music in long MP4s,
generated color variety, appearance round trips and palette stability during encoding,
ordered final photos, direct text-to-photo transitions, overlapping arrivals without empty handoffs and their decoded MP4
frames, compact reading groups, bilingual example selection, portable filename
limits, fresh CREATE seeds, recent-direction
avoidance and exact reconstruction from a saved seed. Projected unit checks cover
the ten quotations across 20 seeds, and actual renderer checks pass on 55
bilingual/emoji scenes. A separate 12-seed visual review verifies visible
rotations/reveals, safe reading frames and matching blank loop endpoints, with
no unintended movement gap longer than 0.1 seconds. The portable HTML also passes free
input, complete emoji, REMIX, themes and MP4 export with external networking
blocked. Native Chrome exports at 12, 30 and 60 seconds have
passed container/frame-count checks and decoded-frame comparison. A final
13.4-second scene with full rotation, impacts and vortex departure passes MP4
and WebM frame-count, exact-state and decoded-pixel checks (402 frames).
Native macOS
Safari 27.0.1 has passed a 24-frame encoding check and a complete 12-second
1080×1920 MP4 download; the saved file contains exactly 360 frames at 30 fps
with exact frame timestamps. Its report is in
`artifacts/safari/native-export-metadata.json`. The user confirmed successful
MP4 generation on real iPhone and iPad devices on 2026-10-10. Device models,
browser versions, export durations and soundtrack use were not specified;
broader performance and memory coverage remains open. Automated constraints
supplement visual review; they cannot establish cinematic quality by themselves.

`node scripts/inspect-themes.mjs` captures all twelve manual palette variants,
sixteen generated automatic posters, and the
desktop/mobile interface in both appearances. The review checks 44-pixel
controls, document overflow, labels, external requests and effective UI contrast;
its screenshots and report are in `artifacts/themes/`.

`node scripts/export-audio-smoke.mjs` checks actual AAC/Opus tracks, stereo and
mono, excerpt offsets, decoded levels, automatic repetition of short sources, exact
container duration and preview restoration. Twelve- and sixty-second MP4/WebM
have passed in native Chrome, including audible music through multiple excerpt
repetitions; reports and files are in
`artifacts/audio/`. Browser UI checks also decode a downloaded excerpt to verify
its selected frequency/volume and repeated waveform. Original music, playback
activation, pending-resume cancellation, import failures and compact mobile
audio controls are covered. Audio encoding in native macOS Safari and on
iPhone/iPad remains unverified.

The cached Firefox and WebKit automation builds on this host failed before
opening an application page: Firefox was denied macOS sandbox access and WebKit
page creation stalled. These are environment limitations, not verified rendering
or codec failures. Their results are retained in `artifacts/compatibility/`;
Firefox compatibility and broader Safari/iOS performance coverage remain to be
checked on working native browsers and representative hardware. The user's
successful iPhone/iPad MP4 tests are recorded separately above.
