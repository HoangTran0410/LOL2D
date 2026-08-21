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

/** One rule, named and described well enough to report on its own. */
export interface Seam {
  id: string;
  /** One sentence: what the seam exists to catch. */
  summary: string;
  check: SeamCheck;
}
