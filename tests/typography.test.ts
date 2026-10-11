import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_ID, GlyphCoverageError, getDisplayFont, listDisplayFonts, validateGlyphs } from '../src/typography/fonts';
import { emojiCoverage, graphemes, inlineRuns, supportsEmoji } from '../src/typography/emoji';
import { findPortal } from '../src/typography/portals';
import { outlineLayout } from '../src/typography/outlines';
import { measureGroups, measureLine } from '../src/typography/measure';
import { TextDirector } from '../src/text/director';
import { MotionDirector, stableSeed } from '../src/direction/director';
import { FUTURE_QUOTE } from '../src/demos/future';
import { contrastRatio, themes } from '../src/themes';
import { Vector2 } from 'three';

describe('bundled typography coverage and geometry', () => {
  it('uses each selected font for measurements, counters and reproducible direction', () => {
    const analysis = TextDirector.analyze(FUTURE_QUOTE, 'fr');
    const widths: number[] = [];
    for (const font of listDisplayFonts()) {
      expect(() => validateGlyphs('À chaque idée, son cœur ! Œuvre, français et re\u0301ussite.', font.id)).not.toThrow();
      const measured = measureGroups(analysis, font.id);
      expect(measured.every(group => group.fontId === font.id && Number.isFinite(group.width))).toBe(true);
      widths.push(measureLine('Make words move.', font.id).width);
      const portal = findPortal('O', 1, font.id);
      expect(portal?.radius).toBeGreaterThan(0.01);
      const outline = outlineLayout('O', 1, font.id);
      expect(outline.shapes.some(shape => shape.holes.length)).toBe(true);
      const seed = stableSeed(FUTURE_QUOTE);
      const scene = MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed);
      expect(scene.fontVersion).toBe(getDisplayFont(font.id).version);
      if (font.id !== DEFAULT_FONT_ID) {
        expect(scene.fontId).toBe(font.id);
        expect(scene.generatorVersion).toMatch(/^spatial-grammar/);
        expect(scene.seed).toBe(seed);
      }
      expect(MotionDirector.direct(analysis, measured, 'califormandy-sunset', seed)).toEqual(scene);
    }
    expect(new Set(widths).size).toBe(4);
    // Alternating selections must not reuse another font's measurement cache.
    expect(measureLine('Make words move.').width).toBe(widths[0]);
  });
  it('accepts French typography and normalized rendering without changing the input', () => {
    const text = "L’IMAGINATION : re\u0301pe\u0301tons, cœur, Œ !";
    expect(() => validateGlyphs(text)).not.toThrow();
    expect(text).toContain('e\u0301');
    expect(() => validateGlyphs('你好')).toThrow(GlyphCoverageError);
  });
  it('keeps supported complete emoji sequences whole and rejects uncovered ones', () => {
    const sequences = ['👨‍👩‍👧‍👦', '👍🏽', '🇫🇷', '1️⃣'];
    for (const sequence of sequences) {
      expect(supportsEmoji(sequence)).toBe(true);
      expect(() => validateGlyphs(`Créons ${sequence}.`)).not.toThrow();
    }
    expect(graphemes(sequences.join(''))).toEqual(sequences);
    const unsupported = emojiCoverage.uncovered[0]!;
    expect(supportsEmoji(unsupported)).toBe(false);
    expect(() => validateGlyphs(unsupported)).toThrow(GlyphCoverageError);
    expect(inlineRuns('Le futur 👨‍👩‍👧‍👦 !').map(run => run.text).join('')).toBe('Le futur 👨‍👩‍👧‍👦 !');
    for (const sequence of emojiCoverage.accepted) {
      const glyph = (emojiCoverage.renderGlyphs as Record<string, string>)[sequence]!;
      expect(glyph.codePointAt(0)).toBeGreaterThanOrEqual(0xF0000);
      expect([...glyph]).toHaveLength(1);
    }
  });
  it('discovers actual closed counters and uses the extrusion coordinate system', () => {
    const portal = findPortal('O', 2.4)!;
    expect(portal).not.toBeNull();
    expect(portal.radius).toBeGreaterThan(0.024);
    expect(findPortal('I', 2.4)).toBeNull();
    expect(findPortal('O 👨‍👩‍👧‍👦', 2.4)).toBeNull();
    const layout = outlineLayout('O', 2.4);
    const center = layout.bounds.getCenter(new Vector2());
    const hole = layout.shapes[0]!.holes[0]!;
    const point = center.add(new Vector2(...portal.center));
    const polygon = hole.getPoints(48);
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    expect(inside).toBe(true);
    expect(Math.min(...polygon.map(vertex => vertex.distanceTo(point)))).toBeGreaterThanOrEqual(portal.radius - 0.0001);
  });
  it('keeps each foreground role readable on every theme background', () => {
    for (const theme of themes) for (const color of Object.values(theme.colors)) expect(contrastRatio(color, theme.background)).toBeGreaterThanOrEqual(4.5);
  });
});
