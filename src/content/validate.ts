import { STRUCTURE_KINDS, type ContentPack, type StructureKind } from './ContentPack';

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
    // A spell class is a constructor. The success path casts this object to
    // Record<string, SpellClass>; whatever eventually `new`s an entry must
    // find a function there, not a string or a plain object.
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
    if (!Array.isArray(entry.spells)) {
      errors.push(`champions.${entry.id}.spells: must be an array`);
      continue;
    }
    for (const id of entry.spells) {
      if (typeof id !== 'string') {
        errors.push(`champions.${entry.id}.spells: ids must be strings`);
      } else if (!(id in spells)) {
        errors.push(`champions.${entry.id}: spell ${id} is not in this pack`);
      }
    }
    if (entry.recall !== undefined) {
      if (typeof entry.recall !== 'string') {
        errors.push(`champions.${entry.id}.recall: must be a string`);
      } else if (!(entry.recall in spells)) {
        errors.push(`champions.${entry.id}: recall ${entry.recall} is not in this pack`);
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

export function validatePack(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(candidate)) {
    return { ok: false, errors: ['pack: must be an object'] };
  }

  checkManifest(candidate.manifest, errors);
  checkSpells(candidate, errors);
  checkChampions(candidate, errors);
  checkMonsters(candidate, errors);

  if (candidate.maps !== undefined) {
    if (!Array.isArray(candidate.maps)) errors.push('maps: must be an array');
    else candidate.maps.forEach((map: unknown, index: number) => checkMap(map, index, errors));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: candidate as unknown as ContentPack };
}
