import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectTextLanguage } from '../src/text/language';

afterEach(() => vi.unstubAllGlobals());

describe('local franc French/English detection', () => {
  it.each([
    ["Le futur n'est pas ce qui nous attend. C'est ce que nous créons.", 'fr'],
    ["L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.", 'fr'],
    ['Et si tout commençait maintenant ?', 'fr'],
    ["L'imagination est plus importante que le savoir.", 'fr'],
    ['Je suis (vraiment) prêt.', 'fr'],
    ['The future is not what awaits us. It is what we create.', 'en'],
    ["AI doesn't replace creators. It creates more of them.", 'en'],
    ['What if everything started now?', 'en'],
  ])('detects the quotation without translation: %s', (text, language) => {
    const detected = detectTextLanguage(text);
    expect(detected.language).toBe(language);
    expect(detected.confidence).toBeGreaterThan(0);
    expect(detected.confidence).toBeLessThanOrEqual(0.99);
    expect(detectTextLanguage(text)).toEqual(detected);
  });

  it.each([
    ['Bonjour', 'fr'],
    ['C’est parti !', 'fr'],
    ['Créons !', 'fr'],
    ['Make it happen.', 'en'],
    ['Oui.', 'fr'],
  ])('retains the best available short result, with uncertainty: %s', (text, language) => {
    const detected = detectTextLanguage(text);
    expect(detected.language).toBe(language);
    expect(detected.uncertain).toBe(true);
    expect(detected.confidence).toBeLessThan(0.5);
  });

  it('does not claim certainty for ambiguous words or closely ranked passages', () => {
    // franc can misclassify small samples such as Dream or Je suis prêt.
    // Preserve its result, while exposing the lack of reliable evidence.
    for (const text of ['Dream.', 'Hello', 'Je suis prêt.', 'Less noise. More meaning.',
      "D'abord un murmure. Puis un rythme. Enfin, notre voix.",
      'Why should our biggest ideas fit inside calendar squares?']) {
      const detected = detectTextLanguage(text);
      expect(detected.uncertain, text).toBe(true);
      expect(detected.confidence, text).toBeLessThan(0.5);
      expect(detectTextLanguage(text)).toEqual(detected);
    }
  });

  it('requires both enough letters and enough separation to mark a result reliable', () => {
    for (const text of ['Et si tout commençait maintenant ?', 'What if everything started now?']) {
      const detected = detectTextLanguage(text);
      expect(detected.uncertain).toBe(false);
      expect(detected.confidence).toBeGreaterThanOrEqual(0.5);
    }
    expect(detectTextLanguage('Bonjour').uncertain).toBe(true);
    expect(detectTextLanguage('Less noise. More meaning.').uncertain).toBe(true);
  });

  it.each(['', 'OK', 'AI', '123. !!!', '…?!', '👨‍👩‍👧‍👦 👍🏽 🇫🇷 1️⃣', '你好世界，这是一个句子。'])
    ('uses a stable uncertain fallback when FR/EN cannot be determined: %s', text => {
      expect(detectTextLanguage(text)).toEqual({ language: 'en', confidence: 0, uncertain: true });
    });

  it('ignores punctuation, numbers and emoji as language evidence', () => {
    const plain = 'Je suis vraiment prêt';
    expect(detectTextLanguage('123… Je suis (vraiment) prêt. 👍🏽 🇫🇷 1️⃣'))
      .toEqual(detectTextLanguage(plain));
    const accented = 'L’imagination répétons cœur';
    expect(detectTextLanguage(accented.normalize('NFD'))).toEqual(detectTextLanguage(accented));
  });

  it('is independent of browser and interface locale', () => {
    const texts = ['Et si tout commençait maintenant ?', 'What if everything started now?', 'OK', 'Bonjour'];
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'], cookieEnabled: true });
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
    const englishInterface = texts.map(text => detectTextLanguage(text));
    vi.stubGlobal('navigator', { language: 'fr-FR', languages: ['fr-FR'], cookieEnabled: true });
    vi.stubGlobal('document', { documentElement: { lang: 'fr' } });
    expect(texts.map(text => detectTextLanguage(text))).toEqual(englishInterface);
  });

  it('retains explicit internal overrides independently of detector uncertainty', () => {
    expect(detectTextLanguage('Dream.', 'fr')).toEqual({ language: 'fr', confidence: 1, uncertain: false });
    expect(detectTextLanguage('Bonjour', 'en')).toEqual({ language: 'en', confidence: 1, uncertain: false });
  });
});
