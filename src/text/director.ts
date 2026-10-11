import { graphemes, isEmojiCluster } from './graphemes';
import { detectTextLanguage, type InputLanguage, type ResolvedLanguage } from './language';

export type { InputLanguage, ResolvedLanguage } from './language';

export interface EmphasisScores {
  linguistic: number;
  narrative: number;
  visual: number;
  readability: number;
  composition: number;
}

export interface TextToken {
  text: string;
  key: string;
  start: number;
  end: number;
  sentence: number;
  emoji: boolean;
}

export interface ProtectedSpan {
  start: number;
  end: number;
  reason: 'expression' | 'negation' | 'auxiliary' | 'article';
}

export interface TextGroup {
  id: string;
  text: string;
  start: number;
  end: number;
  tokens: readonly TextToken[];
  wordCount: number;
  sentence: number;
  negation: boolean;
  contrast: boolean;
  repeated: boolean;
  conclusion: boolean;
  readingDuration: number;
  scores: EmphasisScores;
}

export interface TextAnalysis {
  version: string;
  sourceText: string;
  requestedLanguage: InputLanguage;
  language: ResolvedLanguage;
  languageConfidence: number;
  uncertainLanguage: boolean;
  groups: readonly TextGroup[];
  tokens: readonly TextToken[];
  protectedSpans: readonly ProtectedSpan[];
  wordCount: number;
  readingDuration: number;
}

