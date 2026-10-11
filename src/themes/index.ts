import type { ColorRole } from '../scene/types';
import { sunset } from './sunset';
import { generatePalette, paletteDistance } from './generative';

export { contrastRatio } from './generative';

export type ColorScheme = 'dark' | 'light';

export interface Theme {
  id: string;
  background: string;
  colors: Record<ColorRole, string>;
  sides: Record<ColorRole, string>;
}

export interface ThemeFamily {
  id: string;
  labelKey: 'themeSunset' | 'themeMonochrome' | 'themeCoral' | 'themeCobalt' | 'themeOrchid' | 'themeAcid';
  swatch: string;
  lightSwatch: string;
}

export const themeFamilies: readonly ThemeFamily[] = [
  { id: 'califormandy-sunset', labelKey: 'themeSunset', swatch: '#F58BB4', lightSwatch: '#9B2458' },
  { id: 'monochrome', labelKey: 'themeMonochrome', swatch: '#FAF8FF', lightSwatch: '#1B1B21' },
  { id: 'coral-night', labelKey: 'themeCoral', swatch: '#FFB58A', lightSwatch: '#993B26' },
  { id: 'cobalt', labelKey: 'themeCobalt', swatch: '#A7BEFF', lightSwatch: '#354CA1' },
  { id: 'orchid', labelKey: 'themeOrchid', swatch: '#C6B0FF', lightSwatch: '#60369B' },
  { id: 'acid', labelKey: 'themeAcid', swatch: '#C8F269', lightSwatch: '#2A664D' },
];

// Roles describe typographic hierarchy rather than literal hues. Light themes
// therefore use dark inks for the same roles without changing the choreography.
export const themes: readonly Theme[] = [
  { id: 'califormandy-sunset', background: sunset.background,
    colors: { white: sunset.white, pink: sunset.pink, coral: sunset.coral, cyan: sunset.cyan, violet: sunset.white },
    sides: { white: '#78738A', pink: '#8E466E', coral: '#AA7155', cyan: '#35738F', violet: '#78738A' } },
  { id: 'monochrome', background: '#101014',
    colors: { white: '#FAF8FF', pink: '#FAF8FF', coral: '#D1CDD9', cyan: '#FAF8FF', violet: '#D1CDD9' },
    sides: { white: '#77747E', pink: '#77747E', coral: '#77747E', cyan: '#77747E', violet: '#77747E' } },
  { id: 'coral-night', background: '#221526',
    colors: { white: '#FFF1E8', pink: '#FFB58A', coral: '#FFF1E8', cyan: '#F58BB4', violet: '#FFF1E8' },
    sides: { white: '#A88776', pink: '#AA7155', coral: '#A88776', cyan: '#8E466E', violet: '#A88776' } },
  { id: 'cobalt', background: '#0A204A',
    colors: { white: '#EAF3FF', pink: '#BDA9FF', coral: '#FFD69A', cyan: '#8EE9F2', violet: '#A7BEFF' },
    sides: { white: '#627AA3', pink: '#725493', coral: '#9D7442', cyan: '#397784', violet: '#4E679E' } },
  { id: 'orchid', background: '#2D0B3E',
    colors: { white: '#FFF0FC', pink: '#FF9DCB', coral: '#FFCBAC', cyan: '#C8F594', violet: '#C6B0FF' },
    sides: { white: '#8F699B', pink: '#A04478', coral: '#A36D53', cyan: '#658145', violet: '#715296' } },
  { id: 'acid', background: '#152016',
    colors: { white: '#F4F8E3', pink: '#E3F58B', coral: '#FFD68D', cyan: '#C8F269', violet: '#A7E4C0' },
    sides: { white: '#788364', pink: '#7F8C3C', coral: '#92733A', cyan: '#678E30', violet: '#47765C' } },
  { id: 'califormandy-sunset-light', background: '#F9EFEA',
    colors: { white: '#242038', pink: '#9B2458', coral: '#9C3E14', cyan: '#126582', violet: '#54416A' },
    sides: { white: '#8F879D', pink: '#D58CA8', coral: '#D59872', cyan: '#78ACBB', violet: '#AA93B8' } },
  { id: 'monochrome-light', background: '#F5F3EF',
    colors: { white: '#1B1B21', pink: '#1B1B21', coral: '#56535D', cyan: '#1B1B21', violet: '#56535D' },
    sides: { white: '#939099', pink: '#939099', coral: '#AAA6B0', cyan: '#939099', violet: '#AAA6B0' } },
  { id: 'coral-night-light', background: '#FFF1E7',
    colors: { white: '#512927', pink: '#993B26', coral: '#5B272E', cyan: '#993559', violet: '#72344F' },
    sides: { white: '#B58878', pink: '#D39478', coral: '#BA8C8D', cyan: '#D08DA2', violet: '#AF8497' } },
  { id: 'cobalt-light', background: '#ECF3FF',
    colors: { white: '#102952', pink: '#643395', coral: '#8C4B0A', cyan: '#075F73', violet: '#354CA1' },
    sides: { white: '#7790B4', pink: '#AA8BC8', coral: '#C29D68', cyan: '#6CA8B4', violet: '#8397D3' } },
  { id: 'orchid-light', background: '#F8EEFF',
    colors: { white: '#422252', pink: '#A12761', coral: '#95510C', cyan: '#38612B', violet: '#60369B' },
    sides: { white: '#A48DB6', pink: '#D78DAF', coral: '#CCA16C', cyan: '#94B77B', violet: '#AD93CE' } },
  { id: 'acid-light', background: '#F2F5DF',
    colors: { white: '#293222', pink: '#655315', coral: '#944311', cyan: '#2A664D', violet: '#3C577D' },
    sides: { white: '#959F7F', pink: '#BCAF63', coral: '#C39762', cyan: '#87B294', violet: '#8FA6BE' } },
];

