import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeShaco_W_Bullet_Object } from './Shaco_W';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Shaco_E = InstanceType<ReturnType<typeof makeShaco_E>>;
type Shaco_E_Object = InstanceType<ReturnType<typeof makeShaco_E_Object>>;
type Shaco_W_Bullet_Object = InstanceType<ReturnType<typeof makeShaco_W_Bullet_Object>>;



export const RANGE = 250;

export const DAMAGE = 15;

export const EXECUTE_BONUS = 10;

export const EXECUTE_THRESHOLD = 0.3;


/** Radians of tumble per second. A thrown knife turns; it does not glide. */
export const SPIN_RATE = 0.022;

/** Venom beads clinging to the blade. Seeded once — see `_drips`. */
export const DRIP_COUNT = 3;


const STEEL_DARK: [number, number, number] = [52, 18, 66];

const HILT: [number, number, number] = [190, 44, 72];

const VENOM: [number, number, number] = [126, 214, 74];


function __buildShaco_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Shaco_E_Object = makeShaco_E_Object(api);
  class Shaco_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_shaco_e');
    name = 'Dao Độc (Shaco_E)';
    description =
      'Ném dao tới kẻ địch, <span class="buff">Làm Chậm 40%</span> và gây <span class="damage">15 sát thương</span>, gây thêm <span class="damage">10 sát thương</span> nếu mục tiêu <span>dưới 30% máu</span>';
    coolDown = 5000;
    manaCost = 40;

    range = RANGE;
    targetEnemy: any = null;

    checkCastCondition() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      if (!enemies.length) {
        this.targetEnemy = null;
        return false;
      }

      if (enemies.length === 1) {
        this.targetEnemy = enemies[0];
        return true;
      }

      // Find the closest enemy to the mouse
      let closestEnemy = enemies[0];
      let closestDistance = closestEnemy.position.dist(this.aimPoint);
      enemies.forEach((enemy: any) => {
        const distance = enemy.position.dist(this.aimPoint);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestEnemy = enemy;
        }
      });
      this.targetEnemy = closestEnemy;

      return true;
    }

    onSpellCast() {
      let damage = DAMAGE;
      const { health, maxHealth } = this.targetEnemy.stats;
      if (health < maxHealth * EXECUTE_THRESHOLD) {
        damage += EXECUTE_BONUS;
      }

      const obj = new Shaco_E_Object(this.owner);
      obj.targetEnemy = this.targetEnemy;
      obj.damage = damage;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Shaco_E;
}
const __cacheShaco_E = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_E>>();
export default function makeShaco_E(api: ContentApi) {
  const cached = __cacheShaco_E.get(api);
  if (cached) return cached;
  const built = __buildShaco_E(api);
  __cacheShaco_E.set(api, built);
  return built;
}


/**
 * The poisoned shiv.
 *
 * It inherits the box's homing bullet for its *movement* — same flight, same
 * hit test — and nothing else. It used to inherit the drawing as well, so the
 * thrown dagger rendered as one of the jack-in-the-box's laser lines: a
 * coloured stick, indistinguishable from Shaco's own W except in hue. A knife
 * that a player is meant to see coming has to look like a knife, so this one
 * tumbles end over end with venom coming off the edge.
 */
