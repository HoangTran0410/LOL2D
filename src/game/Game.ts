import type { ActiveMap, NeutralSlot, SpawnSlot, StructureSlot } from '@/content/ContentPack';
import { HotKeys, SpellHotKeys } from './constants';
import { clearActiveLanes, setActiveLanes } from './lanes';
import AttackableUnit from './gameObject/attackableUnits/AttackableUnit';
import Champion from './gameObject/attackableUnits/Champion';
import AIChampion from './gameObject/attackableUnits/AIChampion';
import Monster from './gameObject/attackableUnits/Monster';
import { teamBodyColor } from './gameObject/attackableUnits/Minion';
import Camera, { zoomFactorPreference } from './gameObject/map/Camera';
import FogOfWar from './gameObject/map/FogOfWar';
import TerrainMap from './gameObject/map/TerrainMap';
import Minimap, { hitTest, type MinimapBlip, type MinimapHost } from './gameObject/map/Minimap';
import Fountain from './gameObject/structures/Fountain';
import Turret from './gameObject/structures/Turret';
import InGameHUD from './hud/InGameHUD';
import {
  attachRecall,
  fountainsFromSlots,
  getChampionPresetFromLoadout,
  minionMusterSlotsFrom,
  monsterBodyPreset,
  monsterFillingSlot,
  planLoadout,
  planMatchKits,
  presetFromPlan,
  turretsFromSlots,
  type MatchPlan,
  type MinionMusterPoint,
} from './preset';
import {
  loadPregameConfig,
  toMatchRules,
  type ChampionLoadout,
  type MatchRules,
} from './config/PregameConfig';
import ObjectManager from './managers/ObjectManager';
import type { RenderQuality } from './managers/ObjectManager';
import MinionSpawner from './managers/MinionSpawner';
import MatchDirector from './MatchDirector';
import NavigationSystem from './nav/NavigationSystem';
import { drawNavDebug } from './nav/NavDebugOverlay';
import { drawExecuteMarks } from './combat/ExecuteMarks';
import { drawDebugOverlay } from './debug/DebugOverlay';
import { FpsMeter, drawFpsOverlay } from './debug/FpsOverlay';
import EventManager from '@/managers/EventManager';
import { uuidv4 } from '@/utils';
import SpellInputController from './spell/input/SpellInputController';
import TargetResolver, {
  defaultIsTargetable,
  defaultTargetInfo,
} from './spell/targeting/TargetResolver';
import AssetManager from '@/managers/AssetManager';
import { findAttackTargetAlongRay, findAttackTargetNearPoint } from './combat/AttackTargeting';
import TouchControls, {
  touchControlsPreference,
  rememberTouchControlsPreference,
  type TouchControlsHost,
  type TouchPoint,
  type TouchSpellView,
} from './input/TouchControls';
import { touchAimRange } from './input/SpellAim';
import type { AimCandidate } from './input/SpellAim';
import type { JoystickVector } from './input/VirtualJoystick';
import { issuePointerOrder } from './input/PointerOrders';
import type Spell from './gameObject/Spell';
import type { CastContext, Vec2 } from './spell/runtime/types';

/**
 * How far ahead of the champion the joystick plants its destination, as frames
 * of travel at the current move speed.
 *
 * The engine walks a unit at `destination`; a stick gives a held direction. The
 * two meet by re-planting a destination in front of the champion every frame
 * the stick is held, which keeps every existing modifier — roots, slows, the
 * `canMove` gate, terrain push-out — working untouched, where steering
 * `position` directly would bypass all of them.
 *
 * It has to be more than one frame of travel or `move()` snaps onto the
 * destination and the champion stutters in place; 30 frames is half a second of
 * walking. Nothing coasts when the thumb lifts, because releasing calls
 * `stopMovement()`, which pins the destination back onto the position.
 */
const JOYSTICK_LOOKAHEAD_FRAMES = 30;
const JOYSTICK_LOOKAHEAD_MIN = 120;

/**
 * The four render preferences now live in `game/config/renderPreferences.ts` —
 * `localStorage` with no p5 and no imports of its own, so the match-config
 * panel can read them from the menu without pulling this file (and the match
 * with it) into the menu's chunk. Re-exported here so every existing
 * `from '@/game/Game'` still resolves; this file remains the only thing that
 * *applies* them.
 */
export {
  renderQualityPreference,
  setRenderQualityPreference,
  renderFpsPreference,
  setRenderFpsPreference,
  type RenderFps,
} from './config/renderPreferences';

// A re-export does not bind the names locally; this file applies all four.
import {
  renderQualityPreference,
  setRenderQualityPreference,
  renderFpsPreference,
  setRenderFpsPreference,
  type RenderFps,
} from './config/renderPreferences';

