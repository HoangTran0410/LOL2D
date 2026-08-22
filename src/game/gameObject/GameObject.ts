import { Circle, Line, Rectangle } from '@/libs/quadtree';
import { uuidv4 } from '@/utils/index';
import type { CastContext, Vec2 } from '@/game/spell/runtime/types';
import type EventManager from '@/managers/EventManager';
import type Spell from './Spell';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type ObjectManager from '@/game/managers/ObjectManager';
import type NavigationSystem from '@/game/nav/NavigationSystem';

export interface GameObjectGameContext {
  objectManager: Pick<ObjectManager, 'queryObjects'> & Partial<Pick<ObjectManager, 'addObject'>>;
}

export interface GameObjectRuntimeContext extends GameObjectGameContext {
  readonly mapSize: number;
  /**
   * `constantSize` is optional because a headless test context — and every
   * spell test in `tests/game/spells/` — builds a camera that only answers
   * `getBoundingBox`. Overlay code calls it as `constantSize?.(1) ?? 1`.
   */
  camera: { getBoundingBox(): Rectangle; constantSize?(px: number): number };
  objectManager: ObjectManager;
  player: AttackableUnit;
  eventManager: EventManager;
  /**
   * Terrain routing. Optional because a unit must still work in a context that
   * has no map at all — the spell suites build one of those by the hundred —
   * and because `AttackableUnit.navigateTo` degrades to a straight-line
   * `moveTo` without it, which is exactly what the game did before.
   */
  navigation?: NavigationSystem;
  worldMouse?: p5.Vector;
  /**
   * Milliseconds of unpaused match — `Game.matchTimeMs`, the one clock every
   * bot brain reads. Optional because a headless context has no clock of its
   * own, so read it as `?? 0` rather than asserting it away.
   */
  matchTimeMs?: number;
  randomSpawnPoint(teamId?: string): p5.Vector;
  createSpellContext(
    spell: Spell,
    caster: AttackableUnit,
    cursorWorld: Vec2
  ): CastContext | undefined;
}

export interface GameObjectOptions {
  game?: GameObjectGameContext;
  position?: p5.Vector;
  collisionRadius?: number;
  visionRadius?: number;
  teamId?: string;
  id?: string;
}

export default class GameObject {
  toRemove = false;

  /**
   * Draw order override. `null` falls back to the class table in ObjectManager,
   * which cannot list every subclass without importing it (and half of them
   * import ObjectManager back). Lower paints first.
   */
  zIndex: number | null = null;

  /**
   * Structures stay on screen once discovered, so FogOfWar must not clear their
   * `visibleToPlayerTeam` the way it does for units.
   */
  alwaysVisible = false;

  game?: GameObjectGameContext;
  position: p5.Vector;
  collisionRadius: number;
  visionRadius: number;
  teamId: string;
  id: string;
  direction: p5.Vector;

  /**
   * Where this object sat at the *start* of the current simulation tick.
   * `ObjectManager.draw` blends between this and `position` at the fraction of a
   * step that has elapsed, so a body drawn between two ticks moves smoothly
   * instead of snapping to whichever tick the frame happened to catch — see
   * `render/Interpolation.ts` for the why.
   *
   * Two plain numbers, not a vector: every object carries a pair and the draw
   * pass reads them every frame, so a `createVector` here would be an allocation
   * per object per tick for a value nothing outside rendering ever sees. Named
   * `renderOrigin*` rather than `previous*` because two of this pack's own
   * spell classes already declare `private previousX/Y` and the collision would be a TS2415
   * `typecheck:core` catches and nothing else.
   */
  renderOriginX: number;
  renderOriginY: number;

  /**
   * Bounding boxes are recomputed once per object per frame (plus once per
   * candidate in every spell targeting query), so a fresh allocation on every
   * call adds up fast. `position` is a p5.Vector mutated directly all over
   * the codebase (no setter to hook), so instead of an explicit invalidation
   * call — like Obstacle/ParticleSystem/TrailSystem use for their own
   * `_cachedBB` — we memoize by comparing the inputs that produced the box.
   */
  private _collideBB: Rectangle | null = null;
  private _collideBBX = NaN;
  private _collideBBY = NaN;
  private _collideBBRadius = NaN;