function __buildShaco_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const TrailSystem = api.helpers.TrailSystem;
  const Shaco_W_Bullet_Object = makeShaco_W_Bullet_Object(api);
  class Shaco_E_Object extends Shaco_W_Bullet_Object {
    position: p5.Vector = this.owner.position.copy();
    strokeColor: [number, number, number] = [...HILT];
    fillColor: [number, number, number] = [...VENOM];
    lazerWidth = 10;
    lazerLength = 35;
    speed = 7;

    _age = 0;
    /** Rolled once so every throw tumbles from a different starting attitude. */
    _spinOffset = 0;
    _spinDir = 1;
    /** Venom beads: {along the blade, own bob phase}. Fixed, animated by age. */
    _drips: { along: number; phase: number }[] = [];

    trailSystem = new TrailSystem({
      trailColor: 'rgba(126, 214, 74, 0.34)',
      trailSize: 7,
      maxLength: 14,
      trailLifeTime: 260,
    });

    onAdded() {
      super.onAdded();
      this._spinOffset = random(TWO_PI);
      this._spinDir = random() < 0.5 ? -1 : 1;
      for (let i = 0; i < DRIP_COUNT; i++) {
        this._drips.push({ along: random(-6, 13), phase: random(TWO_PI) });
      }
    }

    update() {
      this._age += deltaTime;
      super.update();
    }

    draw() {
      if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) this._drawBlade();
      else this._drawSplash();
    }

    /** The dagger itself, tumbling along its flight path. */
    _drawBlade() {
      const spin = this._spinOffset + this._spinDir * this._age * SPIN_RATE;
      const [sr, sg, sb] = STEEL_DARK;
      const [hr, hg, hb] = HILT;
      const [vr, vg, vb] = VENOM;

      push();
      translate(this.position.x, this.position.y);

      // sickly halo, so the shiv is visible against dark terrain and reads as
      // poisoned before it has landed
      noStroke();
      fill(vr, vg, vb, 45);
      circle(0, 0, 26 + sin(this._age / 90) * 3);

      rotate(spin);

      // pommel: a harlequin diamond, the one piece of Shaco on every item he owns
      fill(hr, hg, hb, 245);
      quad(-16, 0, -11, -5, -6, 0, -11, 5);

      // grip and crossguard
      stroke(sr, sg, sb, 250);
      strokeWeight(4);
      line(-11, 0, -2, 0);
      strokeWeight(3);
      line(-2, -7, -2, 7);

      // the blade: a long triangle with a venom-wetted edge
      noStroke();
      fill(sr, sg, sb, 250);
      triangle(-2, -5, -2, 5, 18, 0);
      fill(235, 225, 245, 240);
      triangle(-1, -3, -1, 1, 16, 0);
      fill(vr, vg, vb, 220);
      triangle(-1, 1, -1, 4, 16, 0);

      // beads of venom running off the edge on their own little clocks
      for (const drip of this._drips) {
        const bob = sin(this._age / 120 + drip.phase);
        fill(vr, vg, vb, 200 + 40 * bob);
        circle(drip.along, 3.5 + bob * 1.6, 3.4 + bob * 0.8);
      }
      pop();
    }

    /**
     * The landing. A knife going in is a puncture and a spreading stain, not the
     * expanding disc every other hit effect in this file uses.
     */
    _drawSplash() {
      const target = this.targetEnemy;
      if (!target) return;
      const t = constrain(this.timeSinceHit / this.hitEffectDuration, 0, 1);
      const fade = 1 - t;
      const size = target.stats?.size?.value ?? 40;
      const [hr, hg, hb] = HILT;
      const [vr, vg, vb] = VENOM;

      push();
      translate(target.position.x, target.position.y);

      // the venom soaking in
      noStroke();
      fill(vr, vg, vb, 130 * fade);
      circle(0, 0, size * (0.7 + 0.7 * t));
      noFill();
      stroke(vr, vg, vb, 220 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, size + 34 * t);

      // jagged harlequin splinters kicked off the hit — the same diamond as the
      // pommel, so the damage and the dagger are visibly the same spell
      noStroke();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TWO_PI + t * 1.1;
        const d = size * 0.35 + size * 0.5 * t;
        const s = 9 * fade + 2;
        push();
        translate(cos(a) * d, sin(a) * d);
        rotate(a);
        fill(hr, hg, hb, 235 * fade);
        quad(0, -s, s * 0.5, 0, 0, s, -s * 0.5, 0);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      // The splash paints on the *target*, which can be most of a blade-length
      // away from where this object last sat, so the box has to hold both.
      const target = this.targetEnemy;
      const reach = 60;
      let minX = this.position.x - reach;
      let minY = this.position.y - reach;
      let maxX = this.position.x + reach;
      let maxY = this.position.y + reach;
      if (target?.position) {
        minX = Math.min(minX, target.position.x - reach);
        minY = Math.min(minY, target.position.y - reach);
        maxX = Math.max(maxX, target.position.x + reach);
        maxY = Math.max(maxY, target.position.y + reach);
      }
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return Shaco_E_Object;
}
const __cacheShaco_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_E_Object>>();
export function makeShaco_E_Object(api: ContentApi) {
  const cached = __cacheShaco_E_Object.get(api);
  if (cached) return cached;
  const built = __buildShaco_E_Object(api);
  __cacheShaco_E_Object.set(api, built);
  return built;
}