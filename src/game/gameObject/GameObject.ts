import { Circle, Line, Rectangle } from '../../libs/quadtree';
import { uuidv4 } from '../../utils/index';
import type { CastContext, Vec2 } from '../spell/runtime/types';
import type EventManager from '../../managers/EventManager';
import type Spell from './Spell';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type ObjectManager from '../managers/ObjectManager';
import type NavigationSystem from '../nav/NavigationSystem';

export interface GameObjectGameContext {
  objectManager: Pick<ObjectManager, 'queryObjects'> & Partial<Pick<ObjectManager, 'addObject'>>;
}

export interface GameObjectRuntimeContext extends GameObjectGameContext {
  readonly mapSize: number;
  camera: { getBoundingBox(): Rectangle };
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
  randomSpawnPoint(): p5.Vector;
  createSpellContext(spell: Spell, caster: AttackableUnit, cursorWorld: Vec2): CastContext | undefined;
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
  willDraw = true;

  /**
   * Draw order override. `null` falls back to the class table in ObjectManager,
   * which cannot list every subclass without importing it (and half of them
   * import ObjectManager back). Lower paints first.
   */
  zIndex: number | null = null;

  /**
   * Structures stay on screen once discovered, so FogOfWar must not clear their
   * `willDraw` the way it does for units.
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

  private _displayBB: Rectangle | null = null;
  private _displayBBX = NaN;
  private _displayBBY = NaN;
  private _displayBBRadius = NaN;

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

  getDisplayBoundingBox() {
    if (
      this._displayBB &&
      this._displayBBX === this.position.x &&
      this._displayBBY === this.position.y &&
      this._displayBBRadius === this.visionRadius
    ) {
      return this._displayBB;
    }
    this._displayBBX = this.position.x;
    this._displayBBY = this.position.y;
    this._displayBBRadius = this.visionRadius;
    this._displayBB = new Rectangle({
      x: this.position.x - this.visionRadius,
      y: this.position.y - this.visionRadius,
      w: this.visionRadius * 2,
      h: this.visionRadius * 2,
      data: this,
    });
    return this._displayBB;
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