const key = (text: string) => text.normalize('NFC').toLocaleLowerCase('en').replaceAll('’', "'");
const frenchFunctionWords = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'nous', 'vous', 'qui', 'que', 'ce', 'ne', 'pas', 'est', 'elle', 'il', 'on', 'avec', 'tout', 'en', 'si', 'plus', 'et']);
const englishFunctionWords = new Set(['the', 'a', 'an', 'of', 'we', 'you', 'it', 'is', 'are', 'does', 'not', 'what', 'if', 'with', 'to', 'and', 'us', 'your', 'more', 'less', 'than', 'them']);
const articles = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'the', 'a', 'an', 'your', 'our', 'their', 'my', 'its', 'this', 'that', 'these', 'those', 'son', 'sa', 'ses', 'ces', 'nos', 'vos', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'votre', 'leur', 'leurs', 'cet', 'cette']);
const auxiliaries = new Set(['est', 'sont', 'été', 'être', 'avoir', 'ont', 'ai', 'as', 'avait', 'sera', 'seront', 'is', 'are', 'was', 'were', 'been', 'will', 'would', 'could', 'should', 'can', 'has', 'have', 'had', 'do', 'does', 'did']);
const subjects = new Set(['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'i', 'you', 'we', 'it', 'he', 'she', 'they', 'who', 'what']);
const verbs = new Set(['crée', 'créons', 'créer', 'remplace', 'voit', 'attend', 'commençait', 'commence', 'est', 'sont', 'fait', 'font', 'devient', 'vaut', 'sait', 'peut', 'faut', 'imagine', 'ose', 'avance', 'change', 'is', 'are', 'create', 'creates', 'replace', 'replaces', 'awaits', 'started', 'starts', 'make', 'makes', 'ignore', 'dream', 'build', 'be', 'do', 'become', 'go', 'think', 'means']);
const stopWords = new Set([...frenchFunctionWords, ...englishFunctionWords, ...articles, ...auxiliaries, 'bien', 'se', 'me', 'te', 'dans', 'pour', 'sur', 'by', 'in', 'on', 'at']);
const contrastWords = new Set(['mais', 'pourtant', 'cependant', 'but', 'yet', 'however', 'instead', 'less', 'more', 'plutôt']);
const expressions = [
  ["c'est", 'ce', 'que'], ['ce', 'qui'], ['ce', 'que'], ['et', 'si'], ['de', 'nouveaux'],
  ['tout', 'à', 'coup'], ['en', 'train', 'de'], ['il', 'y', 'a'], ['afin', 'de'], ['au', 'lieu', 'de'],
  ['pendant', 'que'], ['parce', 'que'], ['alors', 'que'],
  ['it', 'is', 'what'], ['what', 'if'], ['in', 'order', 'to'], ['as', 'well', 'as'], ['rather', 'than'],
  ['give', 'up'], ['showed', 'up'], ['woke', 'up'], ['light', 'up'], ['standing', 'still'],
];

const clitics = new Set(['en', 'y', 'me', 'te', 'se', 'le', 'la', 'les', 'lui', 'leur']);
const linkingWords = new Set([...articles, ...auxiliaries, ...subjects, 'à', 'au', 'aux', 'en', 'et', 'si', 'qui', 'que', 'ce', 'se', 'me', 'te', 'y', 'pour', 'avec', 'dans', 'sur', 'to', 'of', 'and', 'with', 'in', 'on', 'at', 'us', 'them', 'which', 'when', 'while', 'because']);
// Only confident prenominal adjectives are protected. Unknown grammar still
// receives the compact partition rather than an expanding noun-phrase guess.
const adjectives = new Set(['petit', 'petite', 'petits', 'petites', 'grand', 'grande', 'grands', 'grandes', 'nouveau', 'nouvelle', 'nouveaux', 'nouvelles', 'bon', 'bonne', 'bons', 'bonnes', 'dernier', 'dernière', 'premier', 'première', 'prochain', 'prochaine', 'meilleur', 'meilleure', 'même', 'toute', 'tout', 'tiny', 'little', 'small', 'big', 'bigger', 'grand', 'new', 'open', 'ambitious', 'quiet', 'next', 'different', 'unexpected', 'entire', 'curious', 'real', 'good', 'rough', 'cloudy', 'brave', 'blank', 'promising', 'shy', 'overlooked', 'last', 'fresh', 'whole', 'right', 'winding', 'crooked', 'first', 'third', 'other', 'great', 'best', 'better', 'brightest', 'extraordinary']);
const MAX_GROUP_WORDS = 4;

const isAuxiliary = (word: string) => auxiliaries.has(word) || /^(?:[lmsntcj]|qu)'(?:a|ai|as|avons|avez|ont|avait|avaient|est|était|étaient)$/u.test(word);
const isPredicate = (word: string) => verbs.has(word) || /(?:[ée]s?|ies?|ues?|ed)$/u.test(word);

interface SemanticNegation {
  first: number;
  end: number;
  restriction: boolean;
}

function scan(text: string): TextToken[] {
  // Native segmentation is useful candidate information. The pinned scanner owns
  // final spans so different Intl data versions cannot alter a generated film.
  if (typeof Intl.Segmenter === 'function') {
    const nativeCandidates = new Intl.Segmenter('en', { granularity: 'word' });
    void nativeCandidates.segment(text);
  }
  const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
  const tokens: TextToken[] = [];
  for (const match of text.matchAll(wordPattern)) {
    tokens.push({ text: match[0], key: key(match[0]), start: match.index, end: match.index + match[0].length, sentence: 0, emoji: false });
  }
  let offset = 0;
  for (const cluster of graphemes(text)) {
    if (isEmojiCluster(cluster)) {
      const covered = tokens.findIndex(token => token.start >= offset && token.end <= offset + cluster.length);
      if (covered !== -1) tokens.splice(covered, 1);
      tokens.push({ text: cluster, key: cluster, start: offset, end: offset + cluster.length, sentence: 0, emoji: true });
    }
    offset += cluster.length;
  }
  tokens.sort((a, b) => a.start - b.start);
  let sentence = 0;
  const abbreviations = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'etc', 'mme', 'm', 'st', 'vs']);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    token.sentence = sentence;
    const nextStart = tokens[i + 1]?.start ?? text.length;
    const gap = text.slice(token.end, nextStart);
    if ((/[!?…]/u.test(gap) || /\./u.test(gap) && !abbreviations.has(token.key) || /\n\s*\n/u.test(gap)) && i < tokens.length - 1) sentence++;
  }
  return tokens;
}

