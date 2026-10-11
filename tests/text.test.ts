import { describe, expect, it } from 'vitest';
import { TextDirector } from '../src/text/director';
import { graphemes } from '../src/text/graphemes';
import { EXAMPLES } from '../src/app/examples';

const corpus = [
  "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.",
  "L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.",
  'Et si tout commençait maintenant ?',
  "On ne voit bien qu'avec le cœur.",
  "L'imagination est plus importante que le savoir.",
  'The future is not what awaits us. It is what we create.',
  "AI doesn't replace creators. It creates more of them.",
  'What if everything started now?',
  'Less noise. More meaning.',
  'Make your words impossible to ignore.',
];

describe('TextDirector', () => {
  it.each(corpus)('partitions untouched source and punctuation: %s', text => {
    const analysis = TextDirector.analyze(text);
    expect(analysis.groups.map(group => group.text).join('')).toBe(text);
    for (let index = 0; index < analysis.groups.length; index++) {
      const group = analysis.groups[index]!;
      expect(text.slice(group.start, group.end)).toBe(group.text);
      expect(group.start).toBe(index === 0 ? 0 : analysis.groups[index - 1]!.end);
      expect(group.readingDuration).toBeGreaterThanOrEqual(0.9);
      expect(group.wordCount).toBeLessThanOrEqual(4);
      for (const protectedSpan of analysis.protectedSpans) {
        expect(group.start > protectedSpan.start && group.start < protectedSpan.end).toBe(false);
      }
    }
    expect(analysis.groups.at(-1)!.conclusion).toBe(true);
  });

  it('preserves the reviewed French article, negation and clitic groups', () => {
    const result = TextDirector.analyze(corpus[1]!, 'fr');
    expect(result.groups.map(group => group.text.trim())).toEqual([
      "L'intelligence artificielle", 'ne remplace pas', 'les créateurs.', 'Elle en crée', 'de nouveaux.',
    ]);
    expect(result.groups[1]!.negation).toBe(true);
    expect(result.groups[1]!.scores.narrative).toBeGreaterThan(result.groups[0]!.scores.narrative);
  });

  it('protects English contractions and semantic negation without merging sentences', () => {
    const result = TextDirector.analyze("AI doesn't replace creators. It is not the end.", 'en');
    expect(result.tokens.some(token => token.text === "doesn't")).toBe(true);
    expect(result.groups.find(group => group.text.includes("doesn't"))!.text).toContain("doesn't replace");
    expect(result.groups.find(group => group.text.includes('not'))!.text).toContain('is not');
    expect(result.groups.some(group => group.tokens.some(token => token.sentence !== group.sentence))).toBe(false);
  });

  it('keeps French restriction compact without turning ne…que into negation', () => {
    const result = TextDirector.analyze("On ne voit bien qu'avec le cœur.", 'fr');
    expect(result.groups.every(group => group.wordCount <= 4 && !group.negation)).toBe(true);
    expect(result.groups.some(group => group.tokens.some(token => token.key === 'ne') && group.tokens.some(token => token.key === 'voit'))).toBe(true);
    expect(result.groups.some(group => group.text.trim() === 'On')).toBe(false);
    for (const text of ['Il ne fait que rêver.', 'Nous ne pouvons finalement avancer que dans cette direction.']) {
      const restriction = TextDirector.analyze(text, 'fr');
      expect(restriction.groups.every(group => group.wordCount <= 4 && !group.negation)).toBe(true);
      expect(restriction.groups.map(group => group.text).join('')).toBe(text);
    }
  });

  it('uses two or three words for most bilingual examples and never exceeds four', () => {
    const analyses = [...EXAMPLES.fr, ...EXAMPLES.en].map(text => TextDirector.analyze(text));
    const groups = analyses.flatMap(analysis => analysis.groups);
    expect(groups.filter(group => group.wordCount >= 2 && group.wordCount <= 3).length / groups.length).toBeGreaterThan(0.8);
    for (const analysis of analyses) {
      expect(analysis.groups.map(group => group.text).join('')).toBe(analysis.sourceText);
      expect(analysis.groups.every(group => group.wordCount >= 1 && group.wordCount <= 4)).toBe(true);
      expect(TextDirector.analyze(analysis.sourceText)).toEqual(analysis);
      for (const span of analysis.protectedSpans) {
        expect(analysis.tokens.filter(token => token.start >= span.start && token.end <= span.end).length).toBeLessThanOrEqual(4);
        expect(analysis.groups.some(group => group.start > span.start && group.start < span.end)).toBe(false);
      }
    }
  });

  it('gives dense and long words smaller groups instead of fixed four-word chunks', () => {
    const text = 'Innovation imagination créativité liberté.';
    const result = TextDirector.analyze(text, 'fr');
    expect(result.version).toBe('fr-en-scanner-2');
    expect(result.groups.map(group => group.text.trim())).toEqual(['Innovation imagination', 'créativité liberté.']);
    expect(result.groups.every(group => group.wordCount === 2)).toBe(true);
    const english = TextDirector.analyze('Extraordinary possibilities transform unconventional imaginations.', 'en');
    expect(english.groups.every(group => group.wordCount <= 2)).toBe(true);
    expect(english.groups.map(group => group.text).join('')).toBe(english.sourceText);
  });

  it('keeps negation markers attached while splitting a long semantic scope', () => {
    const text = 'Nous ne voulons absolument certainement pas oublier les progrès accomplis.';
    const result = TextDirector.analyze(text, 'fr');
    expect(result.groups.map(group => group.text.trim())).toEqual([
      'Nous ne voulons', 'absolument certainement', 'pas oublier', 'les progrès accomplis.',
    ]);
    expect(result.groups.slice(0, 3).every(group => group.negation)).toBe(true);
    expect(result.groups.at(-1)!.negation).toBe(false);
    expect(result.protectedSpans.every(span => result.tokens.filter(token => token.start >= span.start && token.end <= span.end).length <= 4)).toBe(true);
    for (const sample of [
      'Je ne me suis jamais demandé pourquoi les petites idées deviennent de grandes aventures.',
      'We do not ever want to abandon the extraordinary things that we have created together.',
      'She would never have been able to explain the extraordinary possibilities.',
      'We cannot yet understand every consequence of the decisions we make today.',
    ]) {
      const analysis = TextDirector.analyze(sample);
      expect(analysis.groups.map(group => group.text).join('')).toBe(sample);
      expect(analysis.groups.every(group => group.wordCount <= 4)).toBe(true);
      expect(analysis.groups.some(group => group.negation)).toBe(true);
      expect(analysis.groups.some(group => ['Je', 'We', 'She', 'ne', 'not', 'pas'].includes(group.text.trim()))).toBe(false);
    }
  });

  it('preserves short noun phrases and contracted predicates rather than orphaning them', () => {
    const cases = [
      { text: 'Today, the tiny spark in my notebook gets a bigger stage.', spans: ['the tiny spark', 'in my notebook'] },
      { text: 'Une petite étincelle vient de bouleverser mon emploi du temps.', spans: ['Une petite étincelle'] },
      { text: "Une idée l'a entièrement redessiné.", spans: ["l'a entièrement redessiné."] },
      { text: 'Nous célébrons les efforts de toute notre équipe.', spans: ['de toute notre équipe.'] },
      { text: "I don't think we should give up just because it is difficult.", spans: ['give up'] },
      { text: "C'est parce qu'on abandonne que ça reste difficile.", spans: ["parce qu'on"] },
    ];
    for (const sample of cases) {
      const result = TextDirector.analyze(sample.text);
      expect(result.groups.every(group => group.wordCount <= 4)).toBe(true);
      for (const span of sample.spans) expect(result.groups.some(group => group.text.includes(span))).toBe(true);
      expect(result.groups.map(group => group.text).join('')).toBe(sample.text);
    }
  });

  it('keeps accents, case, composed/decomposed characters and whitespace untouched', () => {
    const text = "  L’IMAGINATION, re\u0301pe\u0301tons : cœur !\n\nEncore, ENCORE…  ";
    const result = TextDirector.analyze(text, 'fr');
    expect(result.groups.map(group => group.text).join('')).toBe(text);
    expect(result.groups.some(group => group.repeated)).toBe(true);
    expect(result.tokens.some(token => token.text === 're\u0301pe\u0301tons')).toBe(true);
  });

  it.each([
    { text: 'Une  petite étincelle.', groups: ['Une', 'petite étincelle.'] },
    { text: 'We  create.', groups: ['We', 'create.'] },
    { text: 'give  up', groups: ['give', 'up'] },
    { text: 'ne  remplace pas', groups: ['ne', 'remplace pas'] },
    { text: 'is  not ready', groups: ['is', 'not ready'] },
    { text: '  Créons   👨‍👩‍👧‍👦  maintenant.  ', groups: ['Créons', '👨‍👩‍👧‍👦', 'maintenant.'] },
  ])('forces cuts at consecutive spaces, overriding grammatical ties: $text', ({ text, groups }) => {
    const result = TextDirector.analyze(text);
    expect(result.groups.map(group => group.text.trim())).toEqual(groups);
    expect(result.groups.map(group => group.text).join('')).toBe(text);
    expect(result.groups.every(group => group.wordCount >= 1 && group.wordCount <= 4)).toBe(true);
    for (const group of result.groups) {
      expect(text.slice(group.start, group.end)).toBe(group.text);
      expect(group.sentence).toBe(0);
      expect(result.protectedSpans.some(span => group.start > span.start && group.start < span.end)).toBe(false);
    }
  });

  it('continues automatic compact grouping on either side of a forced cut', () => {
    const before = 'Une petite étincelle vient de bouleverser mon emploi du temps';
    const after = 'Nous célébrons les efforts de toute notre équipe.';
    const result = TextDirector.analyze(`${before}  ${after}`);
    expect(result.groups.map(group => group.text.trim())).toEqual([
      ...TextDirector.analyze(before).groups.map(group => group.text.trim()),
      ...TextDirector.analyze(after).groups.map(group => group.text.trim()),
    ]);
    expect(result.groups.every(group => group.wordCount <= 4)).toBe(true);
  });

  it('keeps single spaces automatic and ignores leading or trailing spaces as cuts', () => {
    const text = 'Une petite étincelle.';
    expect(TextDirector.analyze(text).groups.map(group => group.text.trim())).toEqual([text]);
    expect(TextDirector.analyze(`  ${text}  `).groups.map(group => group.text.trim())).toEqual([text]);
  });

  it('uses explicit language separately from source while marking short automatic samples uncertain', () => {
    expect(TextDirector.analyze('Dream.').uncertainLanguage).toBe(true);
    const englishInput = 'The future is what we create.';
    const english = TextDirector.analyze(englishInput, 'en');
    const frenchOverride = TextDirector.analyze(englishInput, 'fr');
    expect(english.groups).toEqual(frenchOverride.groups);
    expect(english.language).toBe('en');
    expect(frenchOverride.language).toBe('fr');
    expect(TextDirector.analyze(corpus[0]!).language).toBe('fr');
    expect(TextDirector.analyze(corpus[5]!).language).toBe('en');
  });

  it('uses franc metadata without changing source, segmentation or grouping rules', () => {
    for (const text of ['Je suis (vraiment) prêt.', "  L’IMAGINATION, re\u0301pe\u0301tons : cœur !\n\nEncore…  ",
      'Créons 👨‍👩‍👧‍👦 👍🏽 maintenant.', 'The future is what we create.']) {
      const automatic = TextDirector.analyze(text);
      expect(automatic.sourceText).toBe(text);
      expect(automatic.groups.map(group => group.text).join('')).toBe(text);
      expect(automatic.tokens).toEqual(TextDirector.analyze(text, 'en').tokens);
      expect(automatic.groups).toEqual(TextDirector.analyze(text, 'fr').groups);
    }
    expect(TextDirector.analyze('Je suis (vraiment) prêt.').language).toBe('fr');
    const emojiOnly = TextDirector.analyze('👨‍👩‍👧‍👦 👍🏽 🇫🇷 1️⃣');
    expect(emojiOnly.uncertainLanguage).toBe(true);
    expect(emojiOnly.languageConfidence).toBe(0);
  });

  it('keeps emoji sequences intact, including keycaps, modifiers, flags and ZWJ families', () => {
    const text = 'Créons 👨‍👩‍👧‍👦 👍🏽 🇫🇷 1️⃣ maintenant.';
    const result = TextDirector.analyze(text);
    expect(result.tokens.filter(token => token.emoji).map(token => token.text)).toEqual(['👨‍👩‍👧‍👦', '👍🏽', '🇫🇷', '1️⃣']);
    expect(result.groups.map(group => group.text).join('')).toBe(text);
    expect(graphemes('👨‍👩‍👧‍👦👍🏽🇫🇷1️⃣')).toHaveLength(4);
  });

  it('works without native segmentation and gives exactly the same spans', () => {
    const normal = TextDirector.analyze(corpus[1]!);
    const original = Intl.Segmenter;
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    try { expect(TextDirector.analyze(corpus[1]!)).toEqual(normal); }
    finally { Object.defineProperty(Intl, 'Segmenter', { value: original, configurable: true }); }
  });

  it('rejects empty input without inventing words', () => {
    expect(() => TextDirector.analyze(' \n ')).toThrow(RangeError);
    expect(() => TextDirector.analyze('!!!')).toThrow(RangeError);
    expect(TextDirector.analyze('Oui.').groups).toHaveLength(1);
  });
});
