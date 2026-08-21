/**
 * Current health and current mana are **resources, not stats**.
 *
 * `Stats` exposes them as `Stat` objects so the health bar can read one number,
 * but everything that legitimately moves them — `takeDamage`, `takeHeal`,
 * `spendMana`, `restoreMana`, fountain regeneration — writes `baseValue`
 * directly. Nothing moves them through the modifier pipeline, and a modifier on
 * one is not the offset it looks like: it changes the number the bar reads
 * while leaving the pool the game actually spends untouched.
 *
 * It was worse than meaningless until recently. `Stats.update()` wrote the
 * regenerated value back from `health.value` — the *modified* read — so a
 * modifier was folded into the base once per frame and then re-applied on the
 * next read. `health: { baseBonus: 50 }` therefore granted 50 health *per
 * frame*, 3000 a second at 60fps, which re-pinned its owner to full health
 * regardless of incoming damage. Singed R, Nasus R and Renekton R all shipped
 * that line, and all three were unkillable for the nine seconds it lasted; it
 * was reported as "Singed feels immortal". `Stats.update()` now reads
 * `baseValue`, so the compounding is gone — but the modifier is still the
 * wrong tool, and nothing in `tsc` objects to it: `StatName` is derived from
 * `StatsModifier`, and `health` really is a member of it.
 *
 * Hence a source scan, in the shape of `mana-spend-seam.test.ts`. What a
 * bonus-max-health ultimate wants is `maxHealth: { baseBonus: N }` for the
 * ceiling plus one `takeHeal(N, owner)` after `addBuff` for the fill.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCANNED_DIRECTORIES = ['spells', 'spellObjects', 'buffs'];

/**
 * A `health:` / `mana:` key inside a bonuses object literal. Deliberately
 * anchored on the key form rather than on `bonuses = {`, because the block
 * spans lines and the offending key is what identifies it; `maxHealth:` and
 * `maxMana:` do not match, and neither does `healthRegen:`/`manaRegen:`, which
 * are ordinary stats a buff may modify freely.
 */
const RESOURCE_AS_STAT = /(?<![A-Za-z])(?:health|mana)\s*:\s*\{/;

const gameObjectRoot = fileURLToPath(new URL('../../../src/game/gameObject/', import.meta.url));
// `spells/` moved into `packs/riot/spells/` (batch 4 task 3); the other
// scanned directories stayed under `src/game/gameObject/`.
const packsRoot = fileURLToPath(new URL('../../../packs/riot/', import.meta.url));
const rootFor = (directory: string): string => (directory === 'spells' ? packsRoot : gameObjectRoot);

const sourceFiles = (directory: string): string[] => {
  const absolute = join(rootFor(directory), directory);
  return readdirSync(absolute, { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => join(directory, entry));
};

/** The scan reads code, not prose — the three fixed files explain themselves. */
const codeOnly = (line: string): string => {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
};

const offendingLines = (relativePath: string): string[] =>
  readFileSync(join(rootFor(relativePath.split('/')[0]), relativePath), 'utf8')
    .split('\n')
    .map((line, index) => ({ code: codeOnly(line), line, number: index + 1 }))
    .filter(({ code }) => RESOURCE_AS_STAT.test(code))
    .map(({ line, number }) => `${relativePath}:${number}: ${line.trim()}`);

describe('current health and mana are never modified as stats', () => {
  it.each(SCANNED_DIRECTORIES)(
    'no file under %s/ puts a bonus on the health or mana pool',
    directory => {
      const offenders = sourceFiles(directory).flatMap(offendingLines);
      expect(offenders).toEqual([]);
    }
  );
});
