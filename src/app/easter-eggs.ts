import './easter-eggs.css';

type EggLocale = 'fr' | 'en';
type Copy = { title: string; hint: string; description: string };
type Secret = { id: string; kind: 'studio' | 'film'; fr: Copy; en: Copy };

export interface EasterEggOptions {
  getLocale(): EggLocale;
  isBlocked(): boolean;
  onSecretExample(text: string): void;
}

export interface EasterEggs {
  setLocale(): void;
  discoverFilm(id: string): void;
  destroy(): void;
}

const secrets: readonly Secret[] = [
  { id: 'falling', kind: 'studio', fr: { title: 'Pause syndicale', hint: 'Le nom du studio mérite cinq petits coups.', description: 'Les lettres prennent une pause. Elles reviendront.' }, en: { title: 'Union break', hint: 'Give the studio name five little taps.', description: 'The letters are taking a break. They will be back.' } },
  { id: 'after-hours', kind: 'studio', fr: { title: 'After hours', hint: 'Laissez votre doigt sur le soleil du logo.', description: 'Le soleil se couche. Le studio reste éveillé.' }, en: { title: 'After hours', hint: 'Rest your finger on the sun in the logo.', description: 'The sun sets. The studio stays awake.' } },
  { id: 'seventh-die', kind: 'studio', fr: { title: 'La septième face', hint: 'Le dé garde quelque chose sous le doigt.', description: 'Même le hasard a ses petits secrets.' }, en: { title: 'The seventh face', hint: 'The die keeps something under your fingertip.', description: 'Even chance has its little secrets.' } },
  { id: 'bloopers', kind: 'studio', fr: { title: 'Bêtisier', hint: 'Un appui prolongé sur REMIX fait rater une prise.', description: 'Une lettre rate son entrée. Ses collègues improvisent.' }, en: { title: 'Bloopers', hint: 'A long press on REMIX spoils a take.', description: 'One letter misses its cue. Its colleagues improvise.' } },
  { id: 'credits', kind: 'studio', fr: { title: 'Les vrais crédits', hint: 'Le crédit tout en bas répond au troisième tap.', description: 'Texte : vous. Cascades : les lettres. Montage : le hasard.' }, en: { title: 'The real credits', hint: 'The credit at the bottom answers the third tap.', description: 'Words: you. Stunts: the letters. Editing: chance.' } },
  { id: 'rewind', kind: 'studio', fr: { title: 'Retour sur pellicule', hint: 'Gardez le bouton de replay enfoncé.', description: 'Un petit voyage en marche arrière, hors du film.' }, en: { title: 'Back on film', hint: 'Hold the replay button.', description: 'A little trip backwards, outside your film.' } },
  { id: 'acid-rain', kind: 'studio', fr: { title: 'Pluie acide', hint: 'La couleur Acid se révèle quand on insiste.', description: 'Les caractères tombent. Le studio reste au sec.' }, en: { title: 'Acid rain', hint: 'The Acid colour reveals itself if you linger.', description: 'Characters are falling. The studio stays dry.' } },
  { id: 'silent-film', kind: 'studio', fr: { title: 'Séance de 1926', hint: 'Le noir et blanc aime les appuis prolongés.', description: 'Un carton muet. Des mots qui parlent quand même.' }, en: { title: 'A 1926 screening', hint: 'Black and white enjoys a long press.', description: 'A silent title card. Words that still speak.' } },
  { id: 'answer42', kind: 'studio', fr: { title: 'La réponse', hint: 'Le compteur du film a une réponse au troisième tap.', description: '00:42. Pour le reste, nous cherchons encore la question.' }, en: { title: 'The answer', hint: 'The film clock has an answer on the third tap.', description: '00:42. We are still looking for the question.' } },
  { id: 'constellation', kind: 'studio', fr: { title: 'Constellation', hint: '↑ ↑ ↓ ↓ ← → ← → B A. Ou gardez le numéro du film enfoncé.', description: 'MAKE WORDS MOVE. Même dans les étoiles.' }, en: { title: 'Constellation', hint: '↑ ↑ ↓ ↓ ← → ← → B A. Or hold the film number.', description: 'MAKE WORDS MOVE. Even among the stars.' } },
  { id: 'orchestra', kind: 'studio', fr: { title: 'Orchestre silencieux', hint: 'Le bouton musique dirige aussi avec un appui long.', description: 'Les lettres jouent à vue. Cette partition reste silencieuse.' }, en: { title: 'Silent orchestra', hint: 'The music button also conducts with a long press.', description: 'The letters play by sight. This score stays silent.' } },
  { id: 'cobalt', kind: 'studio', fr: { title: 'Écho bleu', hint: 'Restez sur la pastille Cobalt pour voir plus loin.', description: 'Un mot, sept échos, et un point de fuite.' }, en: { title: 'Blue echo', hint: 'Linger on the Cobalt swatch to see further.', description: 'One word, seven echoes, and a vanishing point.' } },
  { id: 'orchid', kind: 'studio', fr: { title: 'Attraction littérale', hint: 'Un appui long sur Orchid met les lettres en orbite.', description: 'Chaque lettre a son propre centre de gravité.' }, en: { title: 'Literal attraction', hint: 'A long press on Orchid sends letters into orbit.', description: 'Every letter has its own centre of gravity.' } },
  { id: 'coral', kind: 'studio', fr: { title: 'Le couple AV', hint: 'La pastille Coral rapproche les lettres quand on insiste.', description: 'Une histoire d’amour et de crénage.' }, en: { title: 'The AV couple', hint: 'The Coral swatch brings letters closer if you linger.', description: 'A love story about kerning.' } },
  { id: 'gravity', kind: 'film', fr: { title: 'Gravité', hint: 'Composez une phrase : « La gravité est une … » Une loi ? Ou une simple suggestion ?', description: 'Un film qui laisse les mots suivre leur propre poids.' }, en: { title: 'Gravity', hint: 'Compose a sentence: “Gravity is a …” A law? Or just a suggestion?', description: 'A film that lets words follow their own weight.' } },
  { id: 'boomerang', kind: 'film', fr: { title: 'Boomerang', hint: 'Composez une phrase : « Les mots reviennent … » Pas seulement parfois.', description: 'Une chorégraphie qui connaît le chemin du retour.' }, en: { title: 'Boomerang', hint: 'Compose a sentence: “Words … come back.” More often than sometimes.', description: 'A choreography that knows its way back.' } },
  { id: 'vertigo', kind: 'film', fr: { title: 'Vertige', hint: 'Composez une phrase : « Les mots ont le … » Regardez en bas.', description: 'Les mots ont trouvé une autre perspective.' }, en: { title: 'Vertigo', hint: 'Compose a sentence: “Words are feeling …” After spinning round and round.', description: 'Words have found another perspective.' } },
  { id: 'tunnel', kind: 'film', fr: { title: 'Tunnel', hint: 'Composez une phrase : « Il y a un monde derrière les … » Regardez de l’autre côté du texte.', description: 'Un voyage au cœur de la typographie.' }, en: { title: 'Tunnel', hint: 'Compose a sentence: “There is a world behind the …” Look through the text.', description: 'A journey into the heart of typography.' } },
  { id: 'supernova', kind: 'film', fr: { title: 'Supernova', hint: 'Composez une phrase : « Une petite phrase peut devenir une … » Une étoile qui explose.', description: 'Les mots ont de l’énergie à libérer.' }, en: { title: 'Supernova', hint: 'Compose a sentence: “A little sentence can become a …” An exploding star.', description: 'Words have energy to release.' } },
  { id: 'seventh-face', kind: 'film', fr: { title: 'Hasard, face 7', hint: 'Même le hasard cache quelque chose.', description: 'Le dé avait prévu une prise supplémentaire.' }, en: { title: 'Chance, face 7', hint: 'Even chance is hiding something.', description: 'The die had planned an extra take.' } },
];