function semanticNegations(tokens: readonly TextToken[], text: string): SemanticNegation[] {
  const scopes: SemanticNegation[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.key === 'ne' || /^n'/u.test(token.key)) {
      let limit = index + 1;
      while (limit < tokens.length && tokens[limit]!.sentence === token.sentence && !/[,;:—]/u.test(text.slice(tokens[limit - 1]!.end, tokens[limit]!.start))) limit++;
      let closer = index + 1;
      while (closer < limit && !['pas', 'jamais', 'plus', 'rien', 'personne', 'que'].includes(tokens[closer]!.key) && !/^qu'/u.test(tokens[closer]!.key)) closer++;
      const restriction = closer < limit && (tokens[closer]!.key === 'que' || /^qu'/u.test(tokens[closer]!.key));
      scopes.push({ first: index, end: closer < limit ? closer + 1 : limit, restriction });
    } else if (token.key === 'not' || token.key === 'cannot' || /n't$/u.test(token.key)) {
      const first = token.key === 'not' && index > 0 && auxiliaries.has(tokens[index - 1]!.key) ? index - 1 : index;
      const end = tokens[index + 1]?.sentence === token.sentence && verbs.has(tokens[index + 1]!.key) ? index + 2 : index + 1;
      scopes.push({ first, end, restriction: false });
    } else if (['pas', 'jamais', 'never', 'no'].includes(token.key) && !scopes.some(scope => index >= scope.first && index < scope.end)) {
      // Negation can also stand without "ne": Pas besoin / never stop.
      scopes.push({ first: index, end: tokens[index + 1]?.sentence === token.sentence ? index + 2 : index + 1, restriction: false });
    }
  }
  return scopes;
}

function protectedSpans(tokens: readonly TextToken[], text: string, scopes: readonly SemanticNegation[], forcedBreaks: ReadonlySet<number>): ProtectedSpan[] {
  const candidates: { first: number; end: number; reason: ProtectedSpan['reason'] }[] = [];
  const add = (first: number, last: number, reason: ProtectedSpan['reason']) => {
    const a = tokens[first]; const b = tokens[last];
    if (!a || !b || a.sentence !== b.sentence || last - first + 1 > MAX_GROUP_WORDS) return;
    for (let position = first + 1; position <= last; position++) {
      if (forcedBreaks.has(position) || /[,;:—]/u.test(text.slice(tokens[position - 1]!.end, tokens[position]!.start))) return;
    }
    candidates.push({ first, end: last + 1, reason });
  };
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i]!;
    const next = tokens[i + 1];
    if (next && current.sentence === next.sentence && articles.has(current.key)) {
      add(i, i + 1, 'article');
      // Short article/adjective/noun phrases form one reading unit. An extra
      // determiner (de toute notre équipe) is allowed only inside the same cap.
      let noun = i + 1;
      while (noun < i + MAX_GROUP_WORDS - 1 && tokens[noun]?.sentence === current.sentence && (adjectives.has(tokens[noun]!.key) || articles.has(tokens[noun]!.key))) noun++;
      if (noun > i + 1 && tokens[noun]?.sentence === current.sentence && !linkingWords.has(tokens[noun]!.key)) add(i, noun, 'article');
    }
    if (next && current.sentence === next.sentence && isAuxiliary(current.key)) {
      if (isPredicate(next.key) || isAuxiliary(next.key)) add(i, i + 1, 'auxiliary');
      else if (/ment$/u.test(next.key) && isPredicate(tokens[i + 2]?.key ?? '')) add(i, i + 2, 'auxiliary');
    }
    if (next && current.sentence === next.sentence && subjects.has(current.key) && (verbs.has(next.key) || isAuxiliary(next.key) || next.key === 'ne')) add(i, i + 1, 'auxiliary');
    if (next && subjects.has(current.key) && clitics.has(next.key) && verbs.has(tokens[i + 2]?.key ?? '')) add(i, i + 2, 'auxiliary');
    for (const expression of expressions) {
      if (expression.every((part, step) => tokens[i + step]?.key === part && tokens[i + step]?.sentence === current.sentence)) add(i, i + expression.length - 1, 'expression');
    }
    if (current.key === 'parce' && next && /^qu'/u.test(next.key)) add(i, i + 1, 'expression');
  }
  for (const scope of scopes) {
    const reason = scope.restriction ? 'expression' : 'negation';
    if (scope.end - scope.first <= 3) {
      add(scope.first, scope.end - 1, reason);
    } else {
      // Semantic scope is not an indivisible visual phrase. Keep each marker
      // attached locally while allowing long predicates to use several shots.
      const prefixEnd = clitics.has(tokens[scope.first + 1]?.key ?? '') ? scope.first + 2 : scope.first + 1;
      add(scope.first, Math.min(prefixEnd, scope.end - 1), reason);
      const closer = scope.end - 1;
      if (['pas', 'jamais', 'plus', 'rien', 'personne', 'que'].includes(tokens[closer]!.key) || /^qu'/u.test(tokens[closer]!.key)) {
        add(closer, Math.min(closer + 1, tokens.length - 1), reason);
      }
    }
  }
  // Overlapping protections must never form an unbreakable chain longer than
  // four words. Keep the strongest compact atoms; weaker grammar hints yield.
  const priority = { expression: 4, negation: 4, article: 3, auxiliary: 2 };
  candidates.sort((a, b) => priority[b.reason] - priority[a.reason] || a.first - b.first || a.end - b.end);
  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    let first = candidate.first;
    let end = candidate.end;
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const existing of accepted) {
        if (existing.first < end && existing.end > first) {
          const nextFirst = Math.min(first, existing.first);
          const nextEnd = Math.max(end, existing.end);
          if (nextFirst !== first || nextEnd !== end) { first = nextFirst; end = nextEnd; expanded = true; }
        }
      }
    }
    if (end - first <= MAX_GROUP_WORDS) accepted.push(candidate);
  }
  return accepted
    .sort((a, b) => a.first - b.first || a.end - b.end)
    .map(span => ({ start: tokens[span.first]!.start, end: tokens[span.end - 1]!.end, reason: span.reason }));
}

