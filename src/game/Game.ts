import { SpellHotKeys } from './constants';
import AttackableUnit from './gameObject/attackableUnits/AttackableUnit';
import Champion from './gameObject/attackableUnits/Champion';
import AIChampion from './gameObject/attackableUnits/AIChampion';
import Monster from './gameObject/attackableUnits/Monster';
import Camera, { zoomFactorPreference } from './gameObject/map/Camera';
import FogOfWar from './gameObject/map/FogOfWar';
import TerrainMap from './gameObject/map/TerrainMap';
import Fountain from './gameObject/structures/Fountain';
import Turret from './gameObject/structures/Turret';
import InGameHUD from './hud/InGameHUD';
import {
  FountainPreset,
  MonsterPreset,
  getChampionPresetFromLoadout,
  getTurretPositions,
} from './preset';
import {
  loadPregameConfig,
  toMatchRules,
  type ChampionLoadout,
  type MatchRules,
} from './config/PregameConfig';
import ObjectManager from './managers/ObjectManager';
import MinionSpawner from './managers/MinionSpawner';
import MatchDirector from './MatchDirector';
import NavigationSystem from './nav/NavigationSystem';
import { drawNavDebug } from './nav/NavDebugOverlay';
import EventManager from '../managers/EventManager';
import { uuidv4 } from '../utils';
import SpellInputController from './spell/input/SpellInputController';
import TargetResolver, {
  defaultIsTargetable,
  defaultTargetInfo,
} from './spell/targeting/TargetResolver';
import AssetManager from '../managers/AssetManager';
import { findAttackTargetNearPoint } from './combat/AttackTargeting';
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

export default class Game {
  readonly mapSize = 6400;
  readonly fps = 60;

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

  /**
   * Cooldown reduction and URF, resolved from the pregame config at
   * construction. `Spell.ts` reads this off `owner.game.matchRules` — see
   * `Spell.applyMatchRules` — rather than this class pushing the numbers into
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
  /** Last direction the champion was driven, for aiming a tap with no target. */
  private lastFacing = { x: 1, y: 0 };

  fountains: Fountain[] = [];
  turrets: Turret[] = [];
  monsters: Monster[] = [];

  clickedPoint = { x: 0, y: 0, size: 0 };
  worldMouse!: p5.Vector;
  paused = false;

  constructor() {
    // Read once, before anything that might construct a Champion or a Spell:
    // `matchRules` has to be in place the moment the player's own kit is
    // built a few lines down. Validated/defaulted by `loadPregameConfig`
    // itself, so a corrupt or missing stored blob never reaches this
    // constructor as anything other than a playable config.
    const pregameConfig = loadPregameConfig();
    this.matchRules = toMatchRules(pregameConfig.rules);

    this.worldMouse = createVector(0, 0);
    this.camera = new Camera();
    // Before anything reads a world position from the screen. `width`/`height`
    // are valid here: `Game` is constructed from `GameScene.enter()`, after
    // `createCanvas`.
    this.camera.setZoomFactor(zoomFactorPreference());
    this.camera.fitTo(width, height);
    // A match that boots and is never resized must not sit at the constructed
    // 0.5 default, and the opening lerp from it would now zoom a phone *out*.
    this.camera.snapToScale();
    this.objectManager = new ObjectManager(this);
    this.eventManager = new EventManager();
    this.terrainMap = new TerrainMap(this, this.mapSize);
    // The map is static, so every unit's routing is derived from the wall layer
    // once here — about 7ms and 1.6MB for the whole game — rather than per unit
    // per frame. Built off the same Obstacle list the collision push-out uses,
    // so there is one source of truth for where the walls are.
    this.navigation = new NavigationSystem(this.terrainMap.wallPolygons(), this.mapSize);
    this.fogOfWar = new FogOfWar(this);
    this.inGameHUD = new InGameHUD(this);

    // fountains first: randomSpawnPoint() is defined in terms of them, and both
    // the player and every AI champion are placed with it
    this.spawnFountains();

    this.player = new Champion({
      game: this,
      position: this.randomSpawnPoint(),
      preset: getChampionPresetFromLoadout(pregameConfig.player),
    });
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

    this.touchControls = new TouchControls(this.touchControlsHost(), touchControlsPreference());
    this.applyTouchUiClass();

    // Each bot's champion/kit comes from its own slot in ai.bots — 'random'
    // by default (today's behaviour, unchanged), or a specific loadout the
    // player configured for that bot. Behaviour flags (autoMove/autoAttack/
    // autoCast) stay global across every bot, same as before per-bot config
    // existed. Count clamped to [AI_COUNT_MIN, AI_COUNT_MAX] by
    // `loadPregameConfig`; `ai.bots` always has AI_COUNT_MAX entries.
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
      const bot = new AIChampion({
        game: this,
        position: this.randomSpawnPoint(),
        preset: getChampionPresetFromLoadout(botLoadout),
        // Re-resolving the same loadout on every respawn is what makes a
        // bot configured with a fixed champion keep that identity across
        // deaths, while a bot left on 'random' keeps re-rolling exactly as
        // it always has (getChampionPresetFromLoadout falls through to
        // getChampionPresetRandom for 'random').
        presetFactory: () => getChampionPresetFromLoadout(botLoadout),
        autoMove: pregameConfig.ai.autoMove,
        autoAttack: pregameConfig.ai.autoAttack,
        autoCast: pregameConfig.ai.autoCast,
      });
      this.objectManager.addObject(bot);
      loadoutsInPlay.push({ unit: bot, loadout: botLoadout });
    }