export default class Game {
  /**
   * The active map's edge length in world units — `map.size`, set in the
   * constructor. Used to be a `6400` literal here (and a matching `|| 6400`
   * fallback in `TerrainMap`); both now read the map instead. See the
   * `map` constructor parameter's own doc comment for what guarantees the
   * map is present.
   */
  readonly mapSize: number;
  /**
   * The active map's own qualified id — `map.id`, set in the constructor.
   * The one fact `MatchDirectorSource.getMap()` reads about a running
   * match's world: a live match cannot swap its terrain, nav grid or
   * standing objects out from under itself, so the panel reports this,
   * unmoved, rather than whatever the player has since picked for next time
   * (`MatchDirector`'s own `_mapChoice`). Read through `HudInteractions`
   * (`hudInteractions.ts`), not through `MatchDirector` — the same seam
   * `renderQuality`/`renderFps` already use for a fact about the match that
   * is not one of its mutable settings.
   */
  readonly activeMapId: string;
  /**
   * The active map's own `slots.minion`, teamId-bridged — where each team's
   * wave forms up, per lane. Set in the constructor, read by `MinionSpawner`
   * (`MinionSpawnerContext.minionMuster`) once per spawn rather than derived
   * from the live turrets the way `musterPointFor` used to.
   */
  readonly minionMuster: MinionMusterPoint[];
  /**
   * The active map's own `slots.neutral` — where each jungle camp sits. Set
   * in the constructor and read by `spawnJungle()`, which stays a no-arg
   * method (`MatchDirectorContext.spawnJungle`) so `MatchDirector` can
   * respawn the whole jungle when `jungleEnabled` is flipped back on
   * mid-match without needing to hold the map itself.
   */
  readonly neutralSlots: NeutralSlot[];
  /*
   * There is no `readonly lanes: LaneDefinition[]` field beside the two
   * above: `getLaneWaypoints`, `LANES` and the rest of `lanes.ts` have to
   * stay callable without a `Game` in hand (see that module's own doc
   * comment), so the constructor installs `map.lanes` into its live state
   * (`setActiveLanes`) instead of holding it here.
   */
  readonly fps = 60;
  renderFps: RenderFps = renderFpsPreference();
  renderQuality: RenderQuality = renderQualityPreference();

  camera!: Camera;
  objectManager!: ObjectManager;
  eventManager!: EventManager;
  terrainMap!: TerrainMap;
  navigation!: NavigationSystem;
  fogOfWar!: FogOfWar;
  inGameHUD!: InGameHUD;
  player!: Champion;
  spellInputController!: SpellInputController;
  minionSpawner!: MinionSpawner;
  touchControls!: TouchControls;
  minimap!: Minimap;
  /** Backs the Cài đặt tab's FPS toggle (`director.debug.fps`); see `debug/FpsOverlay.ts`. */
  private readonly fpsMeter = new FpsMeter();

  /**
   * Every mutation of this match once it is running — roster, world, rules —
   * goes through here, so the HUD never reaches into `objectManager` or
   * `minionSpawner` on its own. Nothing in this constructor uses it; it is the
   * entry point for changes made *during* the match. See `MatchDirector`'s
   * file comment.
   */
  director!: MatchDirector;

  /**
   * How the match asks to be left. `GameScene` sets it to its own
   * `sceneManager.showScene(MenuScene)` right after constructing this.
   *
   * A callback rather than a scene-manager reference because the dependency
   * runs the other way everywhere else: scenes know about games, games do not
   * know about scenes. Left `null` in a bench that never built a scene, where
   * "leave the match" has no meaning.
   */
  onExitRequested: (() => void) | null = null;
  onPauseChanged: ((paused: boolean) => void) | null = null;

  /**
   * Cooldown reduction and URF, resolved from the pregame config at
   * construction. `Spell.ts` reads this off `owner.game.matchRules` — see
   * `Spell.reducedCooldown` — rather than this class pushing the numbers into
   * every spell it creates, so a spell built at any point in a match (a
   * respawn's fresh kit, a champion swap) picks the same rules up on its own.
   *
   * Not fixed for the match any more: the practice panel retunes them through
   * `director.setRules()`, which *mutates this object in place* for exactly the
   * reason above — every spell already holds this reference, so replacing it
   * would leave all of them reading the old numbers.
   */
  matchRules!: MatchRules;

  /**
   * Where each slot is aimed by a thumb, when one is on it. Empty on the
   * keyboard, and `createSpellContext` falls back to the cursor — which is what
   * makes this the only coupling the touch layer needs to the cast path.
   */
  private touchAim = new Map<number, Vec2>();
  /**
   * Every finger currently on the glass, and the subset of them the minimap
   * claimed. Both live here rather than in `TouchControls` because the whole
   * point is to decide *before* the controls are told anything.
   */
  private seenTouches = new Set<number>();
  private minimapTouches = new Set<number>();
  /** Last direction the champion was driven, for aiming a tap with no target. */
  private lastFacing = { x: 1, y: 0 };

  fountains: Fountain[] = [];
  turrets: Turret[] = [];
  monsters: Monster[] = [];

  clickedPoint = { x: 0, y: 0, size: 0 };
  worldMouse!: p5.Vector;
  paused = false;
  /**
   * Milliseconds of unpaused match. The single time domain every bot shares.
   *
   * Deliberately not per-bot: bots are added mid-match (`MatchDirector.addBot`,
   * the panel's Đội tab) and `TeamBlackboard` is one time-keyed object per
   * game, so a second clock domain reading it never expires a memory and can
   * stall the whole board's refresh. Behind the pause gate on purpose, so the
   * practice panel holding the match does not age anyone's memory.
   */
  matchTimeMs = 0;
  touchUi: boolean;

