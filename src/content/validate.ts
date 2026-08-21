import {
  STRUCTURE_KINDS,
  type ContentPack,
  type ContentPackCode,
  type ContentPackData,
  type StructureKind,
} from './ContentPack';

/**
 * The boundary check, hand-written and dependency-free.
 *
 * Every rule here exists because the engine's own failure for it is silent.
 * `TerrainMap` drops a terrain layer it does not recognise without a word;
 * `MinionSpawner.musterPointFor` returns null for a team with fewer than two
 * turrets and the whole wave falls back into the fountain; a lane naming a
 * faction nobody declared walks minions to `undefined`. Each of those surfaces
 * as a broken match some minutes in. Named at load, they are a sentence.
 */
export type ValidationResult = { ok: true; pack: ContentPack } | { ok: false; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] => {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== 'string') return false;
  }
  return true;
};

/** Bare identifier: the pack id becomes a prefix, so a colon is ambiguous. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function checkManifest(value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push('manifest: missing');
    return;
  }
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    errors.push(`manifest.id: must be a bare identifier, got ${JSON.stringify(value.id)}`);
  }
  if (typeof value.version !== 'string') errors.push('manifest.version: must be a string');
  if (typeof value.coreRange !== 'string') errors.push('manifest.coreRange: must be a string');
}

function checkSpells(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.spells === undefined) return;
  if (!isObject(pack.spells)) {
    errors.push('spells: must be an object');
    return;
  }
  for (const [id, value] of Object.entries(pack.spells)) {
    // A spell class is a constructor; a spell loader is a thunk returning a
    // promise of one. The success path casts this object to
    // Record<string, SpellSource>, and both arms of that union are
    // functions — a class is itself a function — so this one check already
    // accepts either without needing to tell them apart. Only PackRegistry
    // cares which arm it got, at resolution time.
    if (typeof value !== 'function') {
      errors.push(`spells.${id}: must be a class (constructor function)`);
    }
  }
}

function checkChampions(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.champions === undefined) return;
  if (!Array.isArray(pack.champions)) {
    errors.push('champions: must be an array');
    return;
  }
  // `pack.spells` is absent, not empty, when only the data half is being
  // validated (`validatePackData` — a `ContentPackData` has no `spells` key
  // at all) — the code half has not arrived yet, so there is nothing to
  // cross-check a champion's ability ids against, and skipping the check
  // here is not a hole: `install()` still validates the merged pack, spells
  // included, before either half is written. A *present* `spells: {}` (a
  // pack that truly declares none) still fails every reference below, same
  // as before the split.
  const spellsProvided = pack.spells !== undefined;
  const spells = isObject(pack.spells) ? pack.spells : {};
  for (const entry of pack.champions) {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      errors.push('champions[]: each entry needs a string id');
      continue;
    }
    if (typeof entry.name !== 'string') {
      errors.push(`champions.${entry.id}.name: must be a string`);
    }
    if (entry.image !== null && typeof entry.image !== 'string') {
      errors.push(`champions.${entry.id}.image: must be a string or null`);
    }
    if (typeof entry.playable !== 'boolean') {
      errors.push(`champions.${entry.id}.playable: must be a boolean`);
    } else if (entry.playable) {
      // What `listSelectableChampions` and `PLAYABLE_CHAMPION_KITS` have
      // always meant by "pickable": a portrait and all four of Q/W/E/R.
      if (typeof entry.image !== 'string' || entry.image.length === 0) {
        errors.push(`champions.${entry.id}: playable champion needs a portrait (image)`);
      }
      if (!Array.isArray(entry.spells) || entry.spells.length !== 4) {
        errors.push(`champions.${entry.id}: playable champion needs exactly four abilities`);
      }
    }
    if (entry.attack !== undefined) {
      if (!isObject(entry.attack)) {
        errors.push(`champions.${entry.id}.attack: must be an object`);
      } else {
        for (const field of ['damage', 'attacksPerSecond', 'range'] as const) {
          if (!isFiniteNumber(entry.attack[field])) {
            errors.push(`champions.${entry.id}.attack.${field}: must be a finite number`);
          }
        }
      }
    }
    if (!Array.isArray(entry.spells)) {
      errors.push(`champions.${entry.id}.spells: must be an array`);
      continue;
    }
    for (const id of entry.spells) {
      if (typeof id !== 'string') {
        errors.push(`champions.${entry.id}.spells: ids must be strings`);
      } else if (spellsProvided && !(id in spells)) {
        errors.push(`champions.${entry.id}: spell ${id} is not in this pack`);
      }
    }
    if (entry.recall !== undefined) {
      if (typeof entry.recall !== 'string') {
        errors.push(`champions.${entry.id}.recall: must be a string`);
      } else if (spellsProvided && !(entry.recall in spells)) {
        errors.push(`champions.${entry.id}: recall ${entry.recall} is not in this pack`);
      }
    }
  }
}

const SPELL_DISPLAY_FIELDS: Record<string, 'string' | 'number' | 'string-or-null'> = {
  name: 'string',
  description: 'string',
  iconKey: 'string-or-null',
  coolDownMs: 'number',
  manaCost: 'number',
  specCoolDownMs: 'number',
};

function checkSpellDisplay(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.spellDisplay === undefined) return;
  if (!isObject(pack.spellDisplay)) {
    errors.push('spellDisplay: must be an object');
    return;
  }
  // See `checkChampions`'s identical guard: an absent `spells` key means only
  // the data half is being validated, and there is nothing yet to check a
  // display entry's id against.
  const spellsProvided = pack.spells !== undefined;
  const spells = isObject(pack.spells) ? pack.spells : {};
  for (const [id, value] of Object.entries(pack.spellDisplay)) {
    if (spellsProvided && !(id in spells)) {
      errors.push(`spellDisplay.${id}: no spell named ${id} in this pack`);
    }
    if (!isObject(value)) {
      errors.push(`spellDisplay.${id}: must be an object`);
      continue;
    }
    for (const [field, kind] of Object.entries(SPELL_DISPLAY_FIELDS)) {
      const fieldValue = value[field];
      const ok =
        kind === 'string'
          ? typeof fieldValue === 'string'
          : kind === 'number'
            ? isFiniteNumber(fieldValue)
            : fieldValue === null || typeof fieldValue === 'string';
      if (!ok) {
        errors.push(`spellDisplay.${id}.${field}: must be a ${kind}`);
      }
    }
  }
}

function checkMonsters(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.monsters === undefined) return;
  if (!isObject(pack.monsters)) {
    errors.push('monsters: must be an object');
    return;
  }
  for (const [id, value] of Object.entries(pack.monsters)) {
    if (!isObject(value)) {
      errors.push(`monsters.${id}: must be an object`);
      continue;
    }
    if (typeof value.id !== 'string') errors.push(`monsters.${id}.id: must be a string`);
    if (typeof value.name !== 'string') errors.push(`monsters.${id}.name: must be a string`);
    if (!isFiniteNumber(value.health)) {
      errors.push(`monsters.${id}.health: must be a finite number`);
    }
    // PackRegistry.install() and monstersFilling(role) both call
    // monster.fills.includes(role); a non-array fills is a runtime
    // TypeError one layer downstream instead of a named error here.
    if (!isStringArray(value.fills)) {
      errors.push(`monsters.${id}: fills must be an array of strings`);
    }
  }
}

function checkMap(map: unknown, index: number, errors: string[]): void {
  const where = `maps[${index}]`;
  // The one legitimate early return: if `map` is not an object there is
  // nothing left in it to inspect. Every other precondition below is
  // guarded on its own so one malformed section does not hide its siblings.
  if (!isObject(map)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  if (typeof map.id !== 'string') {
    errors.push(`${where}: needs a string id`);
  }
  const name = typeof map.id === 'string' ? `maps.${map.id}` : where;
  if (!isFiniteNumber(map.size) || map.size <= 0) {
    errors.push(`${name}.size: must be a positive number`);
  }
  if (!isObject(map.terrain)) {
    errors.push(`${name}.terrain: missing`);
  } else {
    for (const layer of Object.keys(map.terrain)) {
      // TerrainMap only knows wall/bush/water and drops anything else in
      // silence. A pack that declares `lava` must be told, not ignored.
      if (layer !== 'wall' && layer !== 'bush' && layer !== 'water') {
        errors.push(`${name}.terrain: unknown layer ${layer}`);
      }
    }
  }

  const factions = new Set<string>();
  if (!Array.isArray(map.factions) || map.factions.length === 0) {
    errors.push(`${name}.factions: must list at least one faction`);
  } else {
    for (const faction of map.factions) {
      if (isObject(faction) && typeof faction.id === 'string') factions.add(faction.id);
      else errors.push(`${name}.factions[]: each faction needs a string id`);
    }
  }

  if (!isObject(map.slots)) {
    errors.push(`${name}.slots: missing`);
  } else {
    const slots = map.slots;
    for (const group of ['spawn', 'minion', 'structure', 'neutral']) {
      if (!Array.isArray(slots[group])) errors.push(`${name}.slots.${group}: must be an array`);
    }

    const structures = Array.isArray(slots.structure) ? slots.structure : [];
    for (const slot of structures) {
      if (!isObject(slot)) continue;
      if (!STRUCTURE_KINDS.includes(slot.kind as StructureKind)) {
        errors.push(
          `${name}.slots.structure: unknown kind ${JSON.stringify(slot.kind)}; ` +
            `core provides ${STRUCTURE_KINDS.join(', ')}`
        );
      }
      if (typeof slot.faction === 'string' && !factions.has(slot.faction)) {
        errors.push(`${name}.slots.structure: faction ${slot.faction} was never declared`);
      }
    }

    for (const group of ['spawn', 'minion'] as const) {
      const groupSlots = Array.isArray(slots[group]) ? slots[group] : [];
      for (const slot of groupSlots) {
        if (isObject(slot) && typeof slot.faction === 'string' && !factions.has(slot.faction)) {
          errors.push(`${name}.slots.${group}: faction ${slot.faction} was never declared`);
        }
      }
    }
  }

  // Absent lanes are a shape, not an omission: no waves, and BotBrain's PUSH
  // posture — the only rule that reads a lane — falls through to ROAM.
  if (map.lanes === undefined) return;
  if (!Array.isArray(map.lanes)) {
    errors.push(`${name}.lanes: must be an array when present`);
    return;
  }
  for (const lane of map.lanes) {
    if (!isObject(lane) || typeof lane.id !== 'string') {
      errors.push(`${name}.lanes[]: each lane needs a string id`);
      continue;
    }
    for (const end of ['from', 'to'] as const) {
      const faction = lane[end];
      if (typeof faction !== 'string' || !factions.has(faction)) {
        errors.push(
          `${name}.lanes.${lane.id}.${end}: faction ${String(faction)} was never declared`
        );
      }
    }
  }
}

function checkMaps(pack: Record<string, unknown>, errors: string[]): void {
  if (pack.maps === undefined) return;
  if (!Array.isArray(pack.maps)) {
    errors.push('maps: must be an array');
    return;
  }
  pack.maps.forEach((map: unknown, index: number) => checkMap(map, index, errors));
}

export function validatePack(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkSpells(candidate, errors);
  checkSpellDisplay(candidate, errors);
  checkChampions(candidate, errors);
  checkMonsters(candidate, errors);
  checkMaps(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: candidate as unknown as ContentPack };
}

export type DataValidationResult =
  { ok: true; data: ContentPackData } | { ok: false; errors: string[] };

/**
 * The data half alone: manifest, champions, spell display, monsters, maps —
 * everything `PackRegistry.installData` writes. Reuses the same section
 * checks `validatePack` does; a `ContentPackData` candidate has no `spells`
 * key at all (not an empty one), so `checkChampions`/`checkSpellDisplay`'s
 * "does this id exist in `spells`" cross-check quietly skips itself (see
 * their own `spellsProvided` guard) rather than flagging every reference as
 * missing. `installCode` is what completes the pack; nothing here is a
 * weaker check, only an earlier one.
 */
export function validatePackData(candidate: unknown): DataValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkSpellDisplay(candidate, errors);
  checkChampions(candidate, errors);
  checkMonsters(candidate, errors);
  checkMaps(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: candidate as unknown as ContentPackData };
}

export type CodeValidationResult =
  { ok: true; code: ContentPackCode } | { ok: false; errors: string[] };

/** The code half alone: every entry in `spells` is a class or a loader. */
export function validatePackCode(candidate: unknown): CodeValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkSpells(candidate, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, code: candidate as unknown as ContentPackCode };
}
