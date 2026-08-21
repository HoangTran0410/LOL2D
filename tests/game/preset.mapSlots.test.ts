/**
 * `Game.spawnFountains`/`spawnTurrets` used to read two hard-coded tables —
 * `FountainPreset` (index 0/1 = blue/red) and `getTurretPositions()` (a
 * synchronous `AssetManager.get('json_summoner_map')` read keyed by the
 * literal `turret1`/`turret2`). Both are gone; a fountain or turret now comes
 * from whatever the active map's own `slots.spawn`/`slots.structure` say.
 *
 * This is the seam that actually exists to test that translation against: no
 * test in this codebase constructs a real `Game` (see `tests/game/fixtures.ts`'s
 * `createGame`, which returns a stub `GameObjectRuntimeContext`, never a real
 * `Game`), and `Game.spawnFountains`/`spawnTurrets` are otherwise thin loops
 * over `new Fountain(...)`/`new Turret(...)` that are already covered by
 * `Turret.test.ts`/`Fountain.test.ts`. `fountainsFromSlots`/`turretsFromSlots`
 * are the pure, Game-free translation those two loops are built on — read
 * `summonersRiftGeometry` (the geometry module directly, not the lazy
 * `summonersRift.geometry()` loader, since this test wants it synchronously)
 * and check the translation, not a live match.
 */
import { describe, expect, it } from 'vitest';
import TeamId from '../../src/game/enums/TeamId';
import {
  fountainsFromSlots,
  monsterFillingSlot,
  monsterPresetFromSlot,
  turretsFromSlots,
} from '../../src/game/preset';
import { summonersRiftGeometry } from '../../src/content/maps/summonersRiftGeometry';
import { BARON_ABILITIES } from '../../src/game/gameObject/monsters/Baron';

describe('fountains and turrets built from a map slot', () => {
  it('spawns one fountain preset per spawn slot, on the slot’s own faction', () => {
    const { spawn } = summonersRiftGeometry.slots;
    expect(spawn).toHaveLength(2);

    const fountains = fountainsFromSlots(spawn);
    expect(fountains).toHaveLength(spawn.length);

    for (const slot of spawn) {
      const match = fountains.find(f => f.x === slot.x && f.y === slot.y);
      expect(match, `no fountain preset at the ${slot.faction} spawn slot`).toBeDefined();
      expect(match?.r).toBe(slot.r);
      expect(match?.teamId).toBe(slot.faction === 'blue' ? TeamId.BLUE : TeamId.RED);
    }
  });

  it('does not care what order the spawn slots arrive in', () => {
    // `FountainPreset`'s index order used to be load-bearing — index 0 was
    // always blue. Reversing the slot list must not flip which team either
    // fountain ends up on, since the team now rides on the slot's own
    // `faction` field.
    const reversed = [...summonersRiftGeometry.slots.spawn].reverse();
    const fountains = fountainsFromSlots(reversed);
    for (const slot of reversed) {
      const match = fountains.find(f => f.x === slot.x && f.y === slot.y);
      expect(match?.teamId).toBe(slot.faction === 'blue' ? TeamId.BLUE : TeamId.RED);
    }
  });

  it('spawns one turret position per structure slot and keeps the rows equal', () => {
    const { structure } = summonersRiftGeometry.slots;
    const turrets = turretsFromSlots(structure);
    expect(turrets).toHaveLength(structure.length);

    const perTeam = new Map<string, number>();
    for (const turret of turrets) {
      perTeam.set(turret.teamId, (perTeam.get(turret.teamId) ?? 0) + 1);
    }
    expect([...perTeam.keys()].sort()).toEqual([TeamId.BLUE, TeamId.RED].sort());
    for (const count of perTeam.values()) expect(count).toBe(11);
  });

  it('keeps every point, unrounded, in the slot order it was given', () => {
    const { structure } = summonersRiftGeometry.slots;
    const turrets = turretsFromSlots(structure);
    structure.forEach((slot, i) => {
      expect(turrets[i]).toEqual({
        x: slot.x,
        y: slot.y,
        teamId: slot.faction === 'blue' ? TeamId.BLUE : TeamId.RED,
      });
    });
  });
});