  /**
   * @param map The world this match plays on, geometry already resolved —
   *   not the lazy `MapDefinition` a pack declares. Required, not defaulted:
   *   `validate.ts` refuses a pack whose map has no size, so a `Game` built
   *   without one is a programming error to surface loudly rather than a
   *   `6400` to fall back to. `GameScene.startGame()` is what guarantees
   *   this exists before construction — it awaits
   *   `contentCatalog().loadMapGeometry(...)` alongside the spell/art loads
   *   it already awaits, and only then calls `new Game(...)`. This
   *   constructor itself stays synchronous on purpose: `AIChampion` rebuilds
   *   mid-`update()`, and the engine's read side is synchronous by design —
   *   see `CLAUDE.md`'s note on the trap this avoids.
   * @param plan Which kits every unit will play, with all randomness already
   *   rolled. `GameScene` passes one because it has to: the spell classes are
   *   fetched per champion now, so *something* has to decide what a match needs
   *   before it can be loaded, and that decision has to be the same one this
   *   constructor then builds from. Omitted, this plans for itself — which is
   *   correct only when the catalogue is already loaded, i.e. in tests.
   */
  constructor(map: ActiveMap, plan?: MatchPlan) {
    this.mapSize = map.size;
    this.activeMapId = map.id;
    this.minionMuster = minionMusterSlotsFrom(map.slots.minion, map.factions);
    this.neutralSlots = map.slots.neutral;
    // Before anything queues a wave or builds a blackboard: `MinionSpawner`,
    // `TeamBlackboard` and `LaneObjectives.ts` all read `lanes.ts`'s live
    // `LANES`/`LANE_WAYPOINTS` rather than a value handed to them, so this is
    // what makes those the *this* match's lanes. `undefined` is a map with no
    // `lanes[]` at all — spec §7's laneless case — which empties both and
    // leaves PUSH nothing to fall through from ROAM/FIGHT for.
    setActiveLanes(map.lanes);
    // Read once, before anything that might construct a Champion or a Spell:
    // `matchRules` has to be in place the moment the player's own kit is
    // built a few lines down. Validated/defaulted by `loadPregameConfig`
    // itself, so a corrupt or missing stored blob never reaches this
    // constructor as anything other than a playable config.
    const pregameConfig = loadPregameConfig();
    const kits = plan ?? planMatchKits(pregameConfig);
    this.matchRules = toMatchRules(pregameConfig.rules);
    this.touchUi = touchControlsPreference();

    this.worldMouse = createVector(0, 0);
    this.camera = new Camera();
    // Before anything reads a world position from the screen. `width`/`height`
    // are valid here: `Game` is constructed from `GameScene.enter()`, after
    // `createCanvas`.
    this.camera.setZoomFactor(zoomFactorPreference(this.touchUi));
    this.camera.fitTo(width, height);
    // A match that boots and is never resized must not sit at the constructed
    // 0.5 default, and the opening lerp from it would now zoom a phone *out*.
    this.camera.snapToScale();
    this.objectManager = new ObjectManager(this);
    this.eventManager = new EventManager();
    this.terrainMap = new TerrainMap(this, map);
    // The map is static, so every unit's routing is derived from the wall layer
    // once here — about 7ms and 1.6MB for the whole game — rather than per unit
    // per frame. Built off the same Obstacle list the collision push-out uses,
    // so there is one source of truth for where the walls are.
    this.navigation = new NavigationSystem(this.terrainMap.wallPolygons(), this.mapSize);
    // And now literally one structure, not merely one source: the grid routes
    // are planned against is handed straight back to be the field they are
    // enforced against. Those used to be a clearance grid and a pile of SAT
    // polygons giving different answers to "where is the wall", which is what
    // NAV_MAX_ACCEPTED_OVERLAP exists to reconcile. Without this line
    // `TerrainMap` would build an identical second one and hold it twice.
    this.terrainMap.useNavGrid(this.navigation.grid);
    this.fogOfWar = new FogOfWar(this);
    this.minimap = new Minimap(this.minimapHost());
    this.inGameHUD = new InGameHUD(this);

    // Fountains first: each champion asks the matching team fountain for its
    // initial point, and randomSpawnPoint falls back safely for UUID/FFA teams.
    this.spawnFountains(map.slots.spawn, map.factions);

    // Blue by default and for every match before the team tab existed, but the
    // player is now a movable roster slot like any bot — so its side comes from
    // the config, which persists a team switch the same way it persists a bot's.
    const playerTeam = pregameConfig.playerTeam;
    this.player = attachRecall(
      new Champion({
        game: this,
        position: this.randomSpawnPoint(playerTeam),
        teamId: playerTeam,
        preset: presetFromPlan(kits.player),
      })
    );
    this.objectManager.addObject(this.player);
    this.spellInputController = new SpellInputController({
      keyBindings: SpellHotKeys,
      getSpell: slot => this.player.spells[slot],
      createContext: (_spell, slot) => {
        const spell = this.player.spells[slot];
        if (!spell) return undefined;
        // A thumb aims by dragging; a mouse aims by being somewhere. One line
        // decides which, and every spell downstream sees an ordinary context.
        const aim = this.touchAim.get(slot) ?? this.worldMouse;
        return this.createSpellContext(spell, this.player, aim);
      },
    });

    this.touchControls = new TouchControls(this.touchControlsHost(), this.touchUi);
    this.applyTouchUiClass();

    // Each bot's champion/kit comes from its own slot in ai.bots — 'random'
    // by default (today's behaviour, unchanged), or a specific loadout the
    // player configured for that bot. Behaviour flags come from the matching
    // slot in ai.botBehaviours — including how well it plays, which is the same
    // record's fourth field — and its persisted side comes from ai.botTeams.
    // Older configs migrate behaviours from their global flags and teams to a
    // stable Red/Blue alternation. Count is clamped by `loadPregameConfig`; all
    // three slot arrays always have AI_COUNT_MAX entries.
    // Which loadout each unit built above is carrying, kept until the director
    // exists to be told. `getChampionPresetFromLoadout` is one-way — a bot on
    // 'random' has already become one particular champion by the time it is
    // constructed — so this is the only moment the mapping is knowable, and the
    // practice panel's editor needs it to open on a unit's real kit rather than
    // on a default (see `MatchDirector.loadoutOf`).
    const loadoutsInPlay: { unit: Champion; loadout: ChampionLoadout }[] = [
      { unit: this.player, loadout: pregameConfig.player },
    ];

    for (let i = 0; i < pregameConfig.ai.count; i++) {
      const botLoadout = pregameConfig.ai.bots[i];
      const botBehaviour = pregameConfig.ai.botBehaviours[i];
      const botTeam = pregameConfig.ai.botTeams[i];
      const bot = attachRecall(
        new AIChampion({
          game: this,
          position: this.randomSpawnPoint(botTeam),
          teamId: botTeam,
          preset: presetFromPlan(kits.bots[i] ?? planLoadout(botLoadout)),
          // Re-resolving the same loadout on every respawn is what makes a
          // bot configured with a fixed champion keep that identity across
          // deaths, while a bot left on 'random' keeps re-rolling exactly as
          // it always has (getChampionPresetFromLoadout falls through to
          // getChampionPresetRandom for 'random').
          presetFactory: () => getChampionPresetFromLoadout(botLoadout),
          autoMove: botBehaviour.autoMove,
          autoAttack: botBehaviour.autoAttack,
          autoCast: botBehaviour.autoCast,
          difficulty: botBehaviour.difficulty,
        })
      );
      this.objectManager.addObject(bot);
      loadoutsInPlay.push({ unit: bot, loadout: botLoadout });
    }

    // anything reading `isAllied` needs this.player, so these come after it.
    // The jungle is spawned only if the config wants one — the director is told
    // below, and skipping the spawn is not the same as spawning and then
    // clearing: the camps would be flushed into the world by the first
    // `ObjectManager.update()` and only swept by the second, i.e. one frame of
    // camps a player who switched the jungle off never asked to see.
    if (pregameConfig.world.jungle) this.spawnJungle();
    this.spawnTurrets(map.slots.structure, map.factions);
    // the spawner reads teams off the fountains, so it comes after them
    this.minionSpawner = new MinionSpawner(this);

    // Last: it reads the roster, the spawner and the rules, so all three have
    // to exist.
    this.director = new MatchDirector(this);
    // The director keeps the panel's view of the rules as percentages, and it
    // starts at "nobody has retuned this match". `matchRules` above came from
    // `pregameConfig.rules`, so without this a match booted at 40% CDR would
    // open the panel showing 0% — and the player's first nudge of the slider
    // would silently reset the match to whatever the slider was showing.
    // Re-derives the same numbers line 114 already wrote, so this changes no
    // behaviour; it only tells the director what the match started with.
    this.director.seedRules(pregameConfig.rules);
    for (const { unit, loadout } of loadoutsInPlay) this.director.seedLoadout(unit, loadout);
    // And the world the config asked for. `seed*` rather than the public
    // setters throughout: those persist, and a match *booting* has nothing to
    // save — it is being told what it already is. The jungle flag has to be
    // said out loud even so, because it starts on and the camps above were
    // skipped: a director that disagreed with the match would show a ticked box
    // over an empty jungle, and then write that lie over the player's setting.
    this.director.seedWorld(pregameConfig.world);
    // And the cheats, which persist now (see `CheatConfig` in
    // PregameConfig.ts). Last of the three seeds because it is the only one
    // that lands on units: `seedCheats` reads the roster to apply per-slot
    // invulnerability, and every bot above is already queued by this point —
    // `MatchDirector.bots()` counts `_objectToBeAdd`, so it does not need the
    // first `ObjectManager.update()` to have run.
    this.director.seedCheats(pregameConfig.cheats);
    // What the *next* match boots onto if the player never touches the
    // picker — see `MatchDirector.seedMapChoice`'s own doc comment for why
    // this is not just `this.activeMapId`: the config's own `mapId` may have
    // named a map nothing installs any more, in which case `GameScene`
    // already fell back to a different one for *this* match, and the panel
    // must not quietly overwrite the player's stored choice with that
    // fallback the moment any other setting changes.
    this.director.seedMapChoice(pregameConfig.mapId);

    this.camera.target = this.player.position;
    this.camera.position = this.player.position.copy();
  }

