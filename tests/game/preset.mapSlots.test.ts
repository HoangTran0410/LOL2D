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
import { afterEach, describe, expect, it, vi } from 'vitest';
import TeamId from '../../src/game/enums/TeamId';
import {
  fountainsFromSlots,
  minionMusterSlotsFrom,
  monsterBodyPreset,
  monsterFillingSlot,
  turretsFromSlots,
} from '../../src/game/preset';
// Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/` and
// into the pack.
import { summonersRift } from '../../packs/riot/maps/summonersRift';
import { summonersRiftGeometry } from '../../packs/riot/maps/summonersRiftGeometry';
import { contentRegistry } from '../../src/content/registry';
import Champion from '../../src/game/gameObject/attackableUnits/Champion';
import Fountain from '../../src/game/gameObject/structures/Fountain';
import MinionSpawner from '../../src/game/managers/MinionSpawner';
import { resetLanesForTests, setActiveLanes } from '../../src/game/lanes';
import { createGame, stubGameGlobals, type TestGame } from './fixtures';
import type { MinionSpawnerContext } from '../../src/game/managers/MinionSpawner';

const { factions } = summonersRift;

describe('fountains and turrets built from a map slot', () => {
  it('spawns one fountain preset per spawn slot, on the slot’s own faction', () => {
    const { spawn } = summonersRiftGeometry.slots;
    expect(spawn).toHaveLength(2);

    const fountains = fountainsFromSlots(spawn, factions);
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
    // always blue. Reversing the *slot* list must not flip which team either
    // fountain ends up on: the team rides on `factions[]`'s own declared
    // order, a separate list this reversal never touches.
    const reversed = [...summonersRiftGeometry.slots.spawn].reverse();
    const fountains = fountainsFromSlots(reversed, factions);
    for (const slot of reversed) {
      const match = fountains.find(f => f.x === slot.x && f.y === slot.y);
      expect(match?.teamId).toBe(slot.faction === 'blue' ? TeamId.BLUE : TeamId.RED);
    }
  });

  it('spawns one turret position per structure slot and keeps the rows equal', () => {
    const { structure } = summonersRiftGeometry.slots;
    const turrets = turretsFromSlots(structure, factions);
    expect(turrets).toHaveLength(structure.length);

    const perTeam = new Map<string, number>();
    for (const turret of turrets) {
      perTeam.set(turret.teamId!, (perTeam.get(turret.teamId!) ?? 0) + 1);
    }
    expect([...perTeam.keys()].sort()).toEqual([TeamId.BLUE, TeamId.RED].sort());
    for (const count of perTeam.values()) expect(count).toBe(11);
  });

  it('keeps every point, unrounded, in the slot order it was given', () => {
    const { structure } = summonersRiftGeometry.slots;
    const turrets = turretsFromSlots(structure, factions);
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
 * The bridge is positional (`factions[0]` -> BLUE, `factions[1]` -> RED),
 * not a `'blue'`/`'red'` allowlist — every test above only ever exercises it
 * with `summonersRiftGeometry`, whose own faction ids happen to *be*
 * `'blue'`/`'red'`, so none of them can tell the real positional bridge
 * apart from the old hard-coded `{blue: BLUE, red: RED}` table it replaced.
 * `packs/reference/map.ts`'s Proving Grounds names its sides `'amber'`/
 * `'jade'` for exactly this reason (see that file's own header) — reused
 * here rather than invented fresh, so this test is checking the bridge
 * against the same faction ids the shipped second map actually declares.
 */
describe('the faction -> team bridge is positional, not a blue/red allowlist', () => {
  const factions = [{ id: 'amber' }, { id: 'jade' }];
  const spawnSlots = [
    { faction: 'amber', x: 300, y: 2100, r: 150 },
    { faction: 'jade', x: 2100, y: 300, r: 150 },
  ];
  const structureSlots = [
    { faction: 'amber', kind: 'turret' as const, x: 700, y: 1700 },
    { faction: 'jade', kind: 'turret' as const, x: 1700, y: 700 },
  ];
  const minionSlots = [
    { faction: 'amber', lane: 'mid', x: 650, y: 1750 },
    { faction: 'jade', lane: 'mid', x: 1800, y: 600 },
  ];

  it('gives an amber fountain a real team (BLUE), not the undefined an unrecognised faction used to fall to', () => {
    const fountains = fountainsFromSlots(spawnSlots, factions);
    for (const fountain of fountains) expect(fountain.teamId).toBeDefined();
    expect(fountains.find(f => f.x === 300)?.teamId).toBe(TeamId.BLUE);
    expect(fountains.find(f => f.x === 2100)?.teamId).toBe(TeamId.RED);
  });

  it('gives amber/jade turrets a real team too', () => {
    const turrets = turretsFromSlots(structureSlots, factions);
    expect(turrets.find(t => t.x === 700)?.teamId).toBe(TeamId.BLUE);
    expect(turrets.find(t => t.x === 1700)?.teamId).toBe(TeamId.RED);
  });

  it('carries a wave muster point for amber/jade the same way', () => {
    const musters = minionMusterSlotsFrom(minionSlots, factions);
    expect(musters.find(m => m.x === 650)?.teamId).toBe(TeamId.BLUE);
    expect(musters.find(m => m.x === 1800)?.teamId).toBe(TeamId.RED);
  });

  it('reads the team off `factions[]`’s own order, not off the spelling "amber"/"jade"', () => {
    // Reversing the *faction list* — not the slot list, see the "does not
    // care what order the spawn slots arrive in" test above for that axis —
    // must flip which side each one lands on, because position, not
    // spelling, is what the bridge reads.
    const reversed = [factions[1], factions[0]];
    const fountains = fountainsFromSlots(spawnSlots, reversed);
    expect(fountains.find(f => f.x === 300)?.teamId).toBe(TeamId.RED);
    expect(fountains.find(f => f.x === 2100)?.teamId).toBe(TeamId.BLUE);
  });

  /**
   * The gameplay consequence, not just the translation: with the bridge
   * broken, `fountain.teamId` was `undefined` for both of Proving Grounds'
   * fountains, so `MinionSpawner.queueWave`'s `teamId !== BLUE && teamId
   * !== RED` guard skipped every one of them and no wave ever formed up —
   * confirmed in the built bundle before this fix (see the batch's own
   * report). This builds the same shape `MinionSpawner` actually reads
   * (fountains, `minionMuster`, an active lane) off amber/jade data and
   * proves a minion comes out the other end.
   */
  describe('a wave actually spawns on a map whose factions are not blue/red', () => {
    afterEach(() => {
      resetLanesForTests();
      vi.unstubAllGlobals();
    });

    it('queues and releases a minion for both sides', () => {
      stubGameGlobals();
      type SpawnerGame = TestGame & MinionSpawnerContext & { fountains: Fountain[] };
      const game = createGame() as SpawnerGame;
      game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
      game.fountains = fountainsFromSlots(spawnSlots, factions).map(
        preset => new Fountain({ game, preset })
      );
      game.minionMuster = minionMusterSlotsFrom(minionSlots, factions);

      // `tests/setup.ts` installs Summoner's Rift's own lanes for every test
      // file by default now — release that guard before installing this
      // test's own amber/jade lane, or the call below throws.
      resetLanesForTests();
      setActiveLanes([
        {
          id: 'mid',
          from: 'amber',
          to: 'jade',
          waypoints: [
            { x: 300, y: 2100 },
            { x: 2100, y: 300 },
          ],
        },
      ]);

      const spawner = new MinionSpawner(game);
      spawner.queueWave();
      spawner.releaseQueued();

      expect(spawner.minions.some(m => m.teamId === TeamId.BLUE)).toBe(true);
      expect(spawner.minions.some(m => m.teamId === TeamId.RED)).toBe(true);
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
const ORIGINAL_RAPTOR1 = {
  crimson: { x: 2954, y: 4110, health: 300, size: 70, speed: 2, avatar: 'monster_Crimson_Raptor' },
  a: { x: 3045, y: 4026, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  b: { x: 3149, y: 4095, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
  c: { x: 3060, y: 4169, health: 50, size: 40, speed: 2, avatar: 'monster_Raptor' },
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
    // Baron's abilities now come from the pack's own code half
    // (`packs/riot/monsters/Baron.ts`'s `makeBaronAbilities`, wired through
    // `bundledPack.ts` and stored by qualified monster id) rather than a
    // statically-importable core constant — `monsterBodyPreset` is a thin
    // forward onto exactly what the registry holds for this monster's own
    // qualified id, and that identity (`toBe`, not `toEqual`) is what this
    // asserts: the same array, not a look-alike copy.
    const baronSlot = summonersRiftGeometry.slots.neutral.find(s => s.role === 'baron')!;
    const baronMonster = monsterFillingSlot(baronSlot)!;
    const baronAbilities = contentRegistry().abilitiesFor(baronMonster.id);
    expect(baronAbilities).toBeDefined();
    expect(monsterBodyPreset(baronMonster, baronMonster.members[0], baronSlot).abilities).toBe(
      baronAbilities
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

  /**
   * The vacuous predecessor of this test compared `ORIGINAL_WOLF2`/
   * `ORIGINAL_RAPTOR2` against `ORIGINAL_WOLF1`/`ORIGINAL_RAPTOR1` — two
   * literal tables declared above in this same file, with no `src/` value on
   * either side of the `expect`. It passed against any implementation,
   * including a broken one, because it never asked the code anything.
   *
   * Deleted rather than pointed at the source, on inspection: the claim it
   * was trying to make ("wolf2/raptor2 share wolf1/raptor1's tuning") holds
   * by construction the moment both slots resolve to the same `role` —
   * `monsterFillingSlot` cannot answer two different monsters for one role,
   * so `monsterFillingSlot(wolfSlot2) === monsterFillingSlot(wolfSlot1)` is
   * guaranteed by object identity, not by any arithmetic worth regression-
   * testing, and is already exercised by "hands every member of a multi-body
   * camp the exact same camp object" above. The one thing that does differ
   * per slot — the recovered *positions* — turns out not to reproduce
   * `ORIGINAL_WOLF2`/`ORIGINAL_RAPTOR2`'s own historical numbers at all: the
   * shared `MonsterDef` bakes in wolf1/raptor1's own offset *shape*, so
   * applying it to wolf2/raptor2's slot lands each body near that slot at
   * wolf1/raptor1's relative layout, not at wolf2/raptor2's original
   * absolute one (a real, deliberate "position simplification", confirmed
   * by running the wolf1-style recovery against the wolf2 slot and watching
   * it fail against `ORIGINAL_WOLF2`). Nothing left to assert here that
   * "fills every neutral slot the real map declares" and the camp-identity
   * test above do not already cover.
   */
});