  protected _displayBB: Rectangle | null = null;
  protected _displayBBX = NaN;
  protected _displayBBY = NaN;
  protected _displayBBSize = NaN;

  constructor({
    game,
    position,
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }: GameObjectOptions = {}) {
    this.game = game;
    this.position = position ?? createVector();
    this.collisionRadius = collisionRadius;
    this.visionRadius = visionRadius;
    this.teamId = teamId;
    this.id = id;
    this.direction = createVector(0, 0);
    // Start the origin on the object itself, so an object created mid-tick draws
    // at its spawn point rather than sliding in from wherever the field began.
    // Tolerant of a missing position the way the rest of this constructor is: a
    // real object always has one (createVector never returns undefined under
    // p5), but a test may leave the global unstubbed, and constructing a
    // GameObject never read `position` before this line.
    this.renderOriginX = this.position ? this.position.x : 0;
    this.renderOriginY = this.position ? this.position.y : 0;
  }

  onAdded() {}
  onRemoved() {}

  update() {}
  draw() {}

  setTeamId(teamId: string) {
    this.teamId = teamId;
  }

  teleportTo(x: number, y: number) {
    this.position.set(x, y);
    this.snapRenderOrigin();
  }

  /**
   * Collapse the render origin onto the current position, so the next drawn
   * frame does not blend across a jump. Every instantaneous reposition —
   * `teleportTo`, a respawn — calls this; `isContinuousStep`'s 150px net in the
   * draw pass is the backstop for the reposition nobody remembered.
   */
  snapRenderOrigin() {
    this.renderOriginX = this.position.x;
    this.renderOriginY = this.position.y;
  }

  getCollideBoundingBox(): Circle | Line | Rectangle {
    if (
      this._collideBB &&
      this._collideBBX === this.position.x &&
      this._collideBBY === this.position.y &&
      this._collideBBRadius === this.collisionRadius
    ) {
      return this._collideBB;
    }
    this._collideBBX = this.position.x;
    this._collideBBY = this.position.y;
    this._collideBBRadius = this.collisionRadius;
    this._collideBB = new Rectangle({
      x: this.position.x - this.collisionRadius,
      y: this.position.y - this.collisionRadius,
      w: this.collisionRadius * 2,
      h: this.collisionRadius * 2,
      data: this,
    });
    return this._collideBB;
  }

  /**
   * A memoised square display box of `size`, centred on this object.
   *
   * Almost every display box in the game is this shape — only the size rule
   * differs (vision radius here, animated body size for a unit, a multiple of
   * it for minions and turrets, reach for a swing). Subclasses that override
   * `getDisplayBoundingBox` used to hand-roll the `new Rectangle`, which
   * silently opted them out of the cache above and put an allocation per
   * object per call back on the hot path — and the box is asked for at least
   * three times a frame each (quadtree rebuild, draw cull, every targeting
   * candidate). Override the *size*, not the caching.
   *
   * Keyed on the resolved size, so a rule that switches which size applies
   * moves the key with it.
   */
  protected squareDisplayBoundingBox(size: number): Rectangle {
    if (
      this._displayBB &&
      this._displayBBX === this.position.x &&
      this._displayBBY === this.position.y &&
      this._displayBBSize === size
    ) {
      return this._displayBB;
    }
    this._displayBBX = this.position.x;
    this._displayBBY = this.position.y;
    this._displayBBSize = size;
    this._displayBB = new Rectangle({
      x: this.position.x - size / 2,
      y: this.position.y - size / 2,
      w: size,
      h: size,
      data: this,
    });
    return this._displayBB;
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(this.visionRadius * 2);
  }

  drawBoundingBox(collide = false) {
    let bb = collide ? this.getCollideBoundingBox() : this.getDisplayBoundingBox();
    if (!bb) return;
    push();
    stroke(255, 255, 0, 200);
    strokeWeight(2);
    noFill();
    if (bb instanceof Rectangle) {
      rect(bb.x, bb.y, bb.w, bb.h);
    }
    if (bb instanceof Circle) {
      ellipse(bb.x, bb.y, bb.r * 2, bb.r * 2);
    }
    if (bb instanceof Line) {
      line(bb.x1, bb.y1, bb.x2, bb.y2);
    }
    pop();
  }
}