  /**
   * @param spawnSlots The active map's `slots.spawn` — one fountain per slot,
   *   on the slot's own `faction` rather than its position in the array. See
   *   `preset.ts`'s `fountainsFromSlots` for the faction -> `TeamId` bridge.
   * @param factions The active map's own `factions`, in declared order —
   *   `fountainsFromSlots`/`teamIdOfFaction` read position 0/1 as BLUE/RED.
   */
  spawnFountains(spawnSlots: SpawnSlot[], factions: ActiveMap['factions']) {
    for (const preset of fountainsFromSlots(spawnSlots, factions)) {
      const fountain = new Fountain({ game: this, preset });
      this.fountains.push(fountain);
      this.objectManager.addObject(fountain);
    }
  }

  /**
   * Walks `this.neutralSlots` (the active map's `slots.neutral`) and, for
   * each one, resolves the installed monster that fills its `role` and
   * spawns one body per `member` of it — a camp is a composition
   * (`MonsterDef.members`), not a repeat count. A slot no installed pack
   * fills is left empty rather than throwing — spec §6, `preset.ts`'s
   * `monsterFillingSlot` doc comment.
   *
   * Every body for one slot is built from `monsterBodyPreset`, whose `camp`
   * is the slot object itself — every member of the same camp ends up
   * holding the exact same `camp` reference, which is what
   * `Monster.alertCamp` matches on. Each body's starting `position` is then
   * placed at `slot.{x,y} + member.offset` — a Greater Wolf and its two
   * Wolves land where the pack's own layout says, not stacked on the slot's
   * centre; the camp point they idle at and leash back to is `camp`
   * (unaffected by the offset).
   */
  spawnJungle() {
    for (const slot of this.neutralSlots) {
      const monster = monsterFillingSlot(slot);
      if (!monster) continue;

      for (const member of monster.members) {
        const preset = monsterBodyPreset(monster, member, slot);
        const body = new Monster({ game: this, preset });
        body.position.set(slot.x + member.offset.x, slot.y + member.offset.y);
        this.monsters.push(body);
        this.objectManager.addObject(body);
      }
    }
  }

