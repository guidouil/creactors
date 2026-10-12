# Bundled fonts

The editor's built-in display fonts are stored locally so preview, 3D geometry,
and export use the same outlines and work offline. Each font is licensed under
the SIL Open Font License 1.1; the original notices are in `assets/licenses`.

| Font | Runtime source | Weight | Generated asset stem | License |
| --- | --- | --- | --- | --- |
| Barlow Condensed Black | `BarlowCondensed-Black.ttf` | 900 | `barlow-condensed-black` | `BarlowCondensed-OFL.txt` |
| Bungee (CREACTORS Block runtime) | `CREACTORSBlock-Regular.ttf` | 400 | `bungee-regular` | `Bungee-OFL.txt` |
| Black Ops One | `BlackOpsOne-Regular.ttf` | 400 | `black-ops-one-regular` | `BlackOpsOne-OFL.txt` |
| Alfa Slab One | `AlfaSlabOne-Regular.ttf` | 400 | `alfa-slab-one-regular` | `AlfaSlabOne-OFL.txt` |
| Pixel Arcade (derived from Press Start 2P) | `CREACTORSArcade-Regular.ttf` | 400 | `press-start-2p-regular` | `PressStart2P-OFL.txt` |
| Montserrat Bold | `Montserrat-Bold.ttf` | 700 | `montserrat-bold` | `Montserrat-OFL.txt` |

Anton and Bebas Neue sources, generated assets and licenses remain available
for development (Anton also serves as a local font import fixture). They are
excluded from the built-in picker and portable HTML to reduce its size.

The original sources come from the official [Google Fonts repository](https://github.com/google/fonts):
[Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed),
[Bungee](https://github.com/google/fonts/tree/main/ofl/bungee),
[Black Ops One](https://github.com/google/fonts/tree/main/ofl/blackopsone),
[Alfa Slab One](https://github.com/google/fonts/tree/main/ofl/alfaslabone),
[Press Start 2P](https://github.com/google/fonts/tree/main/ofl/pressstart2p),
[Anton](https://github.com/google/fonts/tree/main/ofl/anton),
[Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue), and
[Montserrat](https://github.com/google/fonts/tree/main/ofl/montserrat).

Run `npm run fonts` to regenerate `assets/generated/*.typeface.json` and
`*.coverage.json`, including the unbundled development fonts. The script performs
no network requests, checks each source's
pinned SHA-256, verifies the required French characters, and generates glyph
outlines, metrics, supported codepoints, and kerning pairs. The same source
metadata and hashes are embedded in both generated files.

Montserrat is distributed upstream as a variable font. Its original
`Montserrat-Variable.ttf` is also vendored and hash-checked. The runtime Bold font
is a static instance at `wght=700`, made with the FontTools version pinned in
`scripts/font-requirements.txt`. To reproduce it after installing those tools:

```sh
.font-tools/bin/fonttools varLib.instancer assets/fonts/Montserrat-Variable.ttf wght=700 --static --update-name-table --no-recalc-timestamp --output assets/fonts/Montserrat-Bold.ttf
npm run fonts
```

Keeping the upstream timestamp makes that instance reproducible. Its generated
metadata records the source file's hash, axis value, and instancing command.
The variable source is only used by the build tools; the editor imports the
static font.

Pixel Arcade is derived from the unchanged vendored `PressStart2P-Regular.ttf`.
Its runtime removes the GSUB table so `fi` and `fl` retain their individual
pixel glyphs and advances in the editor, SDF preview and extruded geometry.
The modified font is renamed **CREACTORS Arcade** to respect the source's
reserved font name. Outlines, advances, French accents and original license
notices are preserved. Its 3D meshes disable bevels to keep square pixel edges.
Reproduce the runtime with the same pinned FontTools installation:

```sh
.font-tools/bin/python scripts/prepare-pixel-font.py
npm run fonts
```

The script verifies the upstream SHA-256 and preserves the source timestamp;
generated metadata records both hashes and the transformation. Alfa's converted
outline asset is named **CREACTORS Slab Outlines**; its runtime TTF is unchanged.

Bungee uses a derived **CREACTORS Block** runtime. Troika applies optional
GPOS lookups even when their features are disabled, adding the source's stylistic
and vertical positioning to ordinary horizontal text. The runtime removes only
`ss11`, `ss12` and `vkrn` positioning; horizontal kerning, mark positioning,
GSUB substitutions, outlines and advances are unchanged. Rebuild it with:

```sh
.font-tools/bin/python scripts/prepare-block-font.py
npm run fonts
```

Noto Emoji assets are managed separately by `scripts/prepare-emoji.py` and retain
their existing `NotoEmoji-OFL.txt` license notice.
