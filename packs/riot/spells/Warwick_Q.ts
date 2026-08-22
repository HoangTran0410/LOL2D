import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Warwick_Q = InstanceType<ReturnType<typeof makeWarwick_Q>>;
type Warwick_Q_Object = InstanceType<ReturnType<typeof makeWarwick_Q_Object>>;



function __buildWarwick_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Warwick_Q_Object = makeWarwick_Q_Object(api);
  class Warwick_Q extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_warwick_q');
    name = 'Cắn Xé (Warwick_Q)';
    description =
      'Vồ tới kẻ địch gần nhất trong phạm vi, cắn xé gây <span class="damage">30 sát thương</span> và <span class="buff">Hồi 15 máu</span> cho bản thân';
    coolDown = 7000;
    manaCost = 30;

    range = 350;
    damage = 30;
    healAmount = 15;

    findNearestEnemy(): any {
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

      let nearestEnemy: any = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(this.owner.position);
        if (distance < nearestDistance) {
          nearestEnemy = enemy;
          nearestDistance = distance;
        }
      }
      return nearestEnemy;
    }

    checkCastCondition() {
      return Dash.CanDash(this.owner) && !!this.findNearestEnemy();
    }

    onSpellCast() {
      const target = this.findNearestEnemy();
      if (!target) return;

      const dashBuff = new Dash(3000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = target.position; // live ref: the pounce tracks its prey
      dashBuff.dashSpeed = 13;
      dashBuff.onReachedDestination = () => {
        if (!target.isDead) target.takeDamage(this.damage, this.owner);
        this.owner.takeHeal(this.healAmount, this.owner);

        const obj = new Warwick_Q_Object(this.owner);
        obj.position = target.position.copy();
        // the bite faces the way Warwick came in, so the pounce has a direction
        obj.angle = Math.atan2(
          target.position.y - this.owner.position.y,
          target.position.x - this.owner.position.x
        );
        obj.healed = this.healAmount;
        this.game.objectManager.addObject(obj);
      };
      this.owner.addBuff(dashBuff);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Warwick_Q;
}
const __cacheWarwick_Q = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_Q>>();
export default function makeWarwick_Q(api: ContentApi) {
  const cached = __cacheWarwick_Q.get(api);
  if (cached) return cached;
  const built = __buildWarwick_Q(api);
  __cacheWarwick_Q.set(api, built);
  return built;
}


interface BloodDrop {
  angle: number;
  speed: number;
  size: number;
}


/** The bite: three slashes torn out of the victim, and the life they cost. */
function __buildWarwick_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Warwick_Q_Object extends SpellObject {
    position = this.owner.position.copy();
    age = 0;
    lifeTime = 520;
    size = 96;
    angle = random(TWO_PI);
    /** Cosmetic: how much Warwick drained, drawn as a thread back to him. */
    healed = 0;

    _blood: BloodDrop[] = [];

    onAdded() {
      for (let i = 0; i < 12; i++) {
        this._blood.push({
          angle: this.angle + PI + random(-1.1, 1.1),
          speed: random(60, 170),
          size: random(4, 10),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // the claws rake open fast, then linger and fade
      const rake = constrain(t / 0.35, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // spray thrown back off the wound
      noStroke();
      for (const d of this._blood) {
        const dist = 10 + d.speed * t;
        fill(160, 20, 25, 220 * fade);
        circle(cos(d.angle) * dist, sin(d.angle) * dist, d.size * (1 - t * 0.5));
      }

      push();
      rotate(this.angle);

      // three claw gashes raked across the victim, perpendicular to the pounce.
      // Cut dark first, then red, then a white edge, so they read on any avatar.
      noFill();
      for (const [col, weight] of [
        [[55, 0, 5, 240 * fade], 13],
        [[240, 40, 40, 250 * fade], 7],
        [[255, 225, 215, 235 * fade], 2.5],
      ] as [number[], number][]) {
        (stroke as any)(...col);
        strokeWeight(weight);
        for (let i = -1; i <= 1; i++) {
          const length = this.size * (0.9 - Math.abs(i) * 0.18) * rake;
          beginShape();
          for (let k = 0; k <= 8; k++) {
            const u = k / 8;
            // a shallow bow, so each gash curves the way a claw drags
            const bow = (0.25 - (u - 0.5) * (u - 0.5)) * 4 * 13;
            vertex(i * 21 + bow, lerp(-length / 2, length / 2, u));
          }
          endShape();
        }
      }

      // the fangs closing, only at the very start
      const bite = 1 - constrain(t / 0.22, 0, 1);
      if (bite > 0) {
        stroke(255, 245, 240, 250 * bite);
        strokeWeight(5);
        const gap = 26 * bite + 6;
        for (let i = -1; i <= 1; i += 2) {
          line(-18, i * gap, 14, (i * gap) / 3);
        }
        noStroke();
        fill(255, 235, 235, 200 * bite);
        circle(0, 0, 40 * bite + 10);
      }
      pop();
      pop();

      // the life he tore out, drifting back to Warwick
      if (this.healed > 0 && this.owner && !this.owner.isDead) {
        const ox = this.owner.position.x;
        const oy = this.owner.position.y;
        push();
        noStroke();
        for (let i = 0; i < 5; i++) {
          const k = constrain(t * 1.4 - i * 0.1, 0, 1);
          const x = lerp(this.position.x, ox, k) + sin(k * 8 + i) * 12;
          const y = lerp(this.position.y, oy, k) + cos(k * 8 + i) * 12;
          fill(30, 90, 30, 200 * (1 - k) * fade);
          circle(x, y, 16 * (1 - k * 0.4));
          fill(140, 250, 140, 240 * (1 - k) * fade);
          circle(x, y, 11 * (1 - k * 0.4));
        }
        // a pulse of health landing on him
        noFill();
        stroke(120, 245, 120, 220 * fade);
        strokeWeight(4);
        circle(ox, oy, (this.owner.animatedValues?.displaySize ?? 40) + 14 + t * 22);
        pop();
      }
    }

    // the drain thread reaches all the way back to the caster
    getDisplayBoundingBox() {
      const pad = this.size;
      const ox = this.owner?.position?.x ?? this.position.x;
      const oy = this.owner?.position?.y ?? this.position.y;
      return new Rectangle({
        x: Math.min(this.position.x, ox) - pad,
        y: Math.min(this.position.y, oy) - pad,
        w: Math.abs(this.position.x - ox) + pad * 2,
        h: Math.abs(this.position.y - oy) + pad * 2,
        data: this,
      });
    }
  }
  return Warwick_Q_Object;
}
const __cacheWarwick_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_Q_Object>>();
export function makeWarwick_Q_Object(api: ContentApi) {
  const cached = __cacheWarwick_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildWarwick_Q_Object(api);
  __cacheWarwick_Q_Object.set(api, built);
  return built;
}