function safeBoundary(tokens: readonly TextToken[], index: number, protectedRanges: readonly ProtectedSpan[]): boolean {
  const next = tokens[index];
  if (!next || index === 0) return true;
  const previous = tokens[index - 1]!;
  if (previous.sentence !== next.sentence) return true;
  return !protectedRanges.some(span => next.start > span.start && next.start < span.end);
}

function preferredBoundaries(tokens: readonly TextToken[], first: number, end: number, spans: readonly ProtectedSpan[]): number[] {
  const boundaries = new Set<number>([first, end]);
  const add = (index: number) => { if (index > first && index < end && safeBoundary(tokens, index, spans)) boundaries.add(index); };
  // Negation is its own readable semantic unit, with its predicate attached.
  for (const span of spans.filter(span => span.reason === 'negation')) {
    const startIndex = tokens.findIndex(token => token.start === span.start);
    const endIndex = tokens.findIndex(token => token.end === span.end) + 1;
    if (startIndex >= first && startIndex < end) { add(startIndex); add(endIndex); }
  }
  const specialTurn = expressions.find(expression => expression.length === 3 && expression.every((part, step) => tokens[first + step]?.key === part));
  if (specialTurn) add(first + specialTurn.length);
  // Reliable predicate boundaries create useful noun/verb groups. Avoid breaking
  // interrogative or relative introductions whose grammar is less certain.
  const predicate = tokens.findIndex((token, index) => index >= first + 1 && index < end && verbs.has(token.key));
  if (predicate !== -1 && !spans.some(span => span.reason === 'negation' && tokens[predicate]!.start >= span.start && tokens[predicate]!.end <= span.end)) {
    if (!['ce', 'what', 'et', 'elle', 'it', 'on'].includes(tokens[first]!.key) && predicate - first >= 2) add(predicate);
    for (let i = predicate + 2; i < end - 1; i++) {
      if (articles.has(tokens[i]!.key) && end - i >= 2) { add(i); break; }
      if (tokens[i]!.key === 'que' && end - i >= 3) { add(i); break; }
    }
  }
  // French clitic combinations are kept with the verb: Elle en crée / de nouveaux.
  if (['elle', 'il', 'on', 'nous', 'vous'].includes(tokens[first]!.key)) {
    for (let i = first + 3; i < end - 1; i++) if (articles.has(tokens[i]!.key) && safeBoundary(tokens, i, spans)) { add(i); break; }
  }
  return [...boundaries].sort((a, b) => a - b);
}

