/** Session-only creative memory. Saved films remain entirely seed driven. */
export class GenerationHistory {
  private readonly films = new Map<string, { seed: number; signature: string }[]>();

  constructor(private readonly randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!) {}

  nextSeed(text: string, currentSeed?: number): number {
    const recent = this.films.get(text) ?? [];
    const excluded = new Set(recent.map(film => film.seed));
    if (currentSeed !== undefined) excluded.add(currentSeed >>> 0);
    let seed = this.randomSeed() >>> 0;
    // Even a repeated entropy value cannot replay a recent film accidentally.
    while (excluded.has(seed)) seed = (seed + 0x9E3779B9) >>> 0;
    return seed;
  }

  signatures(text: string): readonly string[] {
    return this.films.get(text)?.map(film => film.signature) ?? [];
  }

  remember(text: string, seed: number, signature: string): void {
    const recent = this.films.get(text) ?? [];
    this.films.delete(text);
    this.films.set(text, [...recent, { seed: seed >>> 0, signature }].slice(-5));
    if (this.films.size > 8) this.films.delete(this.films.keys().next().value!);
  }
}
