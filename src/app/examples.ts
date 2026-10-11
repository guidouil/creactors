type ExampleLanguage = 'fr' | 'en';

/** Original short texts, bundled locally for the French and English interfaces. */
export const EXAMPLES: Readonly<Record<ExampleLanguage, readonly string[]>> = Object.freeze({
  fr: Object.freeze([
    "Mon idée tient sur un ticket. Son ambition dépasse la ville.",
    "Aujourd'hui, je donne une forme au petit bruit dans ma tête.",
    "Et si notre prochain détour devenait le début de l'histoire ?",
    "J'ai rangé mes doutes. Ils dépassent encore du tiroir.",
    "Une fenêtre ouverte, trois idées, et plus aucune envie d'attendre.",
    "Ce matin, même mon café avait des projets trop grands.",
    "Pourquoi marcher dans les traces quand on peut changer de terrain ?",
    "On avait prévu du calme. Nos idées ont choisi le contraire.",
    "Le déclic ne fait pas toujours du bruit. Parfois, il chuchote.",
    "J'avance doucement, mais mon regard est déjà trois rues plus loin.",
    "Qui a dit que les jours gris devaient rester sans couleur ?",
    "Une petite étincelle vient de bouleverser mon emploi du temps.",
    "Pas besoin d'un grand départ. Ouvrons déjà cette porte.",
    "Ma meilleure idée s'est invitée pendant que je cherchais autre chose.",
    "Nous dessinons un chemin que la carte n'a pas encore remarqué.",
    "Et si on laissait une place à ce qui nous étonne ?",
    "J'ai changé un mot. Toute la pièce a changé d'ambiance.",
    "Encore un essai. Encore un détour. Cette fois, quelque chose s'allume.",
    "Les mains pleines de brouillons, le cœur prêt à recommencer.",
    "Ce projet était minuscule. Il prend maintenant toute la table.",
    "Combien d'idées attendent derrière ce petit bouton ?",
    "Le plan disait demain. L'envie a répondu maintenant.",
    "Je garde une marge blanche pour les surprises.",
    "Nos hésitations font du surplace. Nos envies ont déjà pris le train.",
    "Une phrase, deux respirations, mille façons de faire vibrer l'écran.",
    "Tu vois un mur ? J'y vois l'emplacement d'une fenêtre.",
    "Même les idées timides méritent un éclairage de cinéma.",
    "La ville s'endort. Mon carnet vient de se réveiller.",
    "Aujourd'hui, le détail que personne ne regardait prend toute la lumière.",
    "Si l'on essayait autrement, juste pour voir où cela nous mène ?",
    "D'abord un murmure. Puis un rythme. Enfin, notre voix.",
    "J'ai oublié la recette. Le résultat a l'air plutôt intéressant.",
    "Rien ne bouge encore. Pourtant, l'air a déjà changé.",
    "Un peu de travers, beaucoup d'élan, et voilà notre départ.",
    "Pourquoi nos rêves devraient-ils tenir dans les cases du calendrier ?",
    "Le brouillon déborde. C'est peut-être une bonne nouvelle.",
    "Je ne cherche plus la ligne droite. Je cherche le bon mouvement.",
    "Nos mots sortent du carnet pour prendre l'air.",
    "Un pas pour essayer. Un autre pour y croire. Le troisième nous surprend.",
    "Et maintenant, que fait-on de toute cette énergie ?",
    "Mon écran est petit. Ce que j'ai à dire prend de la place.",
    "Les questions ont ouvert la porte. Les réponses arrivent en courant.",
    "On recommence, mais cette fois avec les fenêtres grandes ouvertes.",
    "Ma journée avait un programme. Une idée l'a entièrement redessiné.",
    "Le silence laisse assez de place pour entendre la prochaine idée.",
    "Une minute de courage vient de déplacer toute la semaine.",
    "Qui veut embarquer dans cette idée qui n'a pas encore de nom ?",
    "Le dernier mot attendait son tour. Maintenant, tout tourne autour de lui.",
  ]),
  en: Object.freeze([
    'My idea fits on a receipt. Its ambition fills the whole street.',
    'Today, the tiny spark in my notebook gets a bigger stage.',
    'What if this unexpected turn became the start of our story?',
    "I put my doubts away. They keep peeking out of the drawer.",
    'One open window, three new ideas, and a very different afternoon.',
    'Even my coffee showed up with an ambitious plan this morning.',
    'Why follow the footprints when we could explore another shore?',
    'We scheduled a quiet day. Our ideas had other arrangements.',
    "The next breakthrough might arrive without knocking.",
    'My feet move slowly. My thoughts are already across the bridge.',
    'Who decided a cloudy day should come without any color?',
    'A tiny spark just rearranged everything on my calendar.',
    "We don't need a grand entrance. Let's start with this door.",
    'The idea I needed arrived while I was looking for my keys.',
    "We're making a path the map hasn't heard about yet.",
    'What happens when we leave a little room for surprise?',
    'I changed one word. The entire room felt different.',
    'Another try. Another turn. Something starts to light up.',
    'Hands full of sketches, pockets full of curious possibilities.',
    'This project started small. Now it needs the whole table.',
    'How many new worlds could fit behind one little button?',
    'The plan said tomorrow. The excitement said right now.',
    'I leave a blank margin for ideas that arrive late.',
    'Our doubts are standing still. Our curiosity already caught the train.',
    'A sentence, two breaths, and a screen that suddenly feels alive.',
    'You see a wall? I see a promising place for a window.',
    'Even shy ideas deserve a moment under the studio lights.',
    'The city fell asleep. My notebook just woke up.',
    'Today, the overlooked detail gets the brightest light in the room.',
    'Could we try it sideways, just to see where it takes us?',
    'First a whisper. Then a rhythm. Finally, a voice we recognize.',
    'I lost the instructions. The experiment got more interesting.',
    'Nothing has moved yet. Somehow, the room already feels different.',
    'A crooked sketch, a little momentum, and our first real step.',
    'Why should our biggest ideas fit inside calendar squares?',
    'The rough draft is overflowing. That might be a good sign.',
    "I'm looking for the right movement, even if it takes a winding road.",
    'Our words are leaving the notebook to get some fresh air.',
    'One step to try. Another to trust. The third catches us by surprise.',
    'Now what shall we do with all this unexpected energy?',
    'My screen is small. This thought needs a little more space.',
    'The questions opened the door. The answers are still running downstairs.',
    "Let's start again, with the windows open this time.",
    'My day had a schedule. One idea drew all over it.',
    'A quiet moment makes room for the next curious thought.',
    'One brave minute just shifted the shape of the whole week.',
    "Who wants to join an idea that doesn't have a name yet?",
    'The last word waited patiently. Now the whole scene revolves around it.',
  ]),
});

interface ExampleBag {
  remaining: string[];
  previous?: string;
}

/** A separate shuffle bag per interface language; examples never alter scene determinism. */
export class ExamplePicker {
  private readonly bags: Record<ExampleLanguage, ExampleBag> = {
    fr: { remaining: [] },
    en: { remaining: [] },
  };

  constructor(private readonly random: () => number = Math.random) {}

  next(language: ExampleLanguage): string {
    const bag = this.bags[language];
    if (bag.remaining.length === 0) {
      bag.remaining = [...EXAMPLES[language]];
      for (let index = bag.remaining.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(this.random() * (index + 1));
        [bag.remaining[index], bag.remaining[swapIndex]] = [bag.remaining[swapIndex]!, bag.remaining[index]!];
      }
      // Selection uses pop(), so a new cycle must not begin with the previous ending.
      const nextIndex = bag.remaining.length - 1;
      if (bag.remaining[nextIndex] === bag.previous) {
        [bag.remaining[0], bag.remaining[nextIndex]] = [bag.remaining[nextIndex]!, bag.remaining[0]!];
      }
    }
    const example = bag.remaining.pop()!;
    bag.previous = example;
    return example;
  }
}