  /**
   * @param structureSlots The active map's `slots.structure` — one turret per
   *   slot, on the slot's own `faction`. Every entry's `kind` is `'turret'`
   *   already (`preset.ts`'s `turretsFromSlots` doc comment explains why this
   *   does not check), which is also the only structure kind `Turret` knows
   *   how to be.
   * @param factions The active map's own `factions`, in declared order — see
   *   `spawnFountains`'s matching parameter.
   */
  spawnTurrets(structureSlots: StructureSlot[], factions: ActiveMap['factions']) {
    for (const { x, y, teamId } of turretsFromSlots(structureSlots, factions)) {
      const turret = new Turret({ game: this, position: createVector(x, y), teamId });
      this.turrets.push(turret);
      this.objectManager.addObject(turret);
    }
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.onPauseChanged?.(true);
  }

  unpause() {
    if (!this.paused) return;
    this.paused = false;
    this.onPauseChanged?.(false);
  }

  fixedUpdate() {
    this.camera.update();
    this.worldMouse = this.camera.screenToWorld(mouseX, mouseY);
    // before objectManager.update(), so a minion released this frame is added
    // to the world in the same pass as everything else spawned this frame
    this.minionSpawner.update();
    // also before it: a route asked for last frame is in hand before the unit
    // that asked takes its next step. The pass is budgeted, so this is a few
    // hundred microseconds whatever the board looks like.
    this.navigation.update();
    this.objectManager.update();
    this.terrainMap.update();

    // Not through the minimap: a right click on the overlay would otherwise
    // walk the champion to whatever the map happens to be covering.
    if (
      mouseIsPressed &&
      mouseButton === RIGHT &&
      !hitTest({ x: mouseX, y: mouseY }, this.minimap.rect)
    ) {
      const target = issuePointerOrder(this.player, this.objectManager, this.worldMouse);
      // A move gets the existing green ground pulse. An attack already has the
      // red target ring drawn by Champion.drawAttackOrder, so stacking both
      // signals on an enemy body would say two different things at once.
      if (!target) {
        this.clickedPoint = { x: this.worldMouse.x, y: this.worldMouse.y, size: 40 };
      }
    }
    this.clickedPoint.size *= 0.9;

    // Before the spell input controller ticks: a charge held under a thumb must
    // have this frame's aim in hand before its `hold` runs, or the telegraph
    // trails the drag by a frame.
    this.touchControls.update();
    this.spellInputController.update(deltaTime);
  }

  update() {
    if (this.paused) return;
    this.matchTimeMs += Math.max(0, deltaTime);
    this.fixedUpdate();
  }

  /**
   * @param alpha How far into the current simulation step the renderer is,
   *   `[0, 1]` — `GameScene.draw` computes it from the clock the two loops keep
   *   apart. Defaults to `1` (the newest tick, no interpolation) so a bench that
   *   calls `draw()` bare is unchanged. Below 1 the camera and every object are
   *   drawn blended between the last two ticks; see `render/Interpolation.ts`.
   */
  draw(alpha = 1) {
    if (this.paused) return;
    background(30);

    // Substitute the interpolated camera around the *whole* body: the minimap
    // (below, outside makeDraw) paints the camera box and has to move with the
    // smooth world too. Restored before returning, so the next fixedUpdate reads
    // the true camera through screenToWorld.
    const interpolate = alpha < 1;
    if (interpolate) this.camera.applyRenderOrigin(alpha);

    this.camera.makeDraw(() => {
      this.terrainMap.draw();
      if (this.clickedPoint.size > 0) {
        push();
        noStroke();
        fill('green');
        ellipse(this.clickedPoint.x, this.clickedPoint.y, this.clickedPoint.size);
        pop();
      }
      this.player.spells.forEach(spell => {
        if (spell.willDrawPreview) spell.drawPreview?.();
      });
      this.objectManager.draw(alpha);
      // After the units, so the ring sits on top of the body it is marking, and
      // at game level rather than on the caster: see combat/ExecuteMarks.ts.
      drawExecuteMarks(this);
      drawNavDebug(this);
      // The rest of the debug layers (terrain, collision, vision, quadtree),
      // toggled in the Gian lận tab. Each checks its flag before iterating, so
      // this line costs a handful of property reads with everything off.
      drawDebugOverlay(this);
    });

    this.fogOfWar.draw();
    // After the fog, outside camera.makeDraw: both of these are screen space,
    // and an overlay you cannot see is not an overlay.
    this.minimap.draw();
    this.touchControls.draw();
    // Screen space for the same reason, and the last of the three: a fixed
    // HUD corner, not a world position the camera would pan or zoom under it.
    drawFpsOverlay(this, this.fpsMeter);

    // True camera back, for the next fixedUpdate's screenToWorld and the next
    // tick's lerp — which would otherwise start from a blended position.
    if (interpolate) this.camera.restoreRenderOrigin();
  }

  destroy() {
    // First, not last: the seam that keeps `setActiveLanes`'s "one
    // process-wide slot" guard (`lanes.ts`) from ever tripping on a real
    // match sequence. `GameScene.stopGame()` calls this unconditionally
    // before dropping its `Game` reference, so the *next* match's
    // constructor never installs its lanes over an unstopped one's — but a
    // throw from any of the three `.destroy()` calls below used to skip this
    // entirely, latching the guard for the rest of the process and making
    // every later match start throw out of `setActiveLanes`. Clearing the
    // lanes before anything that can throw means one bad teardown loses at
    // most its own cleanup, not every match after it.
    clearActiveLanes();
    this.fogOfWar.destroy();
    this.minimap.destroy();
    this.inGameHUD.destroy();
  }