/**
 * `Game.spawnJungle()` is the same shape as `spawnFountains`/`spawnTurrets`
 * above — a thin loop over `new Monster(...)` — so it is not tested directly
 * either (no test in this codebase constructs a real `Game`, see this file's
 * own header). `monsterFillingSlot`/`monsterPresetFromSlot` are the pure
 * translation the loop is built on: resolving a neutral slot's `role` to an
 * installed monster, and turning that monster plus that slot into a
 * spawn-ready `MonsterPresetData`. Checked against the real bundled data —
 * `summonersRiftGeometry.slots.neutral`, not a hand-rolled slot — so this
 * also carries the coverage that used to live in `CampAggro.test.ts`'s "the
 * map data" block, back when a pack's grouping was `campId` rather than
 * `role`.
 */
describe('jungle camps built from a map slot', () => {
  it('fills every neutral slot the real map declares', () => {
    const { neutral } = summonersRiftGeometry.slots;
    expect(neutral.length).toBeGreaterThan(0);
    for (const slot of neutral) {
      expect(monsterFillingSlot(slot), `nothing fills the ${slot.role} camp`).not.toBeNull();
    }
  });

  it('leaves a slot empty rather than throwing when no installed monster fills its role', () => {
    // Spec §6: a slot nobody fills is left empty and the map still plays.
    // `role` is a free string core never interprets, so a role no pack
    // supplies must resolve to "nothing here", not a crash.
    const stranger = { role: 'nobody-fills-this', x: 3000, y: 3000, r: 100 };
    expect(() => monsterFillingSlot(stranger)).not.toThrow();
    expect(monsterFillingSlot(stranger)).toBeNull();
  });

  it('hands every body of a multi-body camp the exact same camp object', () => {
    // `Monster.alertCamp` finds packmates by `camp` identity, not a shared
    // `campId` string — so this is load-bearing, not incidental: two calls
    // for the same slot must return presets whose `camp` is `===`, and a
    // camp that actually holds more than one body (wolves, raptors) is what
    // proves the resolution path a multi-body pack takes, not just a solo one.
    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    expect(wolfSlot).toBeDefined();
    const monster = monsterFillingSlot(wolfSlot)!;
    expect(monster.count ?? 1).toBeGreaterThan(1);

    const first = monsterPresetFromSlot(monster, wolfSlot);
    const second = monsterPresetFromSlot(monster, wolfSlot);
    expect(first.camp).toBe(wolfSlot);
    expect(second.camp).toBe(wolfSlot);
  });

  it("merges Baron's engine abilities onto the qualified baron monster, and nothing else", () => {
    const baronSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'baron')!;
    const baronMonster = monsterFillingSlot(baronSlot)!;
    expect(monsterPresetFromSlot(baronMonster, baronSlot).abilities).toBe(BARON_ABILITIES);

    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    const wolfMonster = monsterFillingSlot(wolfSlot)!;
    expect(monsterPresetFromSlot(wolfMonster, wolfSlot).abilities).toBeUndefined();
  });

  it("carries the resolved monster's own tuning through untouched", () => {
    const baronSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'baron')!;
    const baronMonster = monsterFillingSlot(baronSlot)!;
    const preset = monsterPresetFromSlot(baronMonster, baronSlot);
    expect(preset.name).toBe(baronMonster.name);
    expect(preset.avatar).toBe(baronMonster.avatar);
    expect(preset.speed).toBe(baronMonster.speed);
    expect(preset.size).toBe(baronMonster.size);
    expect(preset.attackRange).toBe(baronMonster.attackRange);
    expect(preset.reviveTime).toBe(baronMonster.reviveTime);
    expect(preset.health).toBe(baronMonster.health);
    expect(preset.damage).toBe(baronMonster.damage);
    expect(preset.attackInterval).toBe(baronMonster.attackInterval);
    expect(preset.aggroRange).toBe(baronMonster.aggroRange);
  });
});