function visualWidth(token: TextToken): number {
  if (token.emoji) return 2;
  // A font-independent density estimate, not a substitute for measured glyph
  // bounds. Combining marks do not make an accented word appear longer.
  return [...token.key.replace(/\p{M}/gu, '')].reduce((width, character) => width + (/[ilj'’]/u.test(character) ? 0.4 : /[mwœ]/u.test(character) ? 1.15 : 0.8), 0);
}

function compactBoundaries(tokens: readonly TextToken[], text: string, first: number, end: number, spans: readonly ProtectedSpan[], counts: ReadonlyMap<string, number>): number[] {
  const preferred = new Set(preferredBoundaries(tokens, first, end, spans));
  const costs = new Map<number, number>([[first, 0]]);
  const previous = new Map<number, number>();
  for (let stop = first + 1; stop <= end; stop++) {
    if (!safeBoundary(tokens, stop, spans)) continue;
    for (let start = Math.max(first, stop - MAX_GROUP_WORDS); start < stop; start++) {
      const prefixCost = costs.get(start);
      if (prefixCost === undefined || !safeBoundary(tokens, start, spans)) continue;
      const group = tokens.slice(start, stop);
      const length = group.length;
      const width = group.reduce((sum, token) => sum + visualWidth(token), length - 1);
      const denseWords = group.filter(token => visualWidth(token) >= 7.5).length;
      const impactWords = group.filter(token => !stopWords.has(token.key) && ((counts.get(token.key) ?? 0) > 1 || contrastWords.has(token.key) || visualWidth(token) >= 9)).length;
      let cost = length === 1 ? 3.8 : length === 2 ? 1.1 : length === 3 ? 1.45 : 4.9;
      if (length === 1 && (width >= 9 || group[0]!.emoji || contrastWords.has(group[0]!.key))) cost = 1.8;
      cost += Math.pow(Math.max(0, width - 18), 1.4) * 0.13;
      if (length >= 3) cost += denseWords * 0.5 + impactWords * 0.25;
      if (length === 4 && width > 20) cost += 2;
      if (length === 1 && linkingWords.has(group[0]!.key)) cost += 10;
      if (stop < end && linkingWords.has(group.at(-1)!.key)) cost += 3.5;
      for (let position = start + 1; position < stop; position++) {
        if (/[,;:—]/u.test(text.slice(tokens[position - 1]!.end, tokens[position]!.start))) cost += 3.5;
        if (preferred.has(position)) cost += 0.65;
      }
      if (stop < end) {
        if (preferred.has(stop)) cost -= 0.45;
        if (/[,;:—]/u.test(text.slice(tokens[stop - 1]!.end, tokens[stop]!.start))) cost -= 0.4;
        if (contrastWords.has(tokens[stop]!.key)) cost -= 0.35;
      }
      const candidateCost = prefixCost + cost;
      if (candidateCost < (costs.get(stop) ?? Infinity) - 1e-9) { costs.set(stop, candidateCost); previous.set(stop, start); }
    }
  }
  const boundaries = [end];
  let cursor = end;
  while (cursor > first) {
    const preceding = previous.get(cursor);
    if (preceding === undefined) throw new RangeError('Unable to form compact reading groups.');
    cursor = preceding;
    boundaries.push(cursor);
  }
  return boundaries.reverse();
}

export const TextDirector = {
  analyze(text: string, inputLanguage: InputLanguage = 'auto'): TextAnalysis {
    if (!text.trim()) throw new RangeError('Enter a sentence before creating a film.');
    const tokens = scan(text);
    if (!tokens.length) throw new RangeError('Enter at least one word or supported emoji.');
    // Two or more consecutive spaces between tokens override automatic grouping.
    const forcedBreaks = new Set<number>();
    for (let index = 1; index < tokens.length; index++) {
      if (text.slice(tokens[index - 1]!.end, tokens[index]!.start).includes('  ')) forcedBreaks.add(index);
    }
    const detected = detectTextLanguage(text, inputLanguage);
    const negations = semanticNegations(tokens, text);
    const spans = protectedSpans(tokens, text, negations, forcedBreaks);
    const counts = new Map<string, number>();
    for (const token of tokens) if (!stopWords.has(token.key)) counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
    const boundaries: number[] = [0];
    let first = 0;
    while (first < tokens.length) {
      let end = first + 1;
      while (end < tokens.length && tokens[end]!.sentence === tokens[first]!.sentence && !forcedBreaks.has(end)) end++;
      const points = compactBoundaries(tokens, text, first, end, spans, counts);
      for (const point of points.slice(1)) if (!boundaries.includes(point)) boundaries.push(point);
      first = end;
    }
    const groups: TextGroup[] = [];
    let sourceStart = 0;
    for (let index = 0; index < boundaries.length - 1; index++) {
      const tokenStart = boundaries[index]!;
      const tokenEnd = boundaries[index + 1]!;
      const groupTokens = tokens.slice(tokenStart, tokenEnd);
      // Source ranges include whitespace and punctuation between reading groups.
      const sourceEnd = tokenEnd < tokens.length ? tokens[tokenEnd]!.start : text.length;
      const original = text.slice(sourceStart, sourceEnd);
      const negation = negations.some(scope => !scope.restriction && scope.first < tokenEnd && scope.end > tokenStart);
      const restriction = negations.some(scope => scope.restriction && scope.first < tokenEnd && scope.end > tokenStart);
      const repeated = groupTokens.some(token => (counts.get(token.key) ?? 0) > 1);
      const contrast = groupTokens.some(token => contrastWords.has(token.key));
      const conclusion = index === boundaries.length - 2;
      const content = groupTokens.filter(token => !stopWords.has(token.key)).length;
      const readingDuration = Math.max(0.9, groupTokens.length / 2.7) + (/[.!?…][\s”"')»]*$/u.test(original) ? 0.18 : /[,;:][\s”"')»]*$/u.test(original) ? 0.09 : 0);
      groups.push({
        id: `group-${index}`, text: original, start: sourceStart, end: sourceEnd,
        tokens: groupTokens, wordCount: groupTokens.length, sentence: groupTokens[0]!.sentence,
        negation, contrast, repeated, conclusion, readingDuration,
        scores: {
          linguistic: Math.min(1, content / Math.max(1, groupTokens.length) * 0.7 + (groupTokens.some(token => verbs.has(token.key)) ? 0.3 : 0)),
          narrative: Math.min(1, 0.15 + (negation ? 0.35 : restriction ? 0.2 : 0) + (contrast ? 0.25 : 0) + (repeated ? 0.15 : 0) + (conclusion ? 0.45 : 0) + (/\?/u.test(original) ? 0.2 : 0)),
          visual: 0.5,
          readability: Math.max(0.1, 1 - Math.max(0, groupTokens.length - 3) * 0.08),
          composition: Math.max(0.15, 1 - Math.abs(groupTokens.length - 3) * 0.12),
        },
      });
      sourceStart = sourceEnd;
    }
    return {
      version: 'fr-en-scanner-2', sourceText: text, requestedLanguage: inputLanguage,
      language: detected.language, languageConfidence: detected.confidence, uncertainLanguage: detected.uncertain,
      groups, tokens, protectedSpans: spans, wordCount: tokens.length,
      readingDuration: groups.reduce((sum, group) => sum + group.readingDuration, 0),
    };
  },
};
