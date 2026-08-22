import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined) },
}));

const replacementPreset = vi.hoisted(() => ({
  value: { avatar: 'replacement', spells: [] as Array<new (owner: unknown) => unknown> },
}));

vi.mock('../../../src/game/preset', () => ({
  getChampionPresetRandom: () => replacementPreset.value,
}));

import ObjectManager from '../../../src/game/managers/ObjectManager';
import Spell from '../../../src/game/gameObject/Spell';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import { packIsInstalled } from '../../support/installedPacks';

describe('Champion spell presentation lifecycle', () => {
  it('draws VFX for every owned spell in the champion world layer', () => {
    const champion = Object.create(Champion.prototype) as Champion;
    const first = { drawVfx: vi.fn() };
    const second = { drawVfx: vi.fn() };
    champion.spells = [first, second] as unknown as Spell[];
    champion.drawAvatar = vi.fn();
    champion.drawDir = vi.fn();
    champion.drawBuffs = vi.fn();
    champion.drawHealthBar = vi.fn();

    champion.draw();

    expect(first.drawVfx).toHaveBeenCalledOnce();
    expect(second.drawVfx).toHaveBeenCalledOnce();
    expect(champion.drawAvatar).toHaveBeenCalledOnce();
  });

  it('deactivates owned spells through ObjectManager champion removal', () => {
    const deactivate = vi.fn();
    const champion = Object.assign(Object.create(Champion.prototype) as Champion, {
      spells: [{ deactivate }] as unknown as Spell[],
      toRemove: true,
      update: vi.fn(),
      // Every real object has one; the update loop snapshots it as the render
      // origin (see ObjectManager.update). The sibling test below supplies it too.
      position: { x: 0, y: 0 },
    });
    const manager = Object.assign(Object.create(ObjectManager.prototype) as ObjectManager, {
      objects: [champion],
      _objectToBeAdd: [],
      _deadBuffer: [],
      _objectsTreeIsUpdating: false,
      _objectsTree: { clear: vi.fn(), insert: vi.fn() },
      _decorTree: { clear: vi.fn(), insert: vi.fn() },
      // hand-built manager, so the class field initialisers never ran
      unitCollision: { resolve: vi.fn() },
    });

    manager.update();

    expect(deactivate).toHaveBeenCalledOnce();
    expect(manager.objects).toEqual([]);
  });

  it('deactivates old spells when an AI respawn replaces its preset', () => {
    const deactivate = vi.fn();
    class ReplacementSpell extends Spell {}
    replacementPreset.value = { avatar: 'replacement', spells: [ReplacementSpell] };
    const position = { x: 0, y: 0, set: vi.fn() };
    const champion = Object.assign(Object.create(AIChampion.prototype) as AIChampion, {
      spells: [{ deactivate }] as unknown as Spell[],
      _respawnWithNewPreset: true,
      // Hand-built via Object.create, so the constructor never ran and never
      // defaulted this to getChampionPresetRandom — set directly to what
      // that default would have resolved to under the mock above.
      presetFactory: () => replacementPreset.value,
      // respawn() now restores the whole preset through Champion.applyPreset,
      // not just the spells, so the attack stats have to be here too.
      stats: {
        health: { baseValue: 0 },
        maxHealth: { value: 100 },
        attackDamage: { baseValue: 0 },
        attackSpeed: { baseValue: 0 },
        attackRange: { baseValue: 0 },
      },
      deathData: { reviveAfter: 0 },
      game: { randomSpawnPoint: () => ({ x: 5, y: 6 }) },
      position,
      destination: { ...position, set: vi.fn() },
    });

    champion.respawn();

    expect(deactivate).toHaveBeenCalledOnce();
    expect(champion.spells).toHaveLength(1);
    expect(champion.spells[0]).toBeInstanceOf(ReplacementSpell);
  });

  it('deactivates both array and slot replacements', () => {
    const first = { deactivate: vi.fn(), onRemoved: vi.fn() };
    const second = { deactivate: vi.fn(), onRemoved: vi.fn() };
    const champion = Object.assign(Object.create(Champion.prototype) as Champion, {
      spells: [first, second] as unknown as Spell[],
    });
    const replacement = { deactivate: vi.fn(), onRemoved: vi.fn() };

    champion.replaceSpell(0, replacement as unknown as Spell);
    champion.replaceSpells([]);

    expect(first.deactivate).toHaveBeenCalledOnce();
    expect(first.onRemoved).toHaveBeenCalledOnce();
    expect(replacement.deactivate).toHaveBeenCalledOnce();
    expect(replacement.onRemoved).toHaveBeenCalledOnce();
    expect(second.deactivate).toHaveBeenCalledOnce();
    expect(second.onRemoved).toHaveBeenCalledOnce();
  });

  it('routes production spell replacement through Champion cleanup', () => {
    // `Shaco_R.ts` is the riot pack's, and is only read when that pack is
    // installed — batch 5 task 8's drill `ENOENT`ed here with it moved aside.
    // It is in the list because a clone-spawning ultimate is the shape that
    // used to assign `clone.spells[i] =` directly; core's own three files are
    // the permanent half of the population.
    const files = [
      '../../../src/game/gameObject/attackableUnits/AIChampion.ts',
      ...(packIsInstalled('riot') ? ['../../../packs/riot/spells/Shaco_R.ts'] : []),
      '../../../src/game/hud/InGameHUD.ts',
      // The spell picker's `pick()` — what used to be InGameHUD's own
      // spell-swap logic — moved here when the HUD split into a shared
      // state/interaction layer plus desktop/mobile views.
      '../../../src/game/hud/hudInteractions.ts',
    ];
    const directAssignments = files.flatMap(relativePath =>
      readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
        .split('\n')
        .filter(line => /(?:game\.player|bot|clone)\.spells(?:\[[^\]]+\])?\s*=/.test(line))
    );

    expect(directAssignments).toEqual([]);
  });
});