const longTargets: Readonly<Record<string, string>> = {
  '.brand-mark': 'after-hours', '.brand': 'after-hours', '.sunset-stamp': 'after-hours',
  '.example-button': 'seventh-die', '.remix-button': 'bloopers', '.replay-button': 'rewind',
  '[data-theme="acid"]': 'acid-rain', '[data-theme="monochrome"]': 'silent-film',
  '[data-theme="cobalt"]': 'cobalt', '[data-theme="orchid"]': 'orchid',
  '[data-theme="coral-night"]': 'coral', '.audio-button': 'orchestra', '.film-index': 'constellation',
};
const longSelector = Object.keys(longTargets).join(',');
const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const diePhrase: Record<EggLocale, string> = { fr: 'Même le hasard cache quelque chose.', en: 'Even chance is hiding something.' };
const filmPhrases: Readonly<Record<string, Record<EggLocale, string>>> = {
  gravity: { fr: 'La gravité est une suggestion.', en: 'Gravity is a suggestion.' },
  boomerang: { fr: 'Les mots reviennent toujours.', en: 'Words always come back.' },
  vertigo: { fr: 'Les mots ont le vertige.', en: 'Words are feeling dizzy.' },
  tunnel: { fr: 'Il y a un monde derrière les lettres.', en: 'There is a world behind the letters.' },
  supernova: { fr: 'Une petite phrase peut devenir une supernova.', en: 'A little sentence can become a supernova.' },
  'seventh-face': diePhrase,
};

