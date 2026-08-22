import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Sett_E = InstanceType<ReturnType<typeof makeSett_E>>;
type Sett_E_Object = InstanceType<ReturnType<typeof makeSett_E_Object>>;



export const SETT_E_DAMAGE = 18;

export const SETT_E_BOX_LENGTH = 200;

export const SETT_E_BOX_WIDTH = 160;

export const SETT_E_STUN_MS = 700;

/** Breathing room left between his body and a hauled-in body. */
export const SETT_E_GRAB_GAP = 8;

export const SETT_E_SWEEP_MS = 280;


const HOT: [number, number, number] = [225, 112, 85];

const BLOOD: [number, number, number] = [183, 21, 64];


/** One victim, and where he was standing before Sett reeled him in. */
export interface SettGrab {
  unit: AttackableUnit;
  fromX: number;
  fromY: number;
  /** +1 in front of the cast direction, -1 behind him. */
  side: number;
}


/**
 * Two grab boxes, one in front and one behind, both hauled inward. The stun only
 * fires when both sides caught somebody — the crowds have to actually collide.
 */
function __buildSett_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const bodyRadiusOf = api.combat.Reach.bodyRadiusOf;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Stun = api.buffs.Stun;
  const Spell = api.Spell;
  const Sett_E_Object = makeSett_E_Object(api);
  class Sett_E extends Spell {
    image = api.asset('spell_sett_e');
    name = 'Song Thú Chưởng (Sett_E)';
    description =
      `Sett kẹp hai bên người: mọi kẻ địch trong hai ô ${SETT_E_BOX_LENGTH}x${SETT_E_BOX_WIDTH} ` +
      `trước và sau lưng nhận <span class="damage">${SETT_E_DAMAGE} sát thương</span> và bị lôi ` +
      `sát vào người hắn. Nếu bắt được cả hai phía, tất cả bị choáng ` +
      `${SETT_E_STUN_MS / 1000} giây.`;
    coolDown = 10_000;
    manaCost = 30;
    range = SETT_E_BOX_LENGTH;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.coolDown },
      };
    }

    onSpellCast(context: CastContext): void {
      const aim = this.firingDirection(context);
      const heading = Math.atan2(aim.y, aim.x);
      const along = Math.cos(heading);
      const across = Math.sin(heading);
      const origin = this.owner.position;

      // The boxes reach SETT_E_BOX_LENGTH along the axis, so their far corners sit
      // on the diagonal — that, not the length, is what the broad query must cover.
      const corner = Math.sqrt(
        SETT_E_BOX_LENGTH * SETT_E_BOX_LENGTH + (SETT_E_BOX_WIDTH / 2) * (SETT_E_BOX_WIDTH / 2)
      );
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: origin.x, y: origin.y, r: effectiveRange(corner, this.owner) }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const grabbed = new Set<AttackableUnit>();
      const grabs: SettGrab[] = [];
      let ahead = 0;
      let behind = 0;

      // A plain loop: Array.prototype.filter cannot narrow here.
      for (const victim of candidates) {
        if (grabbed.has(victim)) continue;
        const dx = victim.position.x - origin.x;
        const dy = victim.position.y - origin.y;
        const depth = dx * along + dy * across;
        const offset = -dx * across + dy * along;
        const pad = victim.collisionRadius;
        if (Math.abs(depth) > SETT_E_BOX_LENGTH + pad) continue;
        if (Math.abs(offset) > SETT_E_BOX_WIDTH / 2 + pad) continue;

        grabbed.add(victim);
        const side = depth >= 0 ? 1 : -1;
        if (side > 0) ahead += 1;
        else behind += 1;
        grabs.push({ unit: victim, fromX: victim.position.x, fromY: victim.position.y, side });

        victim.takeDamage(SETT_E_DAMAGE, this.owner);
        if (victim.isDead || victim.toRemove) continue;

        // Haul him in. The pull never pushes anyone out: a body already closer
        // than the landing ring simply stays where it is.
        const gap = bodyRadiusOf(this.owner) + bodyRadiusOf(victim) + SETT_E_GRAB_GAP;
        const away = Math.sqrt(dx * dx + dy * dy);
        if (away > gap) {
          const ux = away > 0.001 ? dx / away : along * side;
          const uy = away > 0.001 ? dy / away : across * side;
          victim.stopMovement();
          victim.markDisplaced();
          victim.teleportTo(origin.x + ux * gap, origin.y + uy * gap);
        }
      }

      const clash = ahead > 0 && behind > 0;
      if (clash) {
        for (const victim of grabbed) {
          if (victim.isDead || victim.toRemove) continue;
          victim.addBuff(new Stun(SETT_E_STUN_MS, this.owner, victim));
        }
      }

      const sweep = new Sett_E_Object(this.owner, heading, grabs, clash);
      this.game.objectManager.addObject(sweep);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Sett_E;
}
const __cacheSett_E = new WeakMap<ContentApi, ReturnType<typeof __buildSett_E>>();
export default function makeSett_E(api: ContentApi) {
  const cached = __cacheSett_E.get(api);
  if (cached) return cached;
  const built = __buildSett_E(api);
  __cacheSett_E.set(api, built);
  return built;
}


