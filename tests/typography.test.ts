import { describe, expect, it } from 'vitest';
import { GlyphCoverageError, validateGlyphs } from '../src/typography/fonts';
import { emojiCoverage, graphemes, inlineRuns, supportsEmoji } from '../src/typography/emoji';
import { findPortal } from '../src/typography/portals';
import { outlineLayout } from '../src/typography/outlines';
import { contrastRatio, themes } from '../src/themes';
import { Vector2 } from 'three';

describe('bundled typography coverage and geometry', () => {
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
