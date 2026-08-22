import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeamCheckOptions, SeamViolation } from './types';

/** The last segment of a scanned path, whichever separator the platform used. */
function baseNameOf(relativePath: string): string {
  return relativePath.split(/[\\/]/).pop()!;
}

/**
 * One matching rule for **every** exemption set in this module, and the
 * answer to a real false positive (content-pack-extraction batch 5 task 6
 * fix round 4).
 *
 * Before this existed the module had two keying conventions living in one
 * `seamDebt` object: `skip` matched a **basename at any depth**, while
 * `grandfathered`, `grandfatheredClasses`, `noPressOverride` and `pinned`
 * matched a **path relative to the scanned root**. Nothing said so, and a
 * pack whose spells sit in subdirectories — `walkTsFiles` has always been
 * recursive — got the worst possible result once staleness checking
 * existed: a basename entry failed to suppress the real violation in
 * `nested/<that file>` *and* was reported stale, i.e. the
 * author's still-load-bearing exemption was reported as dead debt while the
 * thing it exempted went red. Reproduced on a two-file tree; `packs/riot/
 * spells` is flat today, which is the only reason it had not happened yet.
 *
 * The rule now, for all five sets: **an entry names either the path
 * relative to the scanned root (`nested/Foo.ts`) or a bare basename
 * (`Foo.ts`), which matches that basename at any depth.** Basenames are
 * what a debt file actually wants to write in a flat tree, and the full
 * relative path is what disambiguates two same-named files in a nested one.
 * Returns the *entry* that matched, not a boolean, because staleness is
 * per declared entry: the caller records what it consumed.
 */
export function exemptionFor(entries: Set<string>, relativePath: string): string | undefined {
  if (entries.has(relativePath)) return relativePath;
  const base = baseNameOf(relativePath);
  return entries.has(base) ? base : undefined;
}

/** The same rule for a single entry: full relative path, or bare basename. */
export function pathMatches(entry: string, relativePath: string): boolean {
  return entry === relativePath || entry === baseNameOf(relativePath);
}

/**
 * A line-level exemption entry, `"<file>:<1-indexed line>:<the line's own
 * code, trimmed>"` — the shape `pinned` (`worldMouseInSpellCode.ts`) and
 * `pinnedManaLines` (`manaSpend.ts`) both use.
 *
 * The trailing code is what makes it an exemption for a *line* rather than
 * for a line *number* (fix round 4). Keyed on the number alone, a licence
 * issued for one line was inherited by whatever different code was later
 * written at that same number — proven on the real tree: replacing
 * the pack's one pinned line with an entirely new `this.game.worldMouse` read left
 * `check-seams` reporting `scanned 237 file(s), clean`. Both halves are
 * checked now, so the entry reads as the violation the CLI would have
 * printed, with the file in front: an author copies the reported line into
 * the debt file rather than counting lines.
 *
 * A malformed entry (no `:<digits>:` at all) matches nothing and is
 * therefore reported stale by its seam, which is the right outcome for a
 * licence nobody can act on.
 */
export interface PinnedLine {
  file: string;
  line: number;
  code: string;
}

const PINNED_LINE = /^([^:]*):(\d+):([\s\S]*)$/;

export function parsePinnedLine(entry: string): PinnedLine | null {
  const match = PINNED_LINE.exec(entry);
  if (!match) return null;
  return { file: match[1], line: Number(match[2]), code: match[3] };
}

/**
 * The `pinned`-shaped entry that exempts this exact line, or `undefined`.
 * All three of file, line number and code text have to agree; see
 * `PinnedLine` for why the third one is not optional.
 */
export function pinnedLineFor(
  entries: Set<string>,
  relativePath: string,
  lineNumber: number,
  line: string
): string | undefined {
  const code = line.trim();
  for (const entry of entries) {
    const parsed = parsePinnedLine(entry);
    if (!parsed) continue;
    if (parsed.line !== lineNumber || parsed.code !== code) continue;
    if (!pathMatches(parsed.file, relativePath)) continue;
    return entry;
  }
  return undefined;
}

/**
 * Every `.ts` file under `root`, recursive, relative to `root`.
 *
 * `node_modules` is never walked: a seam checks the code a tree *authors*,
 * and a pack installed as its own repository has core (and every other
 * dependency) sitting under it — thousands of files nobody in this
 * repository wrote, all of them free to break rules that are none of the
 * pack author's business.
 */
export function walkTsFiles(root: string, options: SeamCheckOptions = {}): string[] {
  const skip = options.skip ?? new Set<string>();
  return allTsFiles(root).filter(entry => exemptionFor(skip, entry) === undefined);
}

/** The unfiltered listing — `skip` not yet applied, dependencies still out. */
function allTsFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .filter(entry => !entry.split(/[\\/]/).includes('node_modules'));
}

export function readSource(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

/** Block comments and `//` comments removed, so a rule reads code, not prose. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The code half of one line — used by scans that report `file:line`. */
export function codeOnly(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
}

/**
 * `options.skip` entries that named no file at all this run — the shared
 * half of stale-exemption checking (content-pack-extraction batch 5 task 6
 * fix round 3). `skip` is honoured identically by every seam via
 * `walkTsFiles`, so it is checked once here rather than once per seam,
 * which would report the same dead entry thirteen times. Deliberately
 * checked against the **unfiltered** listing (every `.ts` file under
 * `root`, skip not yet applied) — the question is "does this entry name a
 * file that exists," not "does it exist after removing the files that
 * match it."
 *
 * **Existence, not consumption, and deliberately so** (fix round 4, which
 * corrected the two headers that claimed otherwise — `src/seams/index.ts`
 * and `packs/riot/spells/seam-debt.mjs` both said every licence is
 * consumption-checked, and this one never was). The other four sets name a
 * file, class or line *known to offend*, so "did this entry actually
 * suppress a would-be violation" is exactly what they mean and staleness is
 * answerable. `skip` means something else: it names a file that is **not
 * spell-shaped code at all** — a barrel, a scaffolding template — so the
 * seams should never have looked at it in the first place. A consumption
 * check would demand that `index.ts` violate something to keep earning its
 * place, and report the correct, quiet answer as stale. What can genuinely
 * go stale about a `skip` entry is the file being renamed or deleted, and
 * that is what this reports.
 */
export function staleSkipEntries(root: string, options: SeamCheckOptions = {}): SeamViolation[] {
  const skip = options.skip ?? new Set<string>();
  if (skip.size === 0) return [];

  const present = allTsFiles(root);
  const matched = new Set<string>();
  for (const file of present) {
    const entry = exemptionFor(skip, file);
    if (entry !== undefined) matched.add(entry);
  }

  const stale: SeamViolation[] = [];
  for (const entry of skip) {
    if (!matched.has(entry)) {
      stale.push({
        file: entry,
        message: 'skip exemption matched no file under this root, by path or by basename',
        kind: 'stale-exemption',
      });
    }
  }
  return stale;
}
