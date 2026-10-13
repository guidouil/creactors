import { describe, expect, it } from 'vitest';
import { chooseTheme, contrastRatio, getTheme, getThemeFamilyId, resolveTheme, themeFamilies, themes } from '../src/themes';

describe('adaptive color families', () => {
  it('provides one readable dark and light variant for every family', () => {
    expect(themeFamilies).toHaveLength(6);
    expect(themes).toHaveLength(12);
    expect(new Set(themes.map(theme => theme.id)).size).toBe(themes.length);
    for (const family of themeFamilies) {
      const dark = resolveTheme(family.id, 'dark');
      const light = resolveTheme(family.id, 'light');
      expect(dark.id).toBe(family.id);
      expect(light.id).toBe(`${family.id}-light`);
      expect(getThemeFamilyId(dark.id)).toBe(family.id);
      expect(getThemeFamilyId(light.id)).toBe(family.id);
      expect(dark.background).not.toBe(light.background);
      expect(resolveTheme(light.id, 'dark')).toBe(dark);
      expect(resolveTheme(dark.id, 'light')).toBe(light);
      expect(family.swatch).toMatch(/^#[0-9A-F]{6}$/);
      expect(family.lightSwatch).toMatch(/^#[0-9A-F]{6}$/);
      for (const theme of [dark, light]) {
        for (const role of Object.keys(theme.colors) as (keyof typeof theme.colors)[]) {
          expect(contrastRatio(theme.colors[role], theme.background), `${theme.id}/${role}`).toBeGreaterThanOrEqual(4.5);
          expect(theme.sides[role]).not.toBe(theme.colors[role]);
          expect(theme.sides[role]).not.toBe(theme.background);
        }
      }
    }
  });

  it('uses the Califormandy identity and safely resolves unknown families', () => {
    expect(getTheme('califormandy-sunset').background).toBe('#20211F');
    expect(getTheme('califormandy-sunset').colors).toEqual({
      white: '#F5F2E9', pink: '#FB398F', coral: '#D4EF53', cyan: '#35DFFF', violet: '#F5F2E9',
    });
    expect(getTheme('unknown')).toBe(getTheme('califormandy-sunset'));
    expect(getThemeFamilyId('unknown-light')).toBe('califormandy-sunset');
    expect(resolveTheme('unknown', 'light').id).toBe('califormandy-sunset-light');
  });

  it('generates reproducible palettes independently of OS appearance', () => {
    for (const seed of [0, 1, 42, 20261009, 0xFFFFFFFF, -1, Number.NaN]) {
      const dark = chooseTheme(seed, 'dark');
      const light = chooseTheme(seed, 'light');
      expect(chooseTheme(seed, 'dark')).toEqual(dark);
      expect(dark.id).toMatch(/^[a-z-]+~1-[\da-f]{8}$/);
      expect(light.id).toBe(`${dark.id}-light`);
      expect(getThemeFamilyId(light.id)).toBe(getThemeFamilyId(dark.id));
      expect(resolveTheme(dark.id, 'light')).toEqual(light);
      expect(resolveTheme(light.id, 'dark')).toEqual(dark);
      expect(getTheme(JSON.parse(JSON.stringify(dark)).id)).toEqual(dark);
    }
    expect(chooseTheme(-1, 'dark')).toEqual(chooseTheme(0xFFFFFFFF, 'dark'));
    expect(chooseTheme(Number.NaN, 'dark')).toEqual(chooseTheme(0, 'dark'));
  });

  it('varies actual backgrounds and text inks far beyond six fixed palettes', () => {
    const generated = Array.from({ length: 240 }, (_, seed) => chooseTheme(seed, 'dark'));
    const selected = new Set(generated.map(theme => getThemeFamilyId(theme.id)));
    expect(selected).toEqual(new Set(themeFamilies.map(family => family.id)));
    expect(new Set(generated.map(theme => JSON.stringify([theme.background, theme.colors]))).size).toBeGreaterThan(200);
    expect(new Set(generated.map(theme => theme.background)).size).toBeGreaterThan(80);
    for (const family of themeFamilies) {
      const variants = generated.filter(theme => getThemeFamilyId(theme.id) === family.id);
      expect(new Set(variants.map(theme => JSON.stringify(theme.colors))).size, family.id).toBeGreaterThan(8);
      expect(new Set(variants.map(theme => theme.background)).size, family.id).toBeGreaterThan(4);
    }
    // Reconstruct an older serialized palette after more than the cache capacity.
    const first = chooseTheme(42, 'dark');
    for (let seed = 1000; seed < 1400; seed++) getTheme(chooseTheme(seed, 'dark').id);
    expect(getTheme(first.id)).toEqual(first);
    expect(themes).toHaveLength(12);
  });

  it('keeps every generated text ink readable in either appearance', () => {
    for (let seed = 0; seed < 512; seed++) {
      for (const scheme of ['dark', 'light'] as const) {
        const theme = chooseTheme(seed, scheme);
        for (const role of Object.keys(theme.colors) as (keyof typeof theme.colors)[]) {
          expect(theme.colors[role]).toMatch(/^#[\dA-Fa-f]{6}$/);
          expect(contrastRatio(theme.colors[role], theme.background), `${theme.id}/${role}`).toBeGreaterThanOrEqual(4.5);
          expect(theme.sides[role]).not.toBe(theme.colors[role]);
          expect(theme.sides[role]).not.toBe(theme.background);
        }
      }
    }
  });

  it('avoids recent families including generated IDs and saturated history', () => {
    const previous = ['califormandy-sunset', 'cobalt-light', 'acid'];
    for (let seed = 0; seed < 100; seed++) {
      expect(previous.map(getThemeFamilyId)).not.toContain(getThemeFamilyId(chooseTheme(seed, 'dark', previous).id));
      expect(chooseTheme(seed, 'light', previous)).toEqual(chooseTheme(seed, 'light', previous));
    }
    const allFamilies = themeFamilies.map(family => family.id);
    for (let seed = 0; seed < 100; seed++) {
      expect(getThemeFamilyId(chooseTheme(seed, 'dark', allFamilies).id)).not.toBe(allFamilies.at(-1));
      expect(chooseTheme(seed, 'dark', ['unknown']).id).toBe(chooseTheme(seed, 'dark').id);
    }
    const generatedHistory = [chooseTheme(42, 'dark').id, chooseTheme(43, 'light').id];
    for (let seed = 0; seed < 100; seed++) {
      expect(generatedHistory.map(getThemeFamilyId)).not.toContain(getThemeFamilyId(chooseTheme(seed, 'dark', generatedHistory).id));
    }
    expect(getTheme('cobalt~xyz-light')).toBe(getTheme('califormandy-sunset'));
    expect(getThemeFamilyId('cobalt~xyz-light')).toBe('califormandy-sunset');
  });
});
