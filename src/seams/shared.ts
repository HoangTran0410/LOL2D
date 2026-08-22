import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeamCheckOptions, SeamViolation } from './types';

/** Every `.ts` file under `root`, recursive, relative to `root`. */
export function walkTsFiles(root: string, options: SeamCheckOptions = {}): string[] {
  const skip = options.skip ?? new Set<string>();
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .filter(entry => !skip.has(entry.split('/').pop()!));
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
 * `root`, skip not yet applied) — the question is "does this basename
 * exist at all," not "does it exist after removing basenames that match
 * themselves."
 */
export function staleSkipEntries(root: string, options: SeamCheckOptions = {}): SeamViolation[] {
  const skip = options.skip ?? new Set<string>();
  if (skip.size === 0) return [];

  const present = new Set(
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter(entry => entry.endsWith('.ts'))
      .map(entry => entry.split('/').pop()!)
  );

  const stale: SeamViolation[] = [];
  for (const basename of skip) {
    if (!present.has(basename)) {
      stale.push({
        file: basename,
        message: 'skip exemption matches no file in this tree',
        kind: 'stale-exemption',
      });
    }
  }
  return stale;
}
