import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeamCheckOptions } from './types';

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