  /**
   * Spawn and respawn point (AttackableUnit.respawn() calls this too). A lane
   * team returns at its own fountain; UUID/FFA callers retain the old random
   * fountain fallback instead of being forced onto either side.
   */
  randomSpawnPoint(teamId?: string) {
    const teamFountain = teamId
      ? this.fountains.find(fountain => fountain.teamId === teamId)
      : undefined;
    if (teamFountain) return teamFountain.randomPointInside();

    if (this.fountains.length > 0) {
      const fountain = this.fountains[Math.floor(random(this.fountains.length))];
      return fountain.randomPointInside();
    }

    return createVector(
      this.mapSize / 2 + random(-1000, 1000),
      this.mapSize / 2 + random(-1000, 1000)
    );
  }

  resize(w: number, h: number) {
    // First: both of the others derive from the camera's view of the world.
    this.camera.fitTo(w, h);
    this.fogOfWar.resize(w, h);
    this.minimap.resize(w, h);
    this.touchControls.resize(w, h);
  }

  // ------------------------------------------------------------ touch input

  /**
   * The fingers currently on the glass, straight from p5's `touches`.
   *
   * Called from all three of GameScene's touch handlers with the same list;
   * TouchControls works out for itself which of them are new, moved or gone.
   */
  syncTouches(points: readonly TouchPoint[]): void {
    // The spell picker pauses the game and covers the screen. Touches belong to
    // it while it is open, and a gesture that was running when it opened has to
    // end without casting rather than sit there half-aimed behind a modal.
    if (this.paused) {
      this.touchControls.releaseEverything();
      this.seenTouches.clear();
      this.minimapTouches.clear();
      return;
    }

    // The minimap gets first refusal, and only on a finger's *first* frame.
    // Deciding per frame instead would let a spell gesture dragged over the
    // minimap be stolen mid-aim; deciding once and remembering the claim for
    // the finger's whole life is what keeps the two systems from ever seeing
    // the same finger. A claimed finger is filtered out of the list the
    // controls are reconciled against, so as far as they are concerned it
    // never happened.
    const live = new Set<number>();
    const forwarded: TouchPoint[] = [];
    for (const point of points) {
      live.add(point.id);
      if (!this.seenTouches.has(point.id)) {
        this.seenTouches.add(point.id);
        if (this.pressMinimap(point)) this.minimapTouches.add(point.id);
      }
      if (!this.minimapTouches.has(point.id)) forwarded.push(point);
    }
    for (const id of this.seenTouches) {
      if (!live.has(id)) {
        this.seenTouches.delete(id);
        this.minimapTouches.delete(id);
      }
    }

    this.touchControls.syncPointers(forwarded);
  }

  /**
   * Route one press through the minimap. Returns true when the minimap took it
   * — i.e. when nothing else may see it.
   *
   * A dismissing tap (`'collapse'`) is handled here but *not* claimed: it
   * closes the expanded map and still reaches whatever it landed on.
   */
  private pressMinimap(point: { x: number; y: number }): boolean {
    switch (this.minimap.route(point)) {
      case 'expand':
        this.minimap.expanded = true;
        return true;
      case 'teleport': {
        // Read the destination before collapsing — the transform is
        // parameterised by the rect, and collapsing changes it.
        const target = this.minimap.worldAt(point);
        // `teleportTo` is the whole job: markDisplaced(), pathAgent.clear(),
        // and both position and destination. It does not check terrain and
        // does not need to — `TerrainMap.update()` pushes a body out of a wall
        // on the next tick.
        this.player.teleportTo(target.x, target.y);
        this.minimap.expanded = false;
        return true;
      }
      case 'collapse':
        this.minimap.expanded = false;
        return false;
      default:
        return false;
    }
  }

  /**
   * The mouse's half of the same routing. Left button only: the right button is
   * the move order, and `fixedUpdate` already refuses to issue one from inside
   * the minimap's rect.
   */
  mousePressed(): void {
    if (this.paused) return;
    if (mouseButton === RIGHT) return;
    this.pressMinimap({ x: mouseX, y: mouseY });
  }

  /** The on-screen toggle, and the handle Playwright drives. */
  setTouchControlsEnabled(enabled: boolean, remember = true): void {
    this.touchControls.setEnabled(enabled);
    this.touchUi = enabled;
    this.inGameHUD?.setTouchUi(enabled);
    if (remember) rememberTouchControlsPreference(enabled);
    this.applyTouchUiClass();
  }

  setRenderQuality(quality: RenderQuality): void {
    this.renderQuality = quality === 'low' || quality === 'high' ? quality : 'auto';
    setRenderQualityPreference(this.renderQuality);
  }

  setRenderFps(fps: RenderFps): void {
    this.renderFps = fps === 30 ? 30 : 60;
    frameRate(this.renderFps);
    setRenderFpsPreference(this.renderFps);
  }

  /**
   * One class on <body> switches the whole HUD between the two layouts.
   *
   * A mode flag rather than a viewport breakpoint, because the thing that has
   * to change is not how much room there is — it is whether the player has a
   * hover, a keyboard and a pixel-accurate pointer. A narrow desktop window has
   * all three and wants the desktop HUD; a wide tablet has none of them and
   * wants the touch one. It also keeps the two verifiable from one machine:
   * the same toggle that gives Playwright the controls gives it the HUD.
   */
  private applyTouchUiClass(): void {
    document.body?.classList.toggle('touch-ui', this.touchControls.enabled);
  }

