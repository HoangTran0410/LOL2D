import { checkMapGeometry, validatePack, validatePackCode, validatePackData } from './validate';
import { isSpellLoader } from './ContentPack';
import { assetManifest as coreAssetManifest } from '@/generated/assetManifest';
import type {
  ChampionEntry,
  ContentPack,
  ContentPackCode,
  ContentPackData,
  MapGeometry,
  MapGeometrySource,
  MapSummary,
  MonsterAbility,
  MonsterDef,
  SpellClass,
  SpellDisplayData,
  SpellSource,
} from './ContentPack';

/**
 * Installed packs, and the one view the rest of the engine reads.
 *
 * Ids are `<packId>:<localId>` because two packs may reasonably use the same
 * local name — an author writing a spell's own local id should not have to know what anyone
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

/**
 * The listing entry `PackRegistry.maps()` hands back — a map's cheap half,
 * qualified. Never the geometry: see `MapDefinition`'s own doc comment for
 * why that split exists, and `loadMapGeometry` for how the heavy half
 * arrives.
 */
export interface QualifiedMapSummary extends Omit<MapSummary, 'id'> {
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
  /** A monster's code half, by qualified monster id — mirrors `sources` for spells. */
  private readonly monsterAbilities = new Map<string, MonsterAbility[]>();
  private readonly championList: QualifiedChampion[] = [];
  private readonly mapList: QualifiedMapSummary[] = [];
  /** A map's geometry source, by qualified id — mirrors `sources` for spells. */
  private readonly mapGeometrySources = new Map<string, MapGeometrySource>();
  /** Mirrors `resolved`: filled eagerly for a plain-object geometry, or once a loader lands. */
  private readonly resolvedMapGeometry = new Map<string, MapGeometry>();
  /** Mirrors `inFlight`: one promise per qualified id, shared by every racing caller. */
  private readonly mapGeometryInFlight = new Map<string, Promise<MapGeometry | null>>();

  /**
   * Validate first, then write. A pack that fails leaves no trace — a
   * half-installed pack is worse than a refused one, because the failure
   * surfaces later and somewhere else.
   *
   * Implemented as `installData` then `installCode` in one atomic step: the
   * whole pack is validated up front (spells included, so a champion naming
   * a spell the pack never declares is still caught here, before anything is
   * written), and only then are the two write helpers called — neither of
   * which validates anything itself, so nothing is written unless the whole
   * pack already passed.
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

    this.writeData(pack);
    this.writeCode(packId, pack);
    this.packs.push(pack);
    this.installedIds.add(packId);
  }

  /**
   * The data half alone: manifest, champions, spell display, monsters, maps.
   * `contentCatalog()` is the reader this exists for — a picker that draws a
   * roster or a map list without ever building a `ContentApi`.
   */
  installData(data: ContentPackData): void {
    const result = validatePackData(data);
    if (result.ok === false) {
      throw new Error(`content pack rejected:\n  ${result.errors.join('\n  ')}`);
    }
    const packId = data.manifest.id;

    if (this.installedIds.has(packId)) {
      throw new Error(`content pack rejected:\n  pack id "${packId}" is already installed`);
    }

    this.writeData(data);
    this.packs.push(data as ContentPack);
    this.installedIds.add(packId);
  }

  /**
   * The code half, against a pack id whose data is already here. Throws
   * rather than silently accepting one — an orphan code half is a pack that
   * half-exists, the exact failure mode `install()`'s validate-then-write
   * ordering was built to avoid, just reached from the other direction.
   *
   * Validates in two passes before writing anything, same discipline as
   * `install()`: `validatePackCode` checks the code half's own shape (every
   * entry is a class or a loader), and `verifyPairing` checks it against the
   * data half `installData` already wrote (every champion ability/recall and
   * every spell-display entry actually names a spell this code half
   * supplies) — the cross-check `validatePack()` runs in one step for
   * `install()`, split across two calls here because it genuinely needs both
   * halves and neither `validatePackData` nor `validatePackCode` alone ever
   * sees them together.
   */
  installCode(packId: string, code: ContentPackCode): void {
    if (!this.installedIds.has(packId)) {
      throw new Error(`content pack rejected:\n  pack id "${packId}" has no installed data`);
    }
    const result = validatePackCode(code);
    if (result.ok === false) {
      throw new Error(`content pack rejected:\n  ${result.errors.join('\n  ')}`);
    }
    this.verifyPairing(packId, code);
    this.writeCode(packId, code);
    this.completePackEntry(packId, code);
  }

