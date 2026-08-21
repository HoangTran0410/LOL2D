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
import { fountainsFromSlots, turretsFromSlots } from '../../src/game/preset';
import { summonersRiftGeometry } from '../../src/content/maps/summonersRiftGeometry';

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