  /**
   * Drive the champion from a held stick direction, or stop it when the thumb
   * lifts.
   *
   * `moveTo` rather than `orderMove`/`navigateTo` on purpose. A stick is a
   * steering input, not a destination: routing it would queue an A* search
   * sixty times a second toward a point that moves with the champion, and the
   * route would be fighting the thumb the whole way. `moveTo` *clears*
   * `pathAgent` on every call, so the first frame of stick input drops whatever
   * route was running and no route can start while it is held — which is
   * exactly the takeover this needs, for free.
   *
   * Walking into a wall is then the player's own doing and gets the player's
   * own consequence: `TerrainMap.pushOutOfWalls` already runs over every
   * champion each frame, so the champion slides along the wall instead of
   * pathing around it.
   */
  private steerPlayer(direction: JoystickVector | null): void {
    if (!direction) {
      this.player.stopMovement();
      return;
    }
    // A stick is an order in its own right, and drops a standing attack order
    // the way a move order does — otherwise the attack controller would be
    // re-planting its chase destination against the thumb every frame.
    this.player.basicAttack?.clear();
    this.lastFacing = { x: direction.x, y: direction.y };

    const lookAhead = Math.max(
      JOYSTICK_LOOKAHEAD_MIN,
      Math.max(1, this.player.moveSpeed) * JOYSTICK_LOOKAHEAD_FRAMES
    );
    this.player.moveTo(
      this.player.position.x + direction.x * lookAhead,
      this.player.position.y + direction.y * lookAhead
    );
  }