const themesById = new Map(themes.map(theme => [theme.id, theme]));
const familyIds = new Set(themeFamilies.map(family => family.id));
const generatedThemes = new Map<string, Theme>();
const MAX_CACHED_PALETTES = 128;

function parseThemeId(id: string): { familyId: string; seed?: number; scheme: ColorScheme } | null {
  const scheme = id.endsWith('-light') ? 'light' : 'dark';
  const base = scheme === 'light' ? id.slice(0, -6) : id;
  if (familyIds.has(base)) return { familyId: base, scheme };
  const variant = /^([a-z-]+)~1-([0-9a-f]{8})$/.exec(base);
  if (!variant || !familyIds.has(variant[1])) return null;
  return { familyId: variant[1], seed: parseInt(variant[2], 16), scheme };
}

function generatedId(familyId: string, seed: number, scheme: ColorScheme): string {
  return `${familyId}~1-${(seed >>> 0).toString(16).padStart(8, '0')}${scheme === 'light' ? '-light' : ''}`;
}

export function getTheme(id: string): Theme {
  const fixed = themesById.get(id);
  if (fixed) return fixed;
  const parsed = parseThemeId(id);
  if (parsed?.seed === undefined) return themes[0];
  let theme = generatedThemes.get(id);
  if (theme) generatedThemes.delete(id);
  else theme = { id, ...generatePalette(parsed.familyId, parsed.seed, parsed.scheme) };
  generatedThemes.set(id, theme);
  if (generatedThemes.size > MAX_CACHED_PALETTES) generatedThemes.delete(generatedThemes.keys().next().value!);
  return theme;
}

export function getThemeFamilyId(resolvedId: string): string {
  return parseThemeId(resolvedId)?.familyId ?? themeFamilies[0].id;
}

/** Keep a generated harmony intact when adapting it to the OS appearance. */
export function resolveTheme(id: string, scheme: ColorScheme): Theme {
  const parsed = parseThemeId(id) ?? { familyId: themeFamilies[0].id, seed: undefined };
  return getTheme(parsed.seed === undefined
    ? `${parsed.familyId}${scheme === 'light' ? '-light' : ''}`
    : generatedId(parsed.familyId, parsed.seed, scheme));
}

function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21F0AAAD);
  value = Math.imul(value ^ (value >>> 15), 0x735A2D97);
  return (value ^ (value >>> 15)) >>> 0;
}

/** Recent IDs are ordered oldest to newest; manual family IDs work too. */
export function chooseTheme(seed: number, scheme: ColorScheme, previousIds: readonly string[] = []): Theme {
  const previous = previousIds.filter(id => parseThemeId(id) !== null);
  const recent = new Set(previous.map(getThemeFamilyId));
  let candidates = themeFamilies.filter(family => !recent.has(family.id));
  // If the caller supplies every family, keep the immediate predecessor out
  // rather than getting stuck or silently returning the same palette.
  if (candidates.length === 0) candidates = themeFamilies.filter(family => family.id !== getThemeFamilyId(previous.at(-1)!));

  // A dedicated integer mixer isolates palette decisions from motion streams.
  const value = mix((seed >>> 0) ^ 0xA5B35705);
  const index = Math.floor((value / 0x100000000) * candidates.length);
  const familyId = candidates[index].id;
  let selected = getTheme(generatedId(familyId, mix(value ^ 0x67C8A52D), 'dark'));
  if (previous.length) {
    // Compare canonical dark counterparts so OS appearance cannot alter the draw.
    const reference = previous.slice(-2).map(id => resolveTheme(id, 'dark'));
    let bestDistance = Math.min(...reference.map(theme => paletteDistance(selected, theme)));
    for (let attempt = 1; attempt < 16; attempt++) {
      const candidate = getTheme(generatedId(familyId, mix(value ^ Math.imul(attempt, 0x9E3779B1)), 'dark'));
      const distance = Math.min(...reference.map(theme => paletteDistance(candidate, theme)));
      if (distance > bestDistance) { selected = candidate; bestDistance = distance; }
    }
  }
  return resolveTheme(selected.id, scheme);
}
