import { validatePack } from './validate';
import { isSpellLoader } from './ContentPack';
import type {
  ChampionEntry,
  ContentPack,
  MapDefinition,
  MonsterDef,
  SpellClass,
  SpellDisplayData,
  SpellSource,
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
  private readonly sources = new Map<string, SpellSource>();
  private readonly display = new Map<string, SpellDisplayData>();
  private readonly resolved = new Map<string, SpellClass>();
  private readonly inFlight = new Map<string, Promise<SpellClass | null>>();
  private readonly installedIds = new Set<string>();
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

    if (this.installedIds.has(packId)) {
      throw new Error(`content pack rejected:\n  pack id "${packId}" is already installed`);
    }

    for (const [localId, spellSource] of Object.entries(pack.spells ?? {})) {
      const qualifiedId = qualify(packId, localId);
      this.sources.set(qualifiedId, spellSource);
      // An eager class needs no fetch, so it is available to the synchronous
      // reader immediately — only a loader stays absent from `resolved` until
      // something calls `loadSpellClass`.
      if (!isSpellLoader(spellSource)) {
        this.resolved.set(qualifiedId, spellSource as SpellClass);
      }
    }
    for (const [localId, data] of Object.entries(pack.spellDisplay ?? {})) {
      this.display.set(qualify(packId, localId), data);
    }
    for (const entry of pack.champions ?? []) {
      this.championList.push({
        ...entry,
        packId,
        id: qualify(packId, entry.id),
        spells: entry.spells.map(localId => qualify(packId, localId)),
        recall: entry.recall === undefined ? undefined : qualify(packId, entry.recall),
      });
    }
    for (const monster of Object.values(pack.monsters ?? {})) {
      this.monsterList.push({ ...monster, packId, id: qualify(packId, monster.id) });
    }
    for (const map of pack.maps ?? []) {
      this.mapList.push({ ...map, packId, id: qualify(packId, map.id) });
    }
    this.packs.push(pack);
    this.installedIds.add(packId);
  }

  champions(): readonly QualifiedChampion[] {
    return [...this.championList];
  }

  maps(): readonly QualifiedMap[] {
    return [...this.mapList];
  }

  hasSpell(qualifiedId: string): boolean {
    return this.sources.has(qualifiedId);
  }

  spellIds(): readonly string[] {
    return [...this.sources.keys()];
  }

  /** The class, if it is already here. A loader that has not run answers `null`. */
  spellClass(qualifiedId: string): SpellClass | null {
    return this.resolved.get(qualifiedId) ?? null;
  }

  /**
   * A spell's display data — name, description, icon, tuning numbers — as the
   * pregame screen needs it, with no class ever loaded. `null` when the pack
   * declared no `spellDisplay` entry for this id, which is a shape, not a
   * defect: only the reference pack's own picker entry depends on it existing.
   */
  spellDisplay(qualifiedId: string): SpellDisplayData | null {
    return this.display.get(qualifiedId) ?? null;
  }

  /**
   * Every id with display data, across every installed pack.
   *
   * This is the population a `'random'` loadout slot is drawn from and a
   * persisted slot is validated against (`spellRegistry.ts`'s `allSpellIds` /
   * `isSpellId`) — deliberately not `spellIds()`. A pack may declare a spell
   * that is loadable but has no display entry — the bundled pack's
   * `riot:Recall`, so `Champion.recall` can name it — and a HUD asked to
   * render a slot it has no name or icon for is exactly the bug this narrower
   * population exists to prevent.
   */
  spellDisplayIds(): readonly string[] {
    return [...this.display.keys()];
  }

  /** Whether `qualifiedId` has display data — the same population `spellDisplayIds` lists. */
  hasDisplayFor(qualifiedId: string): boolean {
    return this.display.has(qualifiedId);
  }

  /**
   * The class, fetching it if it has to.
   *
   * Memoised on the promise, not on the result, so two callers racing the same
   * spell share one import instead of starting two.
   */
  async loadSpellClass(qualifiedId: string): Promise<SpellClass | null> {
    const already = this.resolved.get(qualifiedId);
    if (already) return already;

    const source = this.sources.get(qualifiedId);
    if (!source) return null;

    // A class is itself; only a loader has anything to await. `isSpellLoader`
    // trusts an arrow function unconditionally (it can never be a class) and
    // otherwise requires the `lazy()` mark — install() already resolved every
    // other eager class into `resolved`, so reaching here with a non-loader
    // only happens if a caller mutates `sources` directly, which nothing does.
    if (!isSpellLoader(source)) {
      this.resolved.set(qualifiedId, source as SpellClass);
      return source as SpellClass;
    }

    const pending = this.inFlight.get(qualifiedId);
    if (pending) return pending;

    const run = source().then(spellClass => {
      this.resolved.set(qualifiedId, spellClass);
      this.inFlight.delete(qualifiedId);
      return spellClass;
    });
    this.inFlight.set(qualifiedId, run);
    return run;
  }

  /**
   * Test seam: write a class straight into `resolved`, bypassing `sources`
   * and `install()` entirely.
   *
   * A test that wants one lookup to succeed should not have to await 240
   * dynamic imports to get it — this exists for exactly that case, never for
   * production code, which always arrives through `install()`.
   */
  registerSpellForTests(qualifiedId: string, spellClass: SpellClass): void {
    this.resolved.set(qualifiedId, spellClass);
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
    this.sources.clear();
    this.display.clear();
    this.resolved.clear();
    this.inFlight.clear();
    this.installedIds.clear();
  }
}
