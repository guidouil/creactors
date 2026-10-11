import { describe, expect, it } from 'vitest';
import { EXAMPLES, ExamplePicker } from '../src/app/examples';

const languages = ['fr', 'en'] as const;

describe('local bilingual examples', () => {
  it('provides many distinct, complete short phrases in both languages', () => {
    for (const language of languages) {
      const examples = EXAMPLES[language];
      expect(examples.length).toBeGreaterThanOrEqual(40);
      expect(new Set(examples).size).toBe(examples.length);
      for (const example of examples) {
        expect(example).toBe(example.trim());
        expect(example.length).toBeLessThanOrEqual(140);
        expect(example.split(/\s+/).length).toBeLessThanOrEqual(22);
        expect(example).toMatch(/[.!?]$/);
      }
      expect(examples.filter(example => example.endsWith('?')).length).toBeGreaterThanOrEqual(8);
      expect(examples.filter(example => example.includes('. ')).length).toBeGreaterThanOrEqual(8);
    }
    expect(EXAMPLES.fr.some(example => example.includes('cœur'))).toBe(true);
    expect(EXAMPLES.fr.some(example => example.includes("Aujourd'hui"))).toBe(true);
    expect(EXAMPLES.en.some(example => example.includes("don't"))).toBe(true);
    expect(EXAMPLES.fr.filter(example => EXAMPLES.en.includes(example))).toEqual([]);
  });

  it('presents every phrase once before a language bag is exhausted', () => {
    const picker = new ExamplePicker(() => 0.37);
    for (const language of languages) {
      for (let cycle = 0; cycle < 3; cycle++) {
        const selected = Array.from({ length: EXAMPLES[language].length }, () => picker.next(language));
        expect(new Set(selected)).toEqual(new Set(EXAMPLES[language]));
      }
    }
  });

  it.each([0, 0.5, 0.999999])('avoids repeating across cycle boundaries with a constant RNG of %s', random => {
    const picker = new ExamplePicker(() => random);
    for (const language of languages) {
      let previous: string | undefined;
      for (let index = 0; index < EXAMPLES[language].length * 4; index++) {
        const selected = picker.next(language);
        expect(selected).not.toBe(previous);
        previous = selected;
      }
    }
  });

  it('keeps each language bag and its progress when switching interface language', () => {
    const mixed = new ExamplePicker(() => 0);
    const french = new ExamplePicker(() => 0);
    const english = new ExamplePicker(() => 0);
    for (let index = 0; index < EXAMPLES.fr.length + 5; index++) {
      expect(mixed.next('fr')).toBe(french.next('fr'));
      if (index % 3 === 0) expect(mixed.next('en')).toBe(english.next('en'));
    }
  });

  it('uses the supplied random source to vary the first presentation', () => {
    const first = new ExamplePicker(() => 0);
    const second = new ExamplePicker(() => 0.999999);
    for (const language of languages) expect(first.next(language)).not.toBe(second.next(language));
  });
});
