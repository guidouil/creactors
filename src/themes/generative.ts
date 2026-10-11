import type { ColorRole } from '../scene/types';
import type { Theme } from './index';

type Palette = Omit<Theme, 'id'>;
type Scheme = 'dark' | 'light';
const roles: readonly ColorRole[] = ['white', 'pink', 'coral', 'cyan', 'violet'];

/** Keep the palette stream independent of both motion and browser appearance. */
function randomStream(seed: number): () => number {
  let state = (seed >>> 0) ^ 0xB7E15162;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function hsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360 / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(h % 2 - 1));
  const rgb = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0]
    : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma]
    : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return `#${rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function linearRGB(hex: string): number[] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const rgb = linearRGB(hex);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Fit the rounded, exported color, not its unrounded HSL approximation. */
function readable(hue: number, saturation: number, lightness: number, background: string, scheme: Scheme, targetRatio = 4.8): string {
  let ink = hsl(hue, saturation, lightness);
  const step = scheme === 'dark' ? 0.008 : -0.008;
  for (let attempt = 0; contrastRatio(ink, background) < targetRatio && attempt < 125; attempt++) {
    lightness = Math.max(0, Math.min(1, lightness + step));
    ink = hsl(hue, saturation, lightness);
  }
  return ink;
}

const anchors: Record<string, readonly [number, number]> = {
  'califormandy-sunset': [330, 260],
  'coral-night': [22, 340],
  cobalt: [218, 218],
  orchid: [286, 285],
  acid: [96, 135],
};

/** Small harmonies become a continuous palette space through hue and ink variation. */
const harmonies: readonly (readonly number[])[] = [
  [-42, 0, 38, 74],
  [0, 150, 210, 35],
  [0, 120, 240, 28],
  [0, 180, 32, 212],
];

export function generatePalette(familyId: string, variantSeed: number, scheme: Scheme): Palette {
  const random = randomStream(variantSeed);
  // Consume the same random stream in both schemes: changing OS appearance
  // changes the inks, but preserves the chosen hues and harmony.
  const neutral = familyId === 'monochrome';
  const [anchor, backgroundAnchor] = anchors[familyId] ?? anchors['califormandy-sunset'];
  const hue = anchor + (random() - 0.5) * 82;
  const backgroundHue = backgroundAnchor + (random() - 0.5) * 104;
  const backgroundSaturation = neutral ? 0 : 0.34 + random() * 0.32;
  const backgroundPosition = random();
  const backgroundLightness = scheme === 'dark' ? 0.08 + backgroundPosition * 0.1 : 0.92 + backgroundPosition * 0.05;
  const background = hsl(backgroundHue, backgroundSaturation, backgroundLightness);
  const offsets = [...harmonies[Math.floor(random() * harmonies.length)]];
  for (let index = offsets.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [offsets[index], offsets[other]] = [offsets[other], offsets[index]];
  }
  const colors = {} as Record<ColorRole, string>;
  const sides = {} as Record<ColorRole, string>;
  // Five distinct neutral shades keep even monochrome remixes expressive.
  const neutralInks = [0.97, 0.83, 0.72, 0.9, 0.77];
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index];
    const jitter = (random() - 0.5) * 16;
    const saturationPosition = random(), lightnessPosition = random(), sidePosition = random();
    const inkHue = index === 0 ? backgroundHue : hue + offsets[index - 1] + jitter;
    const saturation = neutral ? 0 : index === 0 ? 0.16 + saturationPosition * 0.12 : 0.62 + saturationPosition * 0.32;
    const neutralLightness = neutralInks[index] + (lightnessPosition - 0.5) * 0.032;
    const inkLightness = neutral
      ? scheme === 'dark' ? neutralLightness : 1 - neutralLightness
      : index === 0
        ? scheme === 'dark' ? 0.94 + lightnessPosition * 0.04 : 0.1 + lightnessPosition * 0.08
        : scheme === 'dark' ? 0.59 + lightnessPosition * 0.18 : 0.25 + lightnessPosition * 0.15;
    colors[role] = readable(inkHue, saturation, inkLightness, background, scheme);
    const neutralSidePosition = (sidePosition - 0.5) * 0.024;
    const sideLightness = neutral
      ? scheme === 'dark' ? 0.32 + index * 0.035 + neutralSidePosition : 0.61 + index * 0.035 + neutralSidePosition
      : scheme === 'dark' ? 0.29 + sidePosition * 0.13 : 0.58 + sidePosition * 0.14;
    sides[role] = readable(inkHue, neutral ? 0 : saturation * 0.66, sideLightness, background, scheme, 1.6);
  }
  return { background, colors, sides };
}

/** OKLab prevents blue/yellow RGB distances from dominating visible variation. */
function lab(hex: string): readonly [number, number, number] {
  const [r, g, b] = linearRGB(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function paletteDistance(a: Theme, b: Theme): number {
  const distance = (first: string, second: string) => {
    const x = lab(first), y = lab(second);
    return Math.hypot(x[0] - y[0], (x[1] - y[1]) * 1.6, (x[2] - y[2]) * 1.6);
  };
  const weights: Record<ColorRole, number> = { white: 0.6, pink: 1.25, coral: 1, cyan: 1.6, violet: 0.8 };
  let total = distance(a.background, b.background) * 1.75;
  let weight = 1.75;
  for (const role of roles) {
    total += distance(a.colors[role], b.colors[role]) * weights[role];
    weight += weights[role];
  }
  return total / weight * 100;
}
