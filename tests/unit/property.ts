/**
 * Seeded property runs ([property tests](../../docs/arc42/adr/ADR-20261127-property-tests.md)).
 * Fixed seed by default, so `make check` is deterministic. `HAKEN_SEED` and
 * `HAKEN_RUNS` override it; a failure names the seed that reproduces it
 * with `HAKEN_RUNS=1`.
 */

const BASE_SEED = Number(process.env["HAKEN_SEED"] ?? "20261127");
const RUNS = process.env["HAKEN_RUNS"];

/** mulberry32: small, fast, good enough for test inputs. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(): boolean {
    return this.next() < 0.5;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }

  /** Random subset, in the original order. */
  subset<T>(items: readonly T[]): T[] {
    return items.filter(() => this.bool());
  }

  string(alphabet: string, maxLength: number): string {
    let out = "";
    for (let n = this.int(0, maxLength); n > 0; n--) out += this.pick([...alphabet]);
    return out;
  }
}

/** Runs `property` on `runs` generated inputs; rethrows with seed and input on the first failure. */
export function forAll<T>(
  generate: (rng: Rng) => T,
  property: (input: T) => void,
  runs = 200,
): void {
  const count = RUNS === undefined ? runs : Number(RUNS);
  for (let i = 0; i < count; i++) {
    const seed = BASE_SEED + i;
    const input = generate(new Rng(seed));
    try {
      property(input);
    } catch (cause) {
      const shown = JSON.stringify(input)?.slice(0, 2000);
      const reason = cause instanceof Error ? (cause.stack ?? String(cause)) : String(cause);
      throw new Error(
        `Property failed; reproduce with HAKEN_SEED=${seed} HAKEN_RUNS=1\n${reason}\n${shown}`,
        { cause },
      );
    }
  }
}