const uiCopy = {
  fr: { collection: 'Les secrets du studio', button: 'Secrets', close: 'Fermer', studio: 'Dans le studio', films: 'Films cachés', unknown: 'Secret', found: 'découverts', replay: 'Revoir', credits: 'Une production CREACTORS', text: 'Texte', you: 'Vous', stunts: 'Cascades', letters: 'Les lettres', editing: 'Montage', chance: 'Le hasard', sound: 'Bande originale', silence: 'Le silence, si vous préférez', final: 'Et aucun mot n’a été blessé pendant le tournage.', offer: 'Le dé a une septième face. Elle vous propose une phrase à mettre en scène.', load: 'Charger cette phrase', note: 'Les petites animations du studio restent hors de la vidéo. Les films cachés se découvrent avec CREATE.', keyboard: 'Au clavier : Maj + Entrée remplace un appui long sur une commande.', cut: 'COUPEZ !', quiet: 'LES MOTS N’ONT PAS BESOIN DE SON POUR BOUGER.', rewind: 'RETOUR', question: 'LA QUESTION RESTE À TROUVER.', foundOne: 'Secret découvert' },
  en: { collection: 'The studio’s secrets', button: 'Secrets', close: 'Close', studio: 'In the studio', films: 'Hidden films', unknown: 'Secret', found: 'discovered', replay: 'Replay', credits: 'A CREACTORS production', text: 'Words', you: 'You', stunts: 'Stunts', letters: 'The letters', editing: 'Editing', chance: 'Chance', sound: 'Original score', silence: 'Silence, if you prefer', final: 'No words were harmed during the making of this film.', offer: 'The die has a seventh face. It has a phrase for you to put in motion.', load: 'Load this phrase', note: 'The studio’s little animations stay outside your video. Hidden films are discovered with CREATE.', keyboard: 'On a keyboard: Shift + Enter replaces a long press on a control.', cut: 'CUT!', quiet: 'WORDS DON’T NEED SOUND TO MOVE.', rewind: 'REWIND', question: 'WE STILL NEED THE QUESTION.', foundOne: 'Secret discovered' },
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Decorative DOM microfilms only: this module never touches the renderer or export canvas. */
export function mountEasterEggs(host: HTMLElement, options: EasterEggOptions): EasterEggs {
  const controller = new AbortController();
  const { signal } = controller;
  const found = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const originalAttributes = new Map<HTMLElement, Record<string, string | null>>();
  const studio = host.querySelector<HTMLElement>('.studio') ?? host;
  let destroyed = false;
  let lastLocale: EggLocale | null = null;
  let activeEffect: string | null = null;
  let effectTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreBrand: (() => void) | null = null;
  let opener: HTMLElement | null = null;
  let dialogView: 'collection' | 'credits' | 'seventh-die' = 'collection';
  let sequence = 0;
  let sequenceAt = 0;
  let pointer: { id: number; x: number; y: number; target: HTMLElement; secret: string; timer: ReturnType<typeof setTimeout> | null; fired: boolean } | null = null;
  let suppressed: { target: HTMLElement; until: number } | null = null;
  const taps = new Map<string, { count: number; last: number }>();

  const collectionButton = element('button', 'egg-collection-button');
  collectionButton.type = 'button';
  collectionButton.hidden = true;
  collectionButton.setAttribute('aria-haspopup', 'dialog');
  collectionButton.setAttribute('aria-controls', 'studio-secrets');
  const footer = host.querySelector('.studio-footer');
  if (footer) footer.insertBefore(collectionButton, footer.querySelector('.footer-index'));
  else (host.querySelector('.header-actions') ?? studio).append(collectionButton);

  const overlay = element('div', 'egg-overlay');
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  const announcement = element('p', 'egg-announcement');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  announcement.hidden = true;
  const dialog = element('dialog', 'egg-dialog');
  dialog.id = 'studio-secrets';
  dialog.setAttribute('aria-labelledby', 'studio-secrets-title');
  studio.append(overlay, announcement, dialog);

  function locale(): EggLocale { return options.getLocale(); }
  function copy() { return uiCopy[locale()]; }
  function metadata(id: string) { return secrets.find(secret => secret.id === id); }
  function allowed() {
    return !destroyed && !options.isBlocked() && !host.querySelector('dialog[open]');
  }
  function later(callback: () => void, ms: number) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
    timers.add(timer);
    return timer;
  }
  function cancel(timer: ReturnType<typeof setTimeout> | null) {
    if (timer !== null) { clearTimeout(timer); timers.delete(timer); }
  }
  function clearEffect() {
    cancel(effectTimer);
    effectTimer = null;
    activeEffect = null;
    overlay.hidden = true;
    overlay.replaceChildren();
    delete overlay.dataset.effect;
    restoreBrand?.();
    restoreBrand = null;
  }
  function updateButton() {
    collectionButton.hidden = found.size === 0;
    collectionButton.disabled = options.isBlocked();
    collectionButton.textContent = `◇ ${copy().button} ${String(found.size).padStart(2, '0')}/${secrets.length}`;
    collectionButton.setAttribute('aria-label', `${copy().collection} · ${found.size}/${secrets.length} ${copy().found}`);
  }
  function discover(id: string, announce = true) {
    const secret = metadata(id);
    if (!secret || destroyed) return;
    const isNew = !found.has(id);
    found.add(id);
    updateButton();
    if (dialog.open && dialogView === 'collection') renderDialog();
    if (announce) {
      cancel(noticeTimer);
      announcement.textContent = `${isNew ? `${copy().foundOne} · ` : ''}${secret[locale()].title}. ${secret[locale()].description}`;
      announcement.hidden = false;
      noticeTimer = later(() => { announcement.hidden = true; announcement.textContent = ''; }, 4400);
    }
  }

  function drawScene(id: string) {
    const card = element('div', `egg-microfilm egg-${id}`);
    const label = element('span', 'egg-film-label', `CREACTORS / ${String(secrets.findIndex(secret => secret.id === id) + 1).padStart(3, '0')}`);
    const scene = element('div', 'egg-scene');
    const title = element('span', 'egg-film-title', metadata(id)?.[locale()].title ?? '');
    card.append(label, scene, title);
    if (id === 'falling') {
      'CREACTORS'.split('').forEach((letter, index) => {
        const glyph = element('span', 'egg-falling-letter', letter);
        glyph.style.setProperty('--i', String(index));
        glyph.style.setProperty('--turn', `${index % 2 === 0 ? 19 : -16}deg`);
        scene.append(glyph);
      });
    } else if (id === 'after-hours' || id === 'constellation') {
      const stars = element('div', 'egg-stars');
      for (let i = 0; i < 26; i++) {
        const star = element('span', 'egg-star', i % 5 === 0 ? '+' : '·');
        star.style.setProperty('--x', `${5 + ((i * 37) % 91)}%`);
        star.style.setProperty('--y', `${8 + ((i * 29) % 77)}%`);
        star.style.setProperty('--i', String(i));
        stars.append(star);
      }
      scene.append(stars);
      if (id === 'after-hours') scene.append(element('span', 'egg-setting-sun'), element('span', 'egg-horizon'), element('strong', 'egg-after-hours-word', 'AFTER HOURS'));
      else {
        const lines = element('div', 'egg-constellation-lines');
        for (let i = 0; i < 5; i++) { const line = element('span', 'egg-star-line'); line.style.setProperty('--i', String(i)); lines.append(line); }
        scene.append(lines, element('strong', 'egg-constellation-word', 'MAKE\nWORDS\nMOVE'));
      }
    } else if (id === 'bloopers') {
      const cast = element('div', 'egg-blooper-cast');
      'TAKE'.split('').forEach((letter, index) => { const glyph = element('span', `egg-blooper-letter egg-blooper-${index}`, letter); cast.append(glyph); });
      scene.append(cast, element('span', 'egg-cut', copy().cut), element('span', 'egg-take-number', 'TAKE 002'));
    } else if (id === 'rewind') {
      const strip = element('div', 'egg-film-strip');
      ['MOVE', 'WORDS', 'MAKE', 'MOVE', 'WORDS', 'MAKE'].forEach((word, index) => {
        const frame = element('div', 'egg-film-frame');
        frame.append(element('small', '', `0${6 - index}`), element('strong', '', word));
        strip.append(frame);
      });
      scene.append(strip, element('span', 'egg-rewind-label', `◀◀ ${copy().rewind}`));
    } else if (id === 'acid-rain') {
      for (let i = 0; i < 17; i++) {
        const column = element('span', 'egg-rain-column', ['M\nO\nV\nE\n·\n1', 'C\nR\nE\nA\nT\nE', '0\n1\n/\nA\n?\n7'][i % 3]);
        column.style.setProperty('--i', String(i));
        column.style.setProperty('--x', `${i * 6}%`);
        scene.append(column);
      }
      scene.append(element('strong', 'egg-rain-caption', 'TYPE WEATHER'));
    } else if (id === 'silent-film') {
      const silent = element('div', 'egg-silent-card');
      silent.append(element('span', 'egg-silent-flourish', '❧'), element('strong', '', copy().quiet), element('span', 'egg-silent-flourish', '❧'));
      scene.append(silent, element('span', 'egg-silent-date', 'MCMXXVI'));
    } else if (id === 'answer42') {
      scene.append(element('strong', 'egg-answer-number', '00:42'), element('span', 'egg-answer-question', copy().question), element('span', 'egg-answer-orbit', '*'));
    } else if (id === 'orchestra') {
      const bars = element('div', 'egg-orchestra-bars');
      'MAKEWORDSMOVE'.split('').forEach((letter, index) => {
        const bar = element('span', 'egg-orchestra-bar');
        bar.style.setProperty('--i', String(index));
        bar.style.setProperty('--height', `${34 + ((index * 17) % 58)}%`);
        bar.append(element('span', '', letter));
        bars.append(bar);
      });
      scene.append(bars, element('span', 'egg-orchestra-caption', '♪  ∅ dB'));
    } else if (id === 'cobalt') {
      for (let i = 0; i < 7; i++) {
        const echo = element('strong', 'egg-blue-echo', 'ECHO');
        echo.style.setProperty('--i', String(i));
        scene.append(echo);
      }
      scene.append(element('span', 'egg-blue-point', '·'));
    } else if (id === 'orchid') {
      scene.append(element('span', 'egg-orbit-ring'), element('strong', 'egg-orbit-core', 'O'));
      'RBIT'.split('').forEach((letter, index) => { const orbit = element('span', 'egg-orbit-letter', letter); orbit.style.setProperty('--i', String(index)); scene.append(orbit); });
    } else if (id === 'coral') {
      scene.append(element('strong', 'egg-kern-a', 'A'), element('strong', 'egg-kern-v', 'V'), element('span', 'egg-kern-heart', '♡'), element('span', 'egg-kern-caption', 'KERNING IS CARING'));
    }
    overlay.replaceChildren(card);
  }

  function fallingBrand() {
    const brandName = host.querySelector<HTMLElement>('.brand-name');
    if (!brandName) return;
    const original = Array.from(brandName.childNodes);
    const letters = (brandName.textContent ?? 'CREACTORS').split('').map((letter, index) => {
      const glyph = element('span', '', letter);
      glyph.style.setProperty('--i', String(index));
      glyph.style.setProperty('--turn', `${index % 2 ? -17 : 20}deg`);
      return glyph;
    });
    brandName.replaceChildren(...letters);
    brandName.classList.add('egg-brand-falling');
    restoreBrand = () => { brandName.replaceChildren(...original); brandName.classList.remove('egg-brand-falling'); };
  }

  function trigger(id: string, source?: HTMLElement) {
    if (!allowed()) return;
    discover(id);
    clearEffect();
    if (id === 'credits' || id === 'seventh-die') { openDialog(id, source); return; }
    activeEffect = id;
    overlay.dataset.effect = id;
    drawScene(id);
    overlay.hidden = false;
    if (id === 'falling') fallingBrand();
    effectTimer = later(clearEffect, 3700);
  }

  function renderDialog() {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const replayId = previouslyFocused?.dataset.secretReplay;
    const filmId = previouslyFocused?.dataset.filmPhrase;
    const closeHadFocus = previouslyFocused?.classList.contains('egg-dialog-close');
    const loadHadFocus = previouslyFocused?.classList.contains('egg-load-phrase');
    const scrollTop = dialog.scrollTop;
    const c = copy();
    const heading = element('div', 'egg-dialog-heading');
    const title = element('h2', '', dialogView === 'collection' ? c.collection : metadata(dialogView)?.[locale()].title);
    title.id = 'studio-secrets-title';
    const close = element('button', 'egg-dialog-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', c.close);
    close.autofocus = true;
    heading.append(title, close);
    dialog.replaceChildren(heading);
    dialog.dataset.view = dialogView;
    if (dialogView === 'collection') {
      dialog.append(element('p', 'egg-collection-count', `${String(found.size).padStart(2, '0')} / ${secrets.length} ${c.found}`));
      for (const kind of ['studio', 'film'] as const) {
        const section = element('section', 'egg-collection-section');
        section.append(element('h3', '', kind === 'studio' ? c.studio : c.films));
        const list = element('ol', 'egg-collection');
        secrets.filter(secret => secret.kind === kind).forEach(secret => {
          const index = secrets.indexOf(secret) + 1;
          const item = element('li', 'egg-secret');
          const isFound = found.has(secret.id);
          item.dataset.secretId = secret.id;
          item.dataset.found = String(isFound);
          item.append(element('span', 'egg-secret-number', `${isFound ? '✦' : '◇'} ${String(index).padStart(2, '0')}`));
          const details = element('div', 'egg-secret-details');
          details.append(element('strong', '', isFound ? secret[locale()].title : `${c.unknown} ${String(index).padStart(2, '0')}`), element('p', '', isFound ? secret[locale()].description : secret[locale()].hint));
          if (isFound && secret.kind === 'film') details.append(element('p', 'egg-found-phrase', filmPhrases[secret.id][locale()]));
          item.append(details);
          if (isFound && secret.kind === 'studio') {
            const replay = element('button', 'egg-secret-replay', '↗');
            replay.type = 'button';
            replay.dataset.secretReplay = secret.id;
            replay.setAttribute('aria-label', `${c.replay} · ${secret[locale()].title}`);
            item.append(replay);
          } else if (isFound && secret.kind === 'film') {
            const load = element('button', 'egg-secret-replay', '↗');
            load.type = 'button';
            load.dataset.filmPhrase = secret.id;
            load.setAttribute('aria-label', `${c.load} · ${secret[locale()].title}`);
            item.append(load);
          }
          list.append(item);
        });
        section.append(list);
        dialog.append(section);
      }
      dialog.append(element('p', 'egg-dialog-note', c.note), element('p', 'egg-dialog-note egg-keyboard-note', c.keyboard));
    } else if (dialogView === 'credits') {
      const credits = element('div', 'egg-credits');
      credits.append(element('p', 'egg-credit-eyebrow', c.credits));
      const list = element('dl', 'egg-credit-list');
      [[c.text, c.you], [c.stunts, c.letters], [c.editing, c.chance], [c.sound, c.silence]].forEach(([role, name]) => list.append(element('dt', '', role), element('dd', '', name)));
      credits.append(list, element('p', 'egg-credit-final', c.final), element('strong', 'egg-credit-end', 'FIN / THE END'));
      dialog.append(credits);
    } else {
      const seventh = element('div', 'egg-seventh');
      const die = element('div', 'egg-seventh-face', '7');
      die.setAttribute('aria-hidden', 'true');
      const load = element('button', 'egg-load-phrase', c.load);
      load.type = 'button';
      seventh.append(die, element('p', '', c.offer), element('blockquote', 'egg-seventh-phrase', diePhrase[locale()]), load);
      dialog.append(seventh);
    }
    if (dialog.open) {
      if (closeHadFocus) close.focus({ preventScroll: true });
      else if (replayId) dialog.querySelector<HTMLElement>(`[data-secret-replay="${replayId}"]`)?.focus({ preventScroll: true });
      else if (filmId) dialog.querySelector<HTMLElement>(`[data-film-phrase="${filmId}"]`)?.focus({ preventScroll: true });
      else if (loadHadFocus) dialog.querySelector<HTMLElement>('.egg-load-phrase')?.focus({ preventScroll: true });
      dialog.scrollTop = scrollTop;
    }
  }

  function openDialog(view: typeof dialogView, source?: HTMLElement) {
    if (destroyed || options.isBlocked() || dialog.open) return;
    opener = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : collectionButton);
    dialogView = view;
    clearEffect();
    renderDialog();
    dialog.showModal();
  }
  collectionButton.addEventListener('click', () => { if (allowed()) openDialog('collection', collectionButton); }, { signal });
  dialog.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.egg-dialog-close')) { dialog.close(); return; }
    const replay = target.closest<HTMLElement>('[data-secret-replay]');
    if (replay?.dataset.secretReplay) { const id = replay.dataset.secretReplay; dialog.close(); trigger(id, collectionButton); return; }
    const film = target.closest<HTMLElement>('[data-film-phrase]');
    if (film?.dataset.filmPhrase && !options.isBlocked()) {
      const phrase = filmPhrases[film.dataset.filmPhrase]?.[locale()];
      if (phrase) { dialog.close(); options.onSecretExample(phrase); }
      return;
    }
    if (target.closest('.egg-load-phrase')) {
      if (options.isBlocked()) return;
      const phrase = diePhrase[locale()];
      dialog.close();
      options.onSecretExample(phrase);
      return;
    }
    if (target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  }, { signal });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (!destroyed) (opener?.isConnected ? opener : collectionButton).focus({ preventScroll: true });
    opener = null;
  }, { signal });

  function longMatch(target: Element | null): { target: HTMLElement; secret: string } | null {
    const match = target?.closest<HTMLElement>(longSelector);
    if (!match || !host.contains(match) || match.closest('.egg-dialog')) return null;
    if (match instanceof HTMLButtonElement && match.disabled) return null;
    for (const [selector, secret] of Object.entries(longTargets)) if (match.matches(selector)) return { target: match, secret };
    return null;
  }
  function cancelPointer() { if (pointer) cancel(pointer.timer); pointer = null; }
  host.addEventListener('pointerdown', event => {
    if (!allowed() || event.button !== 0 || !event.isPrimary) return;
    suppressed = null;
    cancelPointer();
    const match = longMatch(event.target instanceof Element ? event.target : null);
    if (!match) return;
    const gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, ...match, timer: null as ReturnType<typeof setTimeout> | null, fired: false };
    pointer = gesture;
    gesture.timer = later(() => {
      gesture.timer = null;
      if (pointer !== gesture || !allowed()) return;
      gesture.fired = true;
      suppressed = { target: gesture.target, until: performance.now() + 1600 };
      trigger(gesture.secret, gesture.target.closest<HTMLElement>('a,button,[tabindex]') ?? gesture.target);
    }, 720);
  }, { capture: true, signal });
  window.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id || pointer.fired) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) cancelPointer();
  }, { capture: true, passive: true, signal });
  window.addEventListener('pointerup', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (pointer.fired) suppressed = { target: pointer.target, until: performance.now() + 1000 };
    cancelPointer();
  }, { capture: true, signal });
  window.addEventListener('pointercancel', event => { if (pointer?.id === event.pointerId) cancelPointer(); }, { capture: true, signal });
  window.addEventListener('blur', event => { if (event.target === window) { cancelPointer(); sequence = 0; } }, { signal });
  window.addEventListener('pagehide', cancelPointer, { signal });
  host.addEventListener('contextmenu', event => {
    if (pointer?.fired && event.target instanceof Node && pointer.target.contains(event.target)) event.preventDefault();
  }, { capture: true, signal });

  function countTap(id: string, limit: number, source: HTMLElement) {
    if (!allowed()) return;
    const now = performance.now();
    const previous = taps.get(id);
    const count = previous && now - previous.last < 900 ? previous.count + 1 : 1;
    taps.set(id, { count, last: now });
    if (count >= limit) { taps.delete(id); trigger(id, source); }
  }
  host.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (suppressed && performance.now() <= suppressed.until && (suppressed.target.contains(target) || target.contains(suppressed.target))) {
      suppressed = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const brand = target.closest<HTMLElement>('.brand');
    if (brand) { event.preventDefault(); countTap('falling', 5, brand); return; }
    const footer = target.closest<HTMLElement>('.footer-index');
    if (footer) { countTap('credits', 3, footer); return; }
    const clock = target.closest<HTMLElement>('.timecode');
    if (clock) countTap('answer42', 3, clock);
  }, { capture: true, signal });

  for (const selector of ['.footer-index', '.timecode']) {
    const target = host.querySelector<HTMLElement>(selector);
    if (!target) continue;
    const saved: Record<string, string | null> = {};
    for (const attribute of ['tabindex', 'role', 'aria-hidden', 'aria-label']) saved[attribute] = target.getAttribute(attribute);
    originalAttributes.set(target, saved);
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.removeAttribute('aria-hidden');
  }
  host.addEventListener('keydown', event => {
    if (!(event.target instanceof Element) || event.repeat || !allowed()) return;
    if (event.shiftKey && event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const match = longMatch(event.target);
      const simple = event.target.closest<HTMLElement>('.footer-index,.timecode');
      if (!match && !simple) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      trigger(match?.secret ?? (simple?.matches('.footer-index') ? 'credits' : 'answer42'), match?.target ?? simple ?? undefined);
    } else if (event.key === 'Enter' || event.key === ' ') {
      const simple = event.target.closest<HTMLElement>('.footer-index,.timecode');
      if (simple) { event.preventDefault(); simple.click(); }
    }
  }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeEffect) { clearEffect(); announcement.hidden = true; sequence = 0; return; }
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') || !allowed()) { sequence = 0; return; }
    if (!host.contains(target) && target !== document.body) return;
    const now = performance.now();
    if (now - sequenceAt > 5000) sequence = 0;
    sequenceAt = now;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    sequence = key === konami[sequence] ? sequence + 1 : key === konami[0] ? 1 : 0;
    if (sequence === konami.length) { sequence = 0; trigger('constellation'); }
  }, { signal });

  const observer = new MutationObserver(() => {
    collectionButton.disabled = options.isBlocked();
    if (!options.isBlocked()) return;
    cancelPointer();
    clearEffect();
    announcement.hidden = true;
  });
  observer.observe(studio, { attributes: true, attributeFilter: ['data-state', 'data-image-loading', 'data-audio-loading'] });

  function setLocale() {
    if (destroyed) return;
    if (lastLocale === locale()) return;
    lastLocale = locale();
    updateButton();
    const footer = host.querySelector<HTMLElement>('.footer-index');
    footer?.setAttribute('aria-label', locale() === 'fr' ? 'Crédit du studio' : 'Studio credit');
    const clock = host.querySelector<HTMLElement>('.timecode');
    clock?.setAttribute('aria-label', locale() === 'fr' ? 'Compteur du film' : 'Film clock');
    if (dialog.open) renderDialog();
    if (activeEffect) drawScene(activeEffect);
    if (!announcement.hidden) { announcement.hidden = true; announcement.textContent = ''; }
  }
  setLocale();

  return {
    setLocale,
    discoverFilm(id) { if (metadata(id)?.kind === 'film') discover(id, false); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controller.abort();
      observer.disconnect();
      cancelPointer();
      clearEffect();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (dialog.open) dialog.close();
      collectionButton.remove(); overlay.remove(); announcement.remove(); dialog.remove();
      for (const [target, attributes] of originalAttributes) for (const [name, value] of Object.entries(attributes)) {
        if (value === null) target.removeAttribute(name); else target.setAttribute(name, value);
      }
      taps.clear();
      suppressed = null;
    },
  };
}