    // anything reading `isAllied` needs this.player, so these come after it
    this.spawnJungle();
    this.spawnTurrets();
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
    this.director.setRules(pregameConfig.rules);
    for (const { unit, loadout } of loadoutsInPlay) this.director.seedLoadout(unit, loadout);

    this.camera.target = this.player.position;
    this.camera.position = this.player.position.copy();
  }

  spawnFountains() {
    for (const preset of FountainPreset) {
      const fountain = new Fountain({ game: this, preset });
      this.fountains.push(fountain);
      this.objectManager.addObject(fountain);
    }
  }

  spawnJungle() {
    for (const key in MonsterPreset) {
      const monster = new Monster({ game: this, preset: MonsterPreset[key] });
      this.monsters.push(monster);
      this.objectManager.addObject(monster);
    }
  }

  spawnTurrets() {
    for (const { x, y, teamId } of getTurretPositions()) {
      const turret = new Turret({ game: this, position: createVector(x, y), teamId });
      this.turrets.push(turret);
      this.objectManager.addObject(turret);
    }
  }

  pause() { this.paused = true; }
  unpause() { this.paused = false; }

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

    if (mouseIsPressed && mouseButton === RIGHT) {
      // Right click means one thing only: move here. It used to also issue an
      // attack order when the cursor happened to be over an enemy body, which
      // made a walk past a fight silently turn into a commitment to it — the
      // click that was meant to retreat instead planted the champion in range.
      // Attacking now has its own key (slot 0, `A`), which picks the enemy
      // nearest the cursor rather than the one under it, so the two orders can
      // no longer be confused with each other.
      this.player.orderMove(this.worldMouse.x, this.worldMouse.y, true);
      this.clickedPoint = { x: this.worldMouse.x, y: this.worldMouse.y, size: 40 };
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
    this.fixedUpdate();
  }

  draw() {
    if (this.paused) return;
    background(30);

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
      this.objectManager.draw();
      drawNavDebug(this);
    });

    this.fogOfWar.draw();
    // After the fog: controls you cannot see are not controls.
    this.touchControls.draw();
  }

  destroy() {
    this.fogOfWar.destroy();
    this.inGameHUD.destroy();
  }

  /**
   * Spawn and respawn point (AttackableUnit.respawn() calls this too). Picking a
   * fountain rather than scattering everyone around the map centre is what makes
   * the platforms worth having: you come back on one and heal up before leaving.
   */
  randomSpawnPoint() {
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
      return;
    }
    this.touchControls.syncPointers(points);
  }

  /** The on-screen toggle, and the handle Playwright drives. */
  setTouchControlsEnabled(enabled: boolean, remember = true): void {
    this.touchControls.setEnabled(enabled);
    if (remember) rememberTouchControlsPreference(enabled);
    this.applyTouchUiClass();
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

    const spec = spell.castSpec;
    const icon = AssetManager.renderable(spell.image);
    const hotKey = SpellHotKeys[slot];
    return {
      targeting: spec.targeting,
      activation: spec.activation,
      range: touchAimRange(spell),
      label: hotKey ? String.fromCharCode(hotKey) : String(slot),
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
    };
  }

  private touchControlsHost(): TouchControlsHost {
    return {
      viewport: () => ({ width: windowWidth, height: windowHeight }),
      slotCount: () => this.player.spells.length,
      spellView: slot => this.touchSpellView(slot),
      playerPosition: () => this.player.position,
      playerFacing: () => this.facing(),
      // The same acquisition the `A` key already uses, only measured from the
      // champion instead of the cursor — there is no cursor. It is hostile,
      // alive, targetable and *visible*: a tap cannot auto-target through fog,
      // the same refusal a right click into the fog gets.
      autoTargetWithin: range =>
        findAttackTargetNearPoint(this.player, this.player.position, range) as AimCandidate | null,
      pickUnitNear: (point, radius) =>
        findAttackTargetNearPoint(this.player, point, radius) as AimCandidate | null,
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

  keyPressed(keyCode: number, repeated = false) {
    if (keyCode === 32 && !repeated) {
      this.camera.target = this.camera.target ? null! : this.player.position;
    }
    // N: toggle the nav debug overlay (src/game/nav/NavDebugOverlay.ts) --
    // the clearance field, active routes and every agent's state. Not one of
    // SpellHotKeys' letters, so it never steals a cast.
    if (keyCode === 78 && !repeated) {
      this.navigation.debugRoutes = !this.navigation.debugRoutes;
    }
    this.spellInputController.keyDown(keyCode, repeated);
  }

  keyReleased(keyCode: number) {
    this.spellInputController.keyUp(keyCode);
  }
}
