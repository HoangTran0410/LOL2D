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
  monsterBodyPreset,
  monsterFillingSlot,
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
 * own header). `monsterFillingSlot`/`monsterBodyPreset` are the pure
 * translation the loop is built on: resolving a neutral slot's `role` to an
 * installed monster, and turning one of that monster's `members` plus that
 * slot into a spawn-ready `MonsterPresetData`. Checked against the real
 * bundled data — `summonersRiftGeometry.slots.neutral`, not a hand-rolled
 * slot — so this also carries the coverage that used to live in
 * `CampAggro.test.ts`'s "the map data" block, back when a pack's grouping
 * was `campId` rather than `role`.
 *
 * The historical per-body data below (`ORIGINAL_WOLF1` etc.) is transcribed
 * from `git show f2092e4:src/game/mapPresets.ts` — the commit immediately
 * before Task 7, the last revision where a camp's position and its body's
 * own tuning still lived in one `MonsterPreset` entry. Every recovery
 * assertion below is checked against that fixed source, never against a
 * number typed fresh into this file.
 */
const ORIGINAL_WOLF1 = {
  greater: {
    x: 1685,
    y: 3562,
    health: 300,
    size: 70,
    speed: 2,
    avatar: 'monster_Greater_Murk_Wolf',
  },
  a: { x: 1602, y: 3511, health: 100, size: 40, speed: 2.5, avatar: 'monster_Murk_Wolf' },
  b: { x: 1725, y: 3659, health: 100, size: 40, speed: 2.5, avatar: 'monster_Murk_Wolf' },
};
const ORIGINAL_WOLF2 = {
  greater: {
    x: 4728,
    y: 2835,
    health: 300,
    size: 70,
    speed: 2,
    avatar: 'monster_Greater_Murk_Wolf',
  },
  a: { x: 4709, y: 2743, health: 100, size: 40, speed: 2.5, avatar: 'monster_Murk_Wolf' },
  b: { x: 4816, y: 2888, health: 100, size: 40, speed: 2.5, avatar: 'monster_Murk_Wolf' },
};
const ORIGINAL_RAPTOR1 = {
  crimson: { x: 2954, y: 4110, health: 300, size: 70, speed: 2, avatar: 'monster_Crimson_Raptor' },
  a: { x: 3045, y: 4026, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  b: { x: 3149, y: 4095, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  c: { x: 3060, y: 4169, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
};
const ORIGINAL_RAPTOR2 = {
  crimson: { x: 3498, y: 2258, health: 300, size: 70, speed: 2, avatar: 'monster_Crimson_Raptor' },
  a: { x: 3432, y: 2356, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  b: { x: 3307, y: 2295, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  c: { x: 3378, y: 2183, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
};

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

  it('hands every member of a multi-body camp the exact same camp object', () => {
    // `Monster.alertCamp` finds packmates by `camp` identity, not a shared
    // `campId` string — so this is load-bearing, not incidental: every
    // member of the same slot must resolve to a preset whose `camp` is
    // `===` the slot itself, and a camp that actually holds more than one
    // body (wolves, raptors) is what proves the resolution path a
    // multi-body pack takes, not just a solo one.
    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    const monster = monsterFillingSlot(wolfSlot)!;
    expect(monster.members.length).toBeGreaterThan(1);

    for (const member of monster.members) {
      expect(monsterBodyPreset(monster, member, wolfSlot).camp).toBe(wolfSlot);
    }
  });

  it("merges Baron's engine abilities onto the qualified baron monster, and nothing else", () => {
    const baronSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'baron')!;
    const baronMonster = monsterFillingSlot(baronSlot)!;
    expect(monsterBodyPreset(baronMonster, baronMonster.members[0], baronSlot).abilities).toBe(
      BARON_ABILITIES
    );

    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    const wolfMonster = monsterFillingSlot(wolfSlot)!;
    for (const member of wolfMonster.members) {
      expect(monsterBodyPreset(wolfMonster, member, wolfSlot).abilities).toBeUndefined();
    }
  });

  it("carries each resolved member's own tuning through untouched", () => {
    const baronSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'baron')!;
    const baronMonster = monsterFillingSlot(baronSlot)!;
    const member = baronMonster.members[0];
    const preset = monsterBodyPreset(baronMonster, member, baronSlot);
    expect(preset.name).toBe(member.name);
    expect(preset.avatar).toBe(member.avatar);
    expect(preset.speed).toBe(member.speed);
    expect(preset.size).toBe(member.size);
    expect(preset.attackRange).toBe(member.attackRange);
    expect(preset.reviveTime).toBe(member.reviveTime);
    expect(preset.health).toBe(member.health);
    expect(preset.damage).toBe(member.damage);
    expect(preset.attackInterval).toBe(member.attackInterval);
    expect(preset.aggroRange).toBe(member.aggroRange);
  });

  it("recovers wolf1's own original per-body positions from the slot plus each member's offset", () => {
    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    // Task 3 anchored a multi-body camp's slot on the group's own "big"
    // member — confirm that before trusting it as the base the recovery
    // below adds offsets to.
    expect([wolfSlot.x, wolfSlot.y]).toEqual([ORIGINAL_WOLF1.greater.x, ORIGINAL_WOLF1.greater.y]);

    const monster = monsterFillingSlot(wolfSlot)!;
    const recovered = monster.members.map(m => ({
      x: wolfSlot.x + m.offset.x,
      y: wolfSlot.y + m.offset.y,
    }));
    for (const original of [ORIGINAL_WOLF1.greater, ORIGINAL_WOLF1.a, ORIGINAL_WOLF1.b]) {
      expect(recovered).toContainEqual({ x: original.x, y: original.y });
    }
  });

  it("recovers raptor1's own original per-body positions from the slot plus each member's offset", () => {
    const raptorSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'raptors')!;
    expect([raptorSlot.x, raptorSlot.y]).toEqual([
      ORIGINAL_RAPTOR1.crimson.x,
      ORIGINAL_RAPTOR1.crimson.y,
    ]);

    const monster = monsterFillingSlot(raptorSlot)!;
    const recovered = monster.members.map(m => ({
      x: raptorSlot.x + m.offset.x,
      y: raptorSlot.y + m.offset.y,
    }));
    for (const original of [
      ORIGINAL_RAPTOR1.crimson,
      ORIGINAL_RAPTOR1.a,
      ORIGINAL_RAPTOR1.b,
      ORIGINAL_RAPTOR1.c,
    ]) {
      expect(recovered).toContainEqual({ x: original.x, y: original.y });
    }
  });

  it("sums a wolves camp's total health to the original 500", () => {
    const wolfSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'wolves')!;
    const monster = monsterFillingSlot(wolfSlot)!;
    const total = monster.members.reduce((sum, m) => sum + m.health, 0);
    const originalTotal =
      ORIGINAL_WOLF1.greater.health + ORIGINAL_WOLF1.a.health + ORIGINAL_WOLF1.b.health;
    expect(originalTotal).toBe(500);
    expect(total).toBe(originalTotal);
  });

  it("sums a raptors camp's total health to the original 450", () => {
    const raptorSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'raptors')!;
    const monster = monsterFillingSlot(raptorSlot)!;
    const total = monster.members.reduce((sum, m) => sum + m.health, 0);
    const originalTotal =
      ORIGINAL_RAPTOR1.crimson.health +
      ORIGINAL_RAPTOR1.a.health +
      ORIGINAL_RAPTOR1.b.health +
      ORIGINAL_RAPTOR1.c.health;
    expect(originalTotal).toBe(450);
    expect(total).toBe(originalTotal);
  });

  it('confirms wolf2/raptor2 had the same body tuning as wolf1/raptor1 in the original data — the fact that justifies one shared shape at both slots', () => {
    // The shared `wolves`/`raptors` MonsterDef reuses one member layout
    // (derived from wolf1/raptor1's own original offsets) at *both* neutral
    // slots that role fills. That is only a position simplification, not a
    // tuning one, because the second instance's bodies were already
    // byte-identical to the first's on every field but position — checked
    // here against the historical table, not assumed.
    for (const key of ['greater', 'a', 'b'] as const) {
      expect(ORIGINAL_WOLF2[key].health).toBe(ORIGINAL_WOLF1[key].health);
      expect(ORIGINAL_WOLF2[key].size).toBe(ORIGINAL_WOLF1[key].size);
      expect(ORIGINAL_WOLF2[key].speed).toBe(ORIGINAL_WOLF1[key].speed);
      expect(ORIGINAL_WOLF2[key].avatar).toBe(ORIGINAL_WOLF1[key].avatar);
    }
    for (const key of ['crimson', 'a', 'b', 'c'] as const) {
      expect(ORIGINAL_RAPTOR2[key].health).toBe(ORIGINAL_RAPTOR1[key].health);
      expect(ORIGINAL_RAPTOR2[key].size).toBe(ORIGINAL_RAPTOR1[key].size);
      expect(ORIGINAL_RAPTOR2[key].speed).toBe(ORIGINAL_RAPTOR1[key].speed);
      expect(ORIGINAL_RAPTOR2[key].avatar).toBe(ORIGINAL_RAPTOR1[key].avatar);
    }
  });
});
