import { describe, expect, it } from 'vitest';
import { GenerationHistory } from '../src/app/generation-history';

describe('creative session memory', () => {
  it('gives CREATE a fresh seed even when entropy repeats the current or a recent seed', () => {
    const history = new GenerationHistory(() => 42);
    history.remember('Bonjour.', 42, 'first');
    const seed = history.nextSeed('Bonjour.', 43);
    expect(seed).not.toBe(42);
    expect(seed).not.toBe(43);
    history.remember('Bonjour.', seed, 'second');
    expect(history.nextSeed('Bonjour.', seed)).not.toBe(seed);
    expect(history.nextSeed('Bonjour.', seed)).not.toBe(42);
  });

  it('remembers the last five directions per unchanged quotation without mixing quotations', () => {
    const history = new GenerationHistory(() => 1);
    for (let seed = 0; seed < 7; seed++) history.remember('Le futur.', seed, String(seed));
    history.remember('The future.', 9, 'english');
    expect(history.signatures('Le futur.')).toEqual(['2', '3', '4', '5', '6']);
    expect(history.signatures('The future.')).toEqual(['english']);
    expect(history.signatures('Le futur. ')).toEqual([]);
  });

  it('bounds session memory and retains a revisited quotation', () => {
    const history = new GenerationHistory(() => 1);
    for (let seed = 0; seed < 8; seed++) history.remember(String(seed), seed, String(seed));
    history.remember('0', 10, 'latest');
    history.remember('8', 8, '8');
    expect(history.signatures('1')).toEqual([]);
    expect(history.signatures('0')).toEqual(['0', 'latest']);
    expect(history.signatures('8')).toEqual(['8']);
  });
});