/**
 * Both grab boxes at their true dimensions, the arms closing from the far edges
 * toward his body, and one trail per victim pointing the way he was dragged. The
 * motion travels inward, because the pull does.
 */
function __buildSett_E_Object(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Sett_E_Object extends SpellObject {
    /**
     * Ground art, at `GROUND_Z_INDEX` rather than the ordinary
     * `SPELL_EFFECT_Z_INDEX` a `SpellObject` subclass resolves to by default:
     * the enemy has to be able to read which box he is standing in, which
     * means the box goes under him, not over him.
     */
    zIndex = GROUND_Z_INDEX;
    lifeTime = SETT_E_SWEEP_MS;
    age = 0;
    radius = SETT_E_BOX_LENGTH;

    private heading: number;
    private grabs: SettGrab[];
    private clash: boolean;

    constructor(owner: AttackableUnit, heading: number, grabs: SettGrab[], clash: boolean) {
      super(owner);
      this.heading = heading;
      this.grabs = grabs;
      this.clash = clash;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const closed = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      rectMode(CORNER);
      translate(this.position.x, this.position.y);

      // the two boxes, drawn at exactly the dimensions that grabbed
      push();
      rotate(this.heading);
      noFill();
      stroke(BLOOD[0], BLOOD[1], BLOOD[2], 210 * fade);
      strokeWeight(4);
      rect(0, -SETT_E_BOX_WIDTH / 2, SETT_E_BOX_LENGTH, SETT_E_BOX_WIDTH, 4);
      rect(-SETT_E_BOX_LENGTH, -SETT_E_BOX_WIDTH / 2, SETT_E_BOX_LENGTH, SETT_E_BOX_WIDTH, 4);

      // one fat slab per side, starting at the far edge and sliding home
      noStroke();
      for (let side = -1; side <= 1; side += 2) {
        const edge = SETT_E_BOX_LENGTH * side * (1 - closed);
        fill(HOT[0], HOT[1], HOT[2], 190 * fade);
        rect(side > 0 ? edge - 26 : edge, -SETT_E_BOX_WIDTH / 2, 26, SETT_E_BOX_WIDTH, 3);
      }
      pop();

      // every victim's trail points at him, because that is where he took them
      stroke(255, 214, 190, 220 * fade);
      strokeWeight(5);
      for (const grab of this.grabs) {
        const dx = grab.fromX - this.position.x;
        const dy = grab.fromY - this.position.y;
        line(dx, dy, dx * (1 - closed), dy * (1 - closed));
      }

      if (this.clash) {
        // one hard clap where the two crowds meet: on his body, on the victims
        const ring = 60 + 60 * closed;
        noFill();
        stroke(255, 244, 226, 240 * fade);
        strokeWeight(9 * fade + 2);
        circle(0, 0, ring * 2);
        noStroke();
        fill(HOT[0], HOT[1], HOT[2], 150 * fade);
        for (const grab of this.grabs) {
          const ux = grab.unit.position.x - this.position.x;
          const uy = grab.unit.position.y - this.position.y;
          rect(ux - 11, uy - 11, 22, 22, 3);
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SETT_E_BOX_LENGTH + 80) * 2);
    }
  }
  return Sett_E_Object;
}
const __cacheSett_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildSett_E_Object>>();
export function makeSett_E_Object(api: ContentApi) {
  const cached = __cacheSett_E_Object.get(api);
  if (cached) return cached;
  const built = __buildSett_E_Object(api);
  __cacheSett_E_Object.set(api, built);
  return built;
}