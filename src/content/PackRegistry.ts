import { validatePack } from './validate';
import type {
  ChampionEntry,
  ContentPack,
  MapDefinition,
  MonsterDef,
  SpellClass,
} from './ContentPack';

/**
 * Installed packs, and the one view the rest of the engine reads.
 *
 * Ids are `<packId>:<localId>` because two packs may reasonably use the same
 * local name — an author writing `Fizz_E` should not have to know what anyone
 * else called theirs. The author writes the local half and never sees the
 * prefix; the registry is the only thing that joins them.
 *
 * The sections merge differently on purpose. Champions concatenate and spells
 * and monsters key by qualified id, so a second pack adds to the first. Maps
 * are *listed* — a match has many champions and exactly one world, so that
 * section is a choice made per match rather than a union.
 */
export interface QualifiedChampion extends Omit<ChampionEntry, 'id' | 'spells'> {
  id: string;
  packId: string;
  spells: string[];
}

export interface QualifiedMonster extends Omit<MonsterDef, 'id'> {
  id: string;
  packId: string;
}

export interface QualifiedMap extends Omit<MapDefinition, 'id'> {
  id: string;
  packId: string;
}

export const qualify = (packId: string, localId: string): string => `${packId}:${localId}`;

export class PackRegistry {
  private readonly packs: ContentPack[] = [];
  private readonly spells = new Map<string, SpellClass>();
  private readonly monsterList: QualifiedMonster[] = [];
  private readonly championList: QualifiedChampion[] = [];
  private readonly mapList: QualifiedMap[] = [];

  /**
   * Validate first, then write. A pack that fails leaves no trace — a
   * half-installed pack is worse than a refused one, because the failure
   * surfaces later and somewhere else.
   */
  install(pack: ContentPack): void {
    const result = validatePack(pack);
    if (result.ok === false) {
      throw new Error(`content pack rejected:\n  ${result.errors.join('\n  ')}`);
    }
    const packId = pack.manifest.id;

    for (const [localId, spellClass] of Object.entries(pack.spells ?? {})) {
      this.spells.set(qualify(packId, localId), spellClass);
    }
    for (const entry of pack.champions ?? []) {
      this.championList.push({
        ...entry,
        packId,
        id: qualify(packId, entry.id),
        spells: entry.spells.map(localId => qualify(packId, localId)),
      });
    }
    for (const monster of Object.values(pack.monsters ?? {})) {
      this.monsterList.push({ ...monster, packId, id: qualify(packId, monster.id) });
    }
    for (const map of pack.maps ?? []) {
      this.mapList.push({ ...map, packId, id: qualify(packId, map.id) });
    }
    this.packs.push(pack);
  }

  champions(): readonly QualifiedChampion[] {
    return this.championList;
  }

  maps(): readonly QualifiedMap[] {
    return this.mapList;
  }

  spellClass(qualifiedId: string): SpellClass | null {
    return this.spells.get(qualifiedId) ?? null;
  }

  /**
   * Every monster that can occupy a slot with this role, in install order.
   *
   * A map slot names a role, never a monster, so a map author does not have to
   * know which monsters exist. Where several answer, install order decides and
   * the match config can override.
   */
  monstersFilling(role: string): readonly QualifiedMonster[] {
    const out: QualifiedMonster[] = [];
    for (const monster of this.monsterList) {
      if (monster.fills.includes(role)) out.push(monster);
    }
    return out;
  }

  reset(): void {
    this.packs.length = 0;
    this.championList.length = 0;
    this.monsterList.length = 0;
    this.mapList.length = 0;
    this.spells.clear();
  }
}
