import type { NeutralSlot } from '@/content/ContentPack';

/**
 * Summoner's Rift's jungle camp *positions* — where a camp sits, split from
 * what stands in it (Task 7: a camp is a place, a monster is a thing that
 * fills it).
 *
 * `src/content/maps/summonersRiftGeometry.ts` (batch 3's content-pack
 * assembly) only wants placement — but it sits in `src/content/`, which
 * `tests/content/contentApiChunk.test.ts` and `vite.config.ts`'s `pregame`
 * chunk both require to never reach `src/game/gameObject/`. This module has
 * no such import, on purpose.
 *
 * Every camp's tuning (avatar, speed, size, attack range, health and the
 * rest) now lives in `src/content/bundledPack.ts`'s own `monsters` data —
 * real pack content, matched to a slot here by `role` alone. `role` is a
 * free string core never interprets (`NeutralSlot.role`'s own doc comment);
 * `Game.spawnJungle()` resolves it through `PackRegistry.monstersFilling`.
 *
 * `campId` is gone. It used to tie a pack's bodies together — three entries
 * repeating one position — purely because position and identity were stored
 * in the same table. Splitting them removes the need: a pack of wolves is
 * one neutral slot (`role: 'wolves'`) and one `MonsterDef` with `count: 3`;
 * `Monster.alertCamp` finds packmates by the `camp` object every body spawned
 * into that slot shares, not by a shared id string.
 *
 * These eleven positions and radii are unchanged from the pre-Task-7 table —
 * nothing here moves a camp, only what it means to name one.
 */
export const NEUTRAL_SLOTS: NeutralSlot[] = [
  { role: 'baron', x: 2147, y: 1876, r: 100 },
  { role: 'blue', x: 1631, y: 2958, r: 300 },
  { role: 'blue', x: 4794, y: 3419, r: 300 },
  { role: 'red', x: 3368, y: 4698, r: 300 },
  { role: 'red', x: 3085, y: 1672, r: 300 },
  { role: 'wolves', x: 1685, y: 3562, r: 300 },
  { role: 'wolves', x: 4728, y: 2835, r: 300 },
  { role: 'gromp', x: 914, y: 2784, r: 300 },
  { role: 'gromp', x: 5540, y: 3599, r: 300 },
  { role: 'raptors', x: 2954, y: 4110, r: 300 },
  { role: 'raptors', x: 3498, y: 2258, r: 300 },
];
