import { describe, expect, it } from 'vitest';
import { MAX_VIDEO_FILENAME_LENGTH, videoFilename } from '../src/export/filename';

describe('video filenames from the film text', () => {
  it('preserves readable French accents, apostrophes and English words', () => {
    expect(videoFilename("L’avenir s’écrit aujourd’hui. Créons ensemble !", 'mp4'))
      .toBe('L’avenir s’écrit aujourd’hui. Créons ensemble !.mp4');
    expect(videoFilename('Less noise. More meaning.', 'webm')).toBe('Less noise. More meaning.webm');
    expect(videoFilename('Cre\u0301ons\n  ensemble.', 'mp4')).toBe('Créons ensemble.mp4');
  });

  it.each(['mp4', 'webm'] as const)('caps the whole %s filename at 76, including the extension', format => {
    const filename = videoFilename('Une phrase longue avec beaucoup de mots pour raconter tout ce que nous voulons créer ensemble demain.', format);
    expect(filename.length).toBeLessThanOrEqual(MAX_VIDEO_FILENAME_LENGTH);
    expect(videoFilename('é'.repeat(200), format).length).toBe(MAX_VIDEO_FILENAME_LENGTH);
    expect(filename.endsWith(`.${format}`)).toBe(true);
    expect(filename.startsWith('Une phrase longue avec beaucoup de mots')).toBe(true);
  });

  it('removes paths, invalid filesystem characters, controls and invisible direction marks', () => {
    const filename = videoFilename(' ../Créons\\ensemble: "oui"? <maintenant>|*\u0000\u202e ', 'mp4');
    expect(filename).toBe('Créons ensemble oui maintenant.mp4');
    expect(videoFilename('CON', 'mp4')).toBe('_CON.mp4');
    expect(videoFilename('nul.txt', 'webm')).toBe('_nul.txt.webm');
    expect(videoFilename('Com1', 'mp4')).toBe('_Com1.mp4');
  });

  it('keeps complete emoji sequences when shortening and provides a safe empty fallback', () => {
    const family = '👨‍👩‍👧‍👦';
    const filename = videoFilename(family.repeat(20), 'mp4');
    expect(filename.length).toBeLessThanOrEqual(76);
    expect(filename.slice(0, -4)).toBe(family.repeat(6));
    expect(videoFilename(' ... / : ? ', 'mp4')).toBe('CREACTORS.mp4');
  });
});
