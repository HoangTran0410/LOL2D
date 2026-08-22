import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Olaf_E = InstanceType<ReturnType<typeof makeOlaf_E>>;
type Olaf_E_Swing = InstanceType<ReturnType<typeof makeOlaf_E_Swing>>;



export const RANGE = 170;

// A third of a LOL2D champion's ~100 health pool: the ceiling of the 15-35 band
// a basic ability gets here, rather than the 40 carried over from the wiki.
export const DAMAGE = 33;

export const HEALTH_COST = 8;


/**
 * Reckless Swing: the biggest single hit in the game for its cooldown, and it
 * costs Olaf health rather than mana — the reason to keep W up.
 */
function __buildOlaf_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Olaf_E_Swing = makeOlaf_E_Swing(api);
  class Olaf_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_olaf_e');
    name = 'Bổ Củi (Olaf_E)';
    description =
      `Bổ rìu vào kẻ địch gần nhất trong <span>${RANGE}px</span>: <span class="damage">${DAMAGE} sát thương</span>,` +
      ` đổi lại Olaf <span class="damage">tự mất ${HEALTH_COST} máu</span>`;
    coolDown = 5000;
    manaCost = 0;

    range = RANGE;

    checkCastCondition() {
      // Never lethal to its own caster: a cost is a cost, not a suicide button.
      return !!this._findTarget() && this.owner.stats.health.value > HEALTH_COST;
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      // The health is spent on the commitment, not on the connection — he has
      // already thrown himself into the swing by the time it lands.
      this.owner.stats.health.baseValue = Math.max(
        1,
        this.owner.stats.health.baseValue - HEALTH_COST
      );

      // The damage waits for the axe. It used to land on the cast frame with a
      // generic shard burst painted on the victim, so the ability was a noise and
      // a health bar dropping — no arm, no axe, nothing that read as a swing.
      const swing = new Olaf_E_Swing(this.owner, target);
      this.game.objectManager.addObject(swing);
    }

    _findTarget() {
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
      let nearest = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = this.owner.position.dist(enemy.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Olaf_E;
}
const __cacheOlaf_E = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_E>>();
export default function makeOlaf_E(api: ContentApi) {
  const cached = __cacheOlaf_E.get(api);
  if (cached) return cached;
  const built = __buildOlaf_E(api);
  __cacheOlaf_E.set(api, built);
  return built;
}


/** He hauls the axe back for this long before it comes down. */
export const WINDUP_MS = 190;

/** The chop itself, from full cock to contact. */
export const CHOP_MS = 110;

export const RECOVER_MS = 240;


/**
 * Reckless Swing, as a swing.
 *
 * Three beats the player has to be able to read, because this is a melee
 * commitment that costs Olaf health: he hauls the axe back over his shoulder
 * (the tell — the victim gets ~190ms to walk out of 170px), it comes down, and
 * only on contact does anything take damage. The recovery hangs the cut in the
 * air so the trade is legible after the fact.
 *
 * Not an `AoePulse`: the shared shard burst is a *blast*, and this is one man
 * hitting one man with an axe. The cut is a single arc through the body plus
 * Olaf's own blood coming off him, which is the half of the trade that the old
 * version never showed at all.
 */
function __buildOlaf_E_Swing(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Olaf_E_Swing extends SpellObject {
    target: AttackableUnit;
    age = 0;
    lifeTime = WINDUP_MS + CHOP_MS + RECOVER_MS;
    hasLanded = false;
    /** Frozen at cast: the swing goes where he aimed it, not where they ran to. */
    aim: p5.Vector;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#c8202a', 0.4);

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.aim = target.position.copy();
      this.position = owner.position.copy();
    }

    onAdded() {
      this.useParticles(this.particleSystem);
    }

    update() {
      this.age += deltaTime;

      if (!this.hasLanded && this.age >= WINDUP_MS + CHOP_MS) {
        this.hasLanded = true;
        // still track the body, so a target that stepped aside is still hit where
        // it stands — the ability auto-locks, it is not a skillshot
        if (!this.target.isDead && !this.target.toRemove) {
          this.aim = this.target.position.copy();
          this.target.takeDamage(DAMAGE, this.owner);
        }
        for (let i = 0; i < 14; i++) {
          this.particleSystem.addParticle({
            x: this.aim.x + random(-18, 18),
            y: this.aim.y + random(-18, 18),
            r: random(5, 12),
          });
        }
        // his own blood, thrown off him — the health he just paid
        for (let i = 0; i < 6; i++) {
          this.particleSystem.addParticle({
            x: this.owner.position.x + random(-14, 14),
            y: this.owner.position.y + random(-14, 14),
            r: random(4, 9),
          });
        }
      }

      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const ox = this.owner.position.x;
      const oy = this.owner.position.y;
      const heading = Math.atan2(this.aim.y - oy, this.aim.x - ox);
      const reach = Math.min(RANGE, Math.hypot(this.aim.x - ox, this.aim.y - oy) + 24);

      push();
      translate(ox, oy);
      rotate(heading);

      if (this.age < WINDUP_MS) {
        // WINDUP — the axe hauled back over his shoulder, further the closer it
        // gets to coming down
        const k = constrain(this.age / WINDUP_MS, 0, 1);
        const back = -2.1 - k * 0.55;
        push();
        rotate(back);
        stroke(90, 70, 55, 230);
        strokeWeight(6);
        line(0, 0, 34, 0);
        noStroke();
        fill(198, 208, 220, 240);
        // the head, cocked and catching the light
        quad(30, -4, 46, -16, 54, 2, 34, 8);
        pop();

        // a thin arc showing where it will fall — the window to leave
        noFill();
        stroke(220, 80, 70, 60 + 90 * k);
        strokeWeight(2);
        arc(0, 0, reach * 2, reach * 2, -0.55, 0.55);
        pop();
        return;
      }

      const chop = constrain((this.age - WINDUP_MS) / CHOP_MS, 0, 1);
      // ease-in: an axe accelerates on the way down
      const swept = chop * chop;
      const after = constrain((this.age - WINDUP_MS - CHOP_MS) / RECOVER_MS, 0, 1);
      const fade = 1 - after;

      // the cut: a single crescent carved from the cock angle round to the target
      const from = -2.65;
      const to = 0;
      const edge = from + (to - from) * swept;

      noFill();
      stroke(255, 250, 240, 235 * (chop < 1 ? 1 : fade));
      strokeWeight(5 * (chop < 1 ? 1 : fade) + 1);
      arc(0, 0, reach * 1.7, reach * 1.7, Math.min(from, edge), Math.max(from, edge));
      stroke(210, 70, 60, 180 * (chop < 1 ? 1 : fade));
      strokeWeight(12 * (chop < 1 ? 1 : fade) + 2);
      arc(0, 0, reach * 1.7, reach * 1.7, Math.min(from, edge), Math.max(from, edge));

      // the axe itself, riding the leading edge
      if (chop < 1) {
        push();
        rotate(edge);
        stroke(90, 70, 55, 240);
        strokeWeight(6);
        line(0, 0, 34, 0);
        noStroke();
        fill(228, 236, 248, 250);
        quad(30, -4, 46, -16, 54, 2, 34, 8);
        pop();
      }
      pop();

      // the wound, in world space on the body that took it
      if (this.hasLanded && fade > 0) {
        push();
        translate(this.aim.x, this.aim.y);
        rotate(heading);
        const flash = 1 - constrain(after / 0.3, 0, 1);
        if (flash > 0) {
          noStroke();
          fill(255, 245, 235, 220 * flash);
          circle(0, 0, 34 * (1 - flash) + 8);
        }
        // one gash, not a burst: this was an axe, not an explosion
        stroke(190, 30, 34, 235 * fade);
        strokeWeight(7 * fade + 1);
        line(-26, -14, 26, 14);
        stroke(255, 210, 200, 200 * fade);
        strokeWeight(3 * fade + 1);
        line(-22, -12, 22, 12);
        pop();
      }
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.owner.position.x, this.aim.x) - RANGE;
      const minY = Math.min(this.owner.position.y, this.aim.y) - RANGE;
      const maxX = Math.max(this.owner.position.x, this.aim.x) + RANGE;
      const maxY = Math.max(this.owner.position.y, this.aim.y) + RANGE;
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return Olaf_E_Swing;
}
const __cacheOlaf_E_Swing = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_E_Swing>>();
export function makeOlaf_E_Swing(api: ContentApi) {
  const cached = __cacheOlaf_E_Swing.get(api);
  if (cached) return cached;
  const built = __buildOlaf_E_Swing(api);
  __cacheOlaf_E_Swing.set(api, built);
  return built;
}