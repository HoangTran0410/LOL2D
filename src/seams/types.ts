/**
 * The shared shape every seam in this directory returns.
 *
 * A seam is a static source scan for a mistake `tsc` cannot see — a shape,
 * not a type error. `file` is relative to the `root` the seam was called
 * with, so a violation reads the same however deep the caller's tree is
 * mounted.
 */
export interface SeamViolation {
  /** Path to the offending file, relative to the `root` argument. */
  file: string;
  /** What is wrong, and (for a line-level scan) which line said so. */
  message: string;
  /**
   * `'violation'` (the default, and every pre-round-3 caller's only case) is
   * a real rule break — the file did something the seam bans. `'stale-
   * exemption'` is the opposite problem wearing the same shape: a debt entry
   * (`grandfathered`, `noPressOverride`, `pinned`, `skip`) that matched
   * nothing this run — the file it names no longer offends, was renamed, or
   * never existed. Content-pack-extraction batch 5 task 6 fix round 3: a
   * licence nobody ever revokes is how a seam quietly stops meaning
   * anything, and a `pinned` entry outliving the line it names is the
   * sharpest case — the line number drifts, the exemption keeps matching
   * nothing, and the file is silently exempt at a line that no longer
   * exists. Both kinds fail the run; they are kept distinguishable in the
   * report because "you broke a rule" and "you are exempting something that
   * no longer offends" are opposite problems with opposite fixes.
   */
  kind?: 'violation' | 'stale-exemption';
}

/** Options every seam accepts, beyond the tree it is pointed at. */
export interface SeamCheckOptions {
  /**
   * Basenames to leave out of the walk entirely — barrels (`index.ts`) and
   * scaffolding templates (`_EmptyExample.ts`) are never a real spell.
   */
  skip?: Set<string>;
}

export type SeamCheck = (root: string, options?: SeamCheckOptions) => SeamViolation[];

/**
 * A seam that reads a *narrower* options type than the shared one — the eight
 * with a debt field of their own (`grandfathered`, `pinned`, `maxMs`, ...).
 *
 * They were all annotated `SeamCheck`, which erased that: `checkCooldowns(dir,
 * { maxMs: 20_000 })` is the documented way to call one and it does not
 * compile against the base type. Nothing noticed for a batch, because the
 * only caller passing those fields is `tests/seams/`, and the whole-branch
 * review of batch 5 measured that **no tsconfig included that directory** —
 * 20 real `TS2353`s appeared the moment one did.
 *
 * Still assignable to `SeamCheck`, so `seams[]` and `checkSeams` are
 * unchanged: every extra field is optional, so a caller holding only a
 * `SeamCheckOptions` can still call it.
 */
export type SeamCheckOf<O extends SeamCheckOptions> = (
  root: string,
  options?: O
) => SeamViolation[];

/** One rule, named and described well enough to report on its own. */
export interface Seam {
  id: string;
  /** One sentence: what the seam exists to catch. */
  summary: string;
  check: SeamCheck;
}