  /** Unit vector the champion is pointed along; never (0,0). */
  private facing(): Vec2 {
    const dx = this.player.destination.x - this.player.position.x;
    const dy = this.player.destination.y - this.player.position.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.01) return { x: dx / length, y: dy / length };
    return this.lastFacing;
  }

  private touchSpellView(slot: number): TouchSpellView | null {
    const spell = this.player.spells[slot];
    if (!spell?.image) return null;

    const hotKey = SpellHotKeys[slot];
    return this.touchViewOf(spell, hotKey ? String.fromCharCode(hotKey) : String(slot));
  }

  /**
   * The recall button's view.
   *
   * Through `touchViewOf` rather than a shape of its own, so the one button
   * that is not a kit slot still reports cooldown, castability and its channel
   * the way every other button does — `Recall` is a `Spell`, it is only not in
   * `spells[]`. Null for a unit that has no recall at all, which is how the
   * touch layer decides whether to draw the button.
   */
  private touchRecallView(): TouchSpellView | null {
    const spell = this.player?.recall;
    return spell ? this.touchViewOf(spell, String.fromCharCode(HotKeys.B)) : null;
  }

  private touchViewOf(spell: Spell, label: string): TouchSpellView {
    const spec = spell.castSpec;
    // `Recall` carries no icon asset, and `renderable` is not asked for one.
    const icon = spell.image ? AssetManager.renderable(spell.image) : null;
    return {
      targeting: spec.targeting,
      activation: spec.activation,
      range: touchAimRange(spell),
      label,
      // `renderable` hands back a data-URI string while the real icon is still
      // loading; the button draws its letter rather than a string as an image.
      icon: typeof icon === 'object' && icon !== null ? icon : null,
      cooldownRatio:
        spell.effectiveCoolDownMs > 0
          ? Math.min(1, Math.max(0, spell.currentCooldown / spell.effectiveCoolDownMs))
          : 0,
      onCooldown: spell.currentCooldown > 0 && spell.cooldownLocksOut !== false,
      // Whole seconds left, the same rounding the corner HUD uses for its own
      // cooldown stamp — so the two never disagree if they are ever visible
      // at once (the toggle mid-transition, a screenshot).
      remainingSeconds: Math.ceil(spell.currentCooldown / 1000),
      // `effectiveManaCost`, not the raw field: under URF this is 0, and a
      // button that greys itself out against a cost the cast path does not
      // charge would be lying about why it cannot be pressed.
      manaCost: spell.effectiveManaCost,
      affordable: this.player.stats.mana.value >= spell.effectiveManaCost,
      castable: this.player.canCast && !this.player.isDead && !spell.disabled,
      charging: spell.state === 'CHARGING',
      channeling: spell.state === 'CHANNELING',
      // `channelProgress` is `Recall`'s own; a spell without one is not
      // channelling anything a button would draw a clock for.
      channelProgress: (spell as Spell & { channelProgress?: number }).channelProgress ?? 0,
    };
  }

  /**
   * One dot per thing worth knowing about, rebuilt each frame.
   *
   * Visibility is read off `visibleToPlayerTeam`, never recomputed: `FogOfWar.
   * calculateSight()` already sets it every frame and `ObjectManager.draw`
   * already consumes it, so the minimap is a second reader of one answer. Like
   * both of those it is a *rendering* question — "what does the player see" —
   * which is why it may read this flag at all; see `AttackableUnit`.
   * Structures keep it true for good (turrets are `alwaysVisible`, and
   * a fountain is not an `AttackableUnit` at all, so the fog's per-frame reset
   * never touches either) — which is exactly the "static and always known"
   * the minimap wants, with no special case here.
   *
   * `director.revealMap` is the practice panel's cheat, and it is the only
   * thing here that can override the fog.
   */
  private minimapBlips(): MinimapBlip[] {
    const blips: MinimapBlip[] = [];
    const reveal = this.director.revealMap;
    for (const object of this.objectManager.objects) {
      // The player is drawn separately, always, in its own colour.
      if (object === this.player) continue;
      const unit = object as AttackableUnit & { isDead?: boolean };
      const isStructure = object instanceof Turret || object instanceof Fountain;
      if (!isStructure && !(object instanceof AttackableUnit)) continue;
      if (unit.isDead) continue;
      if (!isStructure && !reveal && !unit.visibleToPlayerTeam) continue;
      blips.push({
        x: object.position.x,
        y: object.position.y,
        kind: isStructure
          ? 'structure'
          : object instanceof Champion || object instanceof AIChampion
            ? 'champion'
            : 'unit',
        color: teamBodyColor(String(object.teamId)),
      });
    }
    return blips;
  }

  private minimapHost(): MinimapHost {
    return {
      viewport: () => ({ width: windowWidth, height: windowHeight }),
      mapSize: () => this.mapSize,
      wallPolygons: () => this.terrainMap.wallPolygons(),
      blips: () => this.minimapBlips(),
      playerPosition: () => this.player.position,
      cameraBox: () => this.camera.getBoundingBox(),
    };
  }

  private touchControlsHost(): TouchControlsHost {
    return {
      viewport: () => ({ width: windowWidth, height: windowHeight }),
      slotCount: () => this.player.spells.length,
      spellView: slot => this.touchSpellView(slot),
      recallView: () => this.touchRecallView(),
      // Straight to the seam the `B` key already uses. On a phone there is no
      // keyboard at all, so this button is the *only* way home.
      recall: () => this.recall(),
      playerPosition: () => this.player.position,
      playerFacing: () => this.facing(),
      // The same acquisition the `A` key already uses, only measured from the
      // champion instead of the cursor — there is no cursor. It is hostile,
      // alive, targetable and *visible*: a tap cannot auto-target through fog,
      // the same refusal a right click into the fog gets.
      autoTargetWithin: (range, priority) =>
        findAttackTargetNearPoint(
          this.player,
          this.player.position,
          range,
          priority
        ) as AimCandidate | null,
      pickUnitNear: (point, radius, preferred) =>
        findAttackTargetAlongRay(
          this.player,
          point,
          radius,
          preferred as AttackableUnit | null
        ) as AimCandidate | null,
      steer: direction => this.steerPlayer(direction),
      setSlotAim: (slot, world) => {
        if (world) this.touchAim.set(slot, world);
        else this.touchAim.delete(slot);
      },
      beginSlot: slot => {
        this.spellInputController.pointerDown(slot);
      },
      commitSlot: slot => {
        this.spellInputController.pointerUp(slot);
      },
      cancelSlot: slot => {
        this.spellInputController.pointerCancel(slot);
      },
      withWorldTransform: draw => {
        this.camera.push();
        draw();
        this.camera.pop();
      },
    };
  }

  createSpellContext(
    spell: Spell,
    caster: { readonly teamId?: unknown; readonly position: Vec2 },
    cursorWorld: Vec2
  ): CastContext | undefined {
    const result = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: uuidv4(),
      startedAtMs: Date.now(),
      caster,
      casterTeamId: caster.teamId,
      origin: caster.position,
      cursorWorld,
      queryCandidates: () => this.objectManager.objects,
      isTargetable: defaultIsTargetable,
      getTargetInfo: defaultTargetInfo,
      ...spell.targetingRequest,
    });
    return result.ok ? result.context : undefined;
  }

  /**
   * Escape, routed from `GameScene`. The HUD owns what it means — innermost
   * layer, then the practice panel — and this is the one line that gets the
   * key to it, since `GameScene` holds a `Game` and not a Vue app.
   */
  escape(): void {
    this.inGameHUD?.vueInstance?.hud.escape();
  }

  /**
   * The player stopped looking at the page — backgrounded the app, locked the
   * phone, switched tab, or let another window take focus. Routed from
   * `GameScene`, which owns the listeners.
   *
   * The match used to carry on without them: minions pushed, bots fought, and
   * the champion standing still died to whatever walked past. Coming back to a
   * match that moved on is the bug this closes.
   *
   * **It opens the panel rather than calling `pause()`.** The panel already
   * holds the match paused — `openSpellPicker` *is* `pause()` plus the screen
   * that says so and the button that undoes it — so a `pause()` here would be
   * a second, invisible paused state with no way out on screen. One entry
   * point, and it is the one the corner button and Escape already use.
   *
   * Refuses to do anything to a match that is already paused, for two reasons
   * that happen to want the same guard: re-opening would wipe
   * `editPlayerSlot`, closing a loadout the player had left open, and a match
   * paused for any other reason is not ours to touch.
   *
   * `pause()` is the fallback only for a match with no HUD mounted — a
   * headless bench — where stopping is still right and there is nothing to
   * show.
   */
  pauseForAway(): void {
    if (this.paused) return;
    const hud = this.inGameHUD?.vueInstance?.hud;
    if (hud) hud.openSpellPicker();
    else this.pause();
  }

  /**
   * B: channel home, or stop the channel that is already running.
   *
   * A method rather than four lines inside `keyPressed`, so a touch button has
   * a seam to call — the key is one way in, not the definition of the action.
   */
  recall(): void {
    const spell = this.player?.recall;
    if (!spell) return;

    // Pressing it again is how the player calls the trip off; without this the
    // press would be refused as "already casting" and the only way to stop
    // going home would be to walk.
    if (spell.state === 'CHANNELING') {
      spell.cancel('PLAYER_CANCEL');
      return;
    }

    // SELF targeting, so the aim is the champion's own feet.
    const context = this.createSpellContext(spell, this.player, this.player.position);
    if (context) spell.press(context);
  }

  keyPressed(keyCode: number, repeated = false) {
    if (keyCode === 32 && !repeated) {
      this.camera.target = this.camera.target ? null! : this.player.position;
    }
    // N: toggle the nav debug overlay (src/game/nav/NavDebugOverlay.ts) --
    // the clearance field, active routes and every agent's state. Not one of
    // SpellHotKeys' letters, so it never steals a cast.
    if (keyCode === 78 && !repeated) {
      // Through the director, not `navigation.debugRoutes` directly: the debug
      // layers persist now, and the director is the only thing that writes the
      // config. Writing the field would leave the key and the panel's checkbox
      // agreeing about the match (they are one boolean — see
      // `createDebugFlags`) while disagreeing about what gets saved.
      this.director?.setDebugFlag('routes', !this.navigation.debugRoutes);
    }
    // B: go home. Not one of SpellHotKeys' letters, so it never steals a cast.
    if (keyCode === HotKeys.B && !repeated) this.recall();
    this.spellInputController.keyDown(keyCode, repeated);
  }

  keyReleased(keyCode: number) {
    this.spellInputController.keyUp(keyCode);
  }
}
