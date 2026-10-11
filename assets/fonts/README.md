# Bundled fonts

The editor's built-in display fonts are stored locally so preview, 3D geometry,
and export use the same outlines and work offline. Each font is licensed under
the SIL Open Font License 1.1; the original notices are in `assets/licenses`.

| Font | Runtime source | Weight | Generated asset stem | License |
| --- | --- | --- | --- | --- |
| Barlow Condensed Black | `BarlowCondensed-Black.ttf` | 900 | `barlow-condensed-black` | `BarlowCondensed-OFL.txt` |
| Anton Regular | `Anton-Regular.ttf` | 400 | `anton-regular` | `Anton-OFL.txt` |
| Bebas Neue Regular | `BebasNeue-Regular.ttf` | 400 | `bebas-neue-regular` | `BebasNeue-OFL.txt` |
| Montserrat Bold | `Montserrat-Bold.ttf` | 700 | `montserrat-bold` | `Montserrat-OFL.txt` |

The original sources come from the official [Google Fonts repository](https://github.com/google/fonts):
[Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed),
[Anton](https://github.com/google/fonts/tree/main/ofl/anton),
[Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue), and
[Montserrat](https://github.com/google/fonts/tree/main/ofl/montserrat).

Run `npm run fonts` to regenerate `assets/generated/*.typeface.json` and
`*.coverage.json`. The script performs no network requests, checks each source's
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

Noto Emoji assets are managed separately by `scripts/prepare-emoji.py` and retain
their existing `NotoEmoji-OFL.txt` license notice.