  /**
   * Every champion ability/recall and every spell-display entry already
   * installed for `packId` actually names a spell `code` supplies. Not
   * reachable through either bundled pack today — `bundledPack.ts` and
   * `packs/reference/pack.ts` are each one file, so their own data and code
   * halves can never disagree — but batch 4 splits the Riot pack across
   * files, which is exactly when a data half naming a spell its code half
   * forgot becomes possible. Without this, `installCode` would return
   * successfully and the gap would only surface later, as an empty ability
   * slot in a match. Runs before `writeCode`, so a failure here leaves the
   * code half unwritten — the same validate-then-write discipline
   * `installCode`'s own doc comment describes.
   */
  private verifyPairing(packId: string, code: ContentPackCode): void {
    const qualifiedIds = new Set(
      Object.keys(code.spells ?? {}).map(localId => qualify(packId, localId))
    );
    const errors: string[] = [];
    for (const champion of this.championList) {
      if (champion.packId !== packId) continue;
      for (const spellId of champion.spells) {
        if (!qualifiedIds.has(spellId)) {
          errors.push(`champions.${champion.id}: spell ${spellId} is not in this pack`);
        }
      }
      if (champion.recall !== undefined && !qualifiedIds.has(champion.recall)) {
        errors.push(`champions.${champion.id}: recall ${champion.recall} is not in this pack`);
      }
    }
    for (const qualifiedId of this.display.keys()) {
      if (!qualifiedId.startsWith(`${packId}:`)) continue;
      if (!qualifiedIds.has(qualifiedId)) {
        errors.push(`spellDisplay.${qualifiedId}: no spell named ${qualifiedId} in this pack`);
      }
    }
    // The same pairing check, one field over: a `monsterAbilities` entry
    // naming a monster the data half never declared is the same shape of
    // the bug this method exists to catch — an ability array nothing ever
    // resolves to, because `abilitiesFor` is only ever looked up by a real
    // monster's qualified id.
    const monsterIds = new Set(
      this.monsterList.filter(monster => monster.packId === packId).map(monster => monster.id)
    );
    for (const localId of Object.keys(code.monsterAbilities ?? {})) {
      const qualifiedId = qualify(packId, localId);
      if (!monsterIds.has(qualifiedId)) {
        errors.push(`monsterAbilities.${localId}: no monster named ${localId} in this pack`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`content pack rejected:\n  ${errors.join('\n  ')}`);
    }
  }

  /**
   * Merges the code half into the `packs` entry `installData` already wrote
   * for `packId`, so `packs` keeps meaning "every installed pack, whole" on
   * the two-step path too. Without this, an `installData` then `installCode`
   * pair left a permanent `spells: undefined` entry sitting next to a fully
   * installed pack — inert only because nothing reads `packs` outside
   * `reset()` today, which is exactly why it would be silently wrong the
   * first time something does.
   */
  private completePackEntry(packId: string, code: ContentPackCode): void {
    for (const pack of this.packs) {
      if (pack.manifest.id === packId) {
        pack.spells = code.spells;
        pack.monsterAbilities = code.monsterAbilities;
        return;
      }
    }
  }

  private writeData(data: ContentPackData): void {
    const packId = data.manifest.id;
    // Present only for a pack that ships its own art tree (`assets:generate`
    // run against its own `assets/` — `packs/riot/assets/` is the first);
    // absent for one that names no art of its own, the reference pack's own
    // `assets/images/reference/` files included — those still resolve
    // directly against core's flat namespace, unqualified, exactly as before
    // this field existed. See `PackManifest.assets`'s own doc comment for
    // why a pack's asset base is qualified the same way `qualify()` already
    // qualifies everything else here, and why doing it *conditionally* is
    // what keeps a pack with no art tree from being rewritten into a broken
    // reference.
    const assetsBase = data.manifest.assets;
    // Core-first, the same priority `AssetManager.resolveDescriptor` reads
    // with: a key already known to core's own generated manifest is left
    // bare rather than qualified. Without this, `bundledPack.ts`'s merged
    // `{ ...spellCatalog, ...coreSpellCatalog }` (its `spellDisplay`, built
    // from *two* sources — the riot pack's own generated catalogue and
    // core's) would have this qualify `BasicAttack`'s `iconKey` into
    // `'riot:spell_basic_attack'` even though that art never moved and
    // `AssetManager.registerPackAssets('riot', …)` was never handed it —
    // `coreSpells/BasicAttack.ts` still resolves it as `spell_basic_attack`,
    // unqualified, directly off core's own manifest (see that file's
    // permanent exclusion in `coreSpellsApiSurface.test.ts`).
    const qualifyAsset = (key: string): string =>
      assetsBase === undefined || key in coreAssetManifest ? key : qualify(assetsBase, key);

    for (const [localId, displayData] of Object.entries(data.spellDisplay ?? {})) {
      const qualifiedDisplay =
        assetsBase === undefined || displayData.iconKey === null
          ? displayData
          : { ...displayData, iconKey: qualifyAsset(displayData.iconKey) };
      this.display.set(qualify(packId, localId), qualifiedDisplay);
    }
    for (const entry of data.champions ?? []) {
      this.championList.push({
        ...entry,
        packId,
        id: qualify(packId, entry.id),
        image: entry.image === null ? null : qualifyAsset(entry.image),
        spells: entry.spells.map(localId => qualify(packId, localId)),
        recall: entry.recall === undefined ? undefined : qualify(packId, entry.recall),
      });
    }
    for (const monster of Object.values(data.monsters ?? {})) {
      const members =
        assetsBase === undefined
          ? monster.members
          : monster.members.map(member => ({ ...member, avatar: qualifyAsset(member.avatar) }));
      this.monsterList.push({
        ...monster,
        packId,
        id: qualify(packId, monster.id),
        members,
      });
    }
    for (const map of data.maps ?? []) {
      // The split itself: `summary` is everything but `geometry`, and it is
      // that trimmed object — never `map` whole — that lands in `mapList`,
      // the thing `maps()` returns. `geometry` goes only into
      // `mapGeometrySources`, read by `loadMapGeometry`, never by `maps()`.
      const { geometry, ...summary } = map;
      const qualifiedId = qualify(packId, map.id);
      this.mapList.push({ ...summary, packId, id: qualifiedId });
      this.mapGeometrySources.set(qualifiedId, geometry);
      // Same reasoning as `writeCode`'s eager-spell case: a plain-object
      // geometry needs no fetch, so it is available to `loadMapGeometry`
      // immediately without waiting on a loader that does not exist.
      if (typeof geometry !== 'function') {
        this.resolvedMapGeometry.set(qualifiedId, geometry);
      }
    }
  }

  private writeCode(packId: string, code: ContentPackCode): void {
    for (const [localId, spellSource] of Object.entries(code.spells ?? {})) {
      const qualifiedId = qualify(packId, localId);
      this.sources.set(qualifiedId, spellSource);
      // An eager class needs no fetch, so it is available to the synchronous
      // reader immediately — only a loader stays absent from `resolved` until
      // something calls `loadSpellClass`.
      if (!isSpellLoader(spellSource)) {
        this.resolved.set(qualifiedId, spellSource as SpellClass);
      }
    }
    // Monster abilities are always eager — unlike a spell, nothing here is
    // lazy-loaded, because `data.monsters` (the matching data half) is
    // already eager too; see `MonsterBody`'s doc comment for why the split
    // exists at all.
    for (const [localId, abilities] of Object.entries(code.monsterAbilities ?? {})) {
      this.monsterAbilities.set(qualify(packId, localId), abilities);
    }
  }

  champions(): readonly QualifiedChampion[] {
    return [...this.championList];
  }

  /** The listing — every installed map's cheap half, never its geometry. */
  maps(): readonly QualifiedMapSummary[] {
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
   * A map's geometry, fetching it if it has to. `null` for an id no pack
   * declared — the same "absent, not thrown" shape `spellClass` uses.
   *
   * Memoised on the promise, not the result, for the identical reason
   * `loadSpellClass` is: two racing callers (a map picker's preview and
   * `GameScene.startGame()`, say) share one `import()` instead of starting
   * two. `GameScene.startGame()` is the guarantee that this has resolved
   * before `new Game(...)` runs — see that method's own doc comment.
   *
   * Both branches run the resolved object through `validateMapGeometry`
   * before caching or returning it — `validate.ts`'s `checkMap` only ever
   * checked a *plain-object* `geometry` (a loader's body cannot be
   * inspected synchronously), so this is the one place a lazy map's terrain
   * layers, structure kinds, faction references and per-lane muster points
   * are ever actually checked. Throws on a bad pack rather than returning
   * broken geometry to `Game`'s constructor, the same "validate then hand
   * over, never half" discipline `install()` already applies to the rest of
   * a pack.
   */
  async loadMapGeometry(qualifiedId: string): Promise<MapGeometry | null> {
    const already = this.resolvedMapGeometry.get(qualifiedId);
    if (already) return already;

    const source = this.mapGeometrySources.get(qualifiedId);
    if (!source) return null;

    if (typeof source !== 'function') {
      this.validateMapGeometry(qualifiedId, source);
      this.resolvedMapGeometry.set(qualifiedId, source);
      return source;
    }

    const pending = this.mapGeometryInFlight.get(qualifiedId);
    if (pending) return pending;

    const run = source().then(geometry => {
      this.validateMapGeometry(qualifiedId, geometry);
      this.resolvedMapGeometry.set(qualifiedId, geometry);
      this.mapGeometryInFlight.delete(qualifiedId);
      return geometry;
    });
    this.mapGeometryInFlight.set(qualifiedId, run);
    return run;
  }

  /**
   * Runs a resolved `MapGeometry` through `validate.ts`'s `checkMapGeometry`
   * against the same `factions` its own `MapSummary` declared, and throws
   * if it fails — `loadMapGeometry`'s only caller, on both the plain-object
   * and the settled-loader path.
   *
   * `factions` comes from `mapList`, not from re-reading the pack: `writeData`
   * already split `summary`/`geometry` apart and qualified the summary into
   * `mapList`, so that is the one place this qualified id's declared
   * factions still live.
   */
  private validateMapGeometry(qualifiedId: string, geometry: MapGeometry): void {
    const summary = this.mapList.find(map => map.id === qualifiedId);
    const factions = new Set((summary?.factions ?? []).map(faction => faction.id));
    const errors: string[] = [];
    checkMapGeometry(geometry as unknown as Record<string, unknown>, qualifiedId, factions, errors);
    if (errors.length > 0) {
      throw new Error(`map geometry rejected:\n  ${errors.join('\n  ')}`);
    }
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

  /**
   * A monster's code half — real `MonsterAbility` callbacks, built from the
   * pack's own `ContentApi` — or `undefined` for a monster that declared
   * none (every camp except this pack's one boss monster, today). `preset.ts`'s `monsterBodyPreset`
   * is the one caller: this is what lets it merge that monster's kit onto the
   * preset without core importing that pack file directly.
   */
  abilitiesFor(qualifiedMonsterId: string): MonsterAbility[] | undefined {
    return this.monsterAbilities.get(qualifiedMonsterId);
  }

  reset(): void {
    this.packs.length = 0;
    this.championList.length = 0;
    this.monsterList.length = 0;
    this.monsterAbilities.clear();
    this.mapList.length = 0;
    this.sources.clear();
    this.display.clear();
    this.resolved.clear();
    this.inFlight.clear();
    this.mapGeometrySources.clear();
    this.resolvedMapGeometry.clear();
    this.mapGeometryInFlight.clear();
    this.installedIds.clear();
  }
}
