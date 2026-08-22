import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec, ExecuteSpell, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Annie_Q = InstanceType<ReturnType<typeof makeAnnie_Q>>;
type Annie_Q_Burst = InstanceType<ReturnType<typeof makeAnnie_Q_Burst>>;
type Annie_Q_Object = InstanceType<ReturnType<typeof makeAnnie_Q_Object>>;



export const RANGE = 500;

export const DAMAGE = 26;

export const COOLDOWN_MS = 4_000;

export const MANA_COST = 25;

/** Wiki: a kill refunds the mana and halves the cooldown. */
export const KILL_COOLDOWN_SCALE = 0.5;


/**
 * Tongues on the fireball. Annie's fire is drawn with hard corners rather than
 * soft gradients — a child's idea of a flame — so it never gets mistaken for
 * one of the game's several round magic orbs.
 */
export const FLAME_TONGUES = 7;

/** Windup: the fireball is struck out of nothing over this long. */
export const FIREBALL_SPAWN_MS = 90;

/** How long the scorch left where the fireball landed stays up. */
export const Q_BURST_MS = 380;


const isAnnieTarget = (target: unknown): target is AttackableUnit =>
  !!target && typeof (target as AttackableUnit).takeDamage === 'function';


/**
 * Disintegrate. Point-and-click, which is the whole character: Annie has no
 * skillshot to dodge, only a range to stay out of.
 *
 * `docs/abilities/annie/q.json`: unit-targeted, 4s cooldown, and *"if this
 * kills the target, the cooldown is reduced by 50% and the mana cost is
 * refunded"* — the reason Annie farms with it.
 */
function __buildAnnie_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const effectiveHealth = api.combat.ExecuteTargeting.effectiveHealth;
  const isLethal = api.combat.ExecuteTargeting.isLethal;
  const AttackableUnit = api.units.AttackableUnit;
  const Annie_Q_Object = makeAnnie_Q_Object(api);
  class Annie_Q extends Spell implements ExecuteSpell {
    image = api.asset('spell_annie_q');
    name = 'Hỏa Cầu (Annie_Q)';
    description =
      `Ném cầu lửa vào một mục tiêu trong <span>${RANGE}px</span>, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span>. Nếu <span class="buff">hạ gục</span> mục tiêu,` +
      ` hoàn lại toàn bộ mana và <span class="buff">giảm ${(1 - KILL_COOLDOWN_SCALE) * 100}% hồi chiêu</span>`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;

    get targetingRequest(): TargetingRequest {
      return {
        range: this.range,
        targetTeam: 'ENEMY',
        /**
         * With the cursor on empty ground, take whoever the fireball finishes.
         *
         * This is the ring on screen and the cast finally agreeing. The mark says
         * "this one dies"; before this the press then went to whoever happened to
         * be nearest the cursor, which on a wave is almost never the one that was
         * marked. Only consulted when the player is *not* pointing at anybody —
         * aim is never overruled, and a deliberate click on a champion still
         * beats a lethal minion.
         *
         * Lowest effective health among the lethal ones, the same tie-break
         * `pickExecuteTarget` uses: the fireball travels, and the one with least
         * left is the one fewest heals can save.
         */
        pickWithoutAim: (candidates, nearestToCursor) => {
          let best: unknown;
          let lowest = Infinity;
          for (const candidate of candidates) {
            if (!isAnnieTarget(candidate) || !isLethal(DAMAGE, candidate)) continue;
            const health = effectiveHealth(candidate);
            if (health >= lowest) continue;
            lowest = health;
            best = candidate;
          }
          return best ?? nearestToCursor;
        },
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isAnnieTarget(candidate),
        getTargetInfo: candidate =>
          isAnnieTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    get castSpec(): CastSpec {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        castTimeMs: 0,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast() {
      const target = this.castContext?.target;
      if (!isAnnieTarget(target) || !withinRange(this.range, this.owner, target)) return;

      const orb = new Annie_Q_Object(this.owner, target);
      orb.spell = this;
      this.game.objectManager.addObject(orb);
    }

    /**
     * The refund, paid by the orb when it lands the kill. Reaching back into the
     * spell rather than the orb doing it itself keeps the two rewards — mana and
     * cooldown — stated once, next to the numbers they undo.
     */
    rewardKill(): void {
      this.currentCooldown = this.currentCooldown * KILL_COOLDOWN_SCALE;
      // Through `changeResource`, never `stats.mana` — that seam is what keeps
      // URF's `manaFree` honest, and it refunds exactly what was charged (see
      // the source scan in tests/game/spells/mana-spend-seam.test.ts).
      this.changeResource(this.owner.stats.mana, this.effectiveMana(this.manaCost));
    }

    /**
     * Everyone in range, for the on-screen "this one dies" ring.
     *
     * Annie Q stays point-and-click — it is the whole character, and nothing here
     * picks a target for the player, so there is no `executeFallback`. The mark
     * is what the ability was missing: a kill refunds the mana *and* halves the
     * cooldown, which makes "will this one die" the single question Annie asks
     * all game, and until now it had to be answered by squinting at a health bar.
     *
     * `withinRange` rather than a raw distance, and the same body-aware reach the
     * cast itself is gated on — a ring on someone the cast would refuse is worse
     * than no ring.
     */
    executeCandidates(): AttackableUnit[] {
      const found = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.range + this.owner.stats.size.value,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const reachable: AttackableUnit[] = [];
      for (const candidate of found) {
        if (withinRange(this.range, this.owner, candidate)) reachable.push(candidate);
      }
      return reachable;
    }

    executeDamageAgainst(_target: AttackableUnit): number {
      return DAMAGE;
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Annie_Q;
}
const __cacheAnnie_Q = new WeakMap<ContentApi, ReturnType<typeof __buildAnnie_Q>>();
export default function makeAnnie_Q(api: ContentApi) {
  const cached = __cacheAnnie_Q.get(api);
  if (cached) return cached;
  const built = __buildAnnie_Q(api);
  __cacheAnnie_Q.set(api, built);
  return built;
}


function __buildAnnie_Q_Object(api: ContentApi) {
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  const Annie_Q_Burst = makeAnnie_Q_Burst(api);
  class Annie_Q_Object extends HomingMissileSpellObject {
    speed = 16;
    size = 22;
    spell: Annie_Q | null = null;

    /** Embers shedding off the fireball as it flies. */
    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#FFA23CCC', 0.35);

    /** Cosmetic: drives the spawn flare, the roll and the flicker. */
    _age = 0;

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
    }

    onTargetArrive(target: AttackableUnit) {
      const before = target.isDead;
      target.takeDamage(DAMAGE, this.owner);
      if (!before && target.isDead) this.spell?.rewardKill();

      // the fireball is removed on arrival, so the detonation has to be its own
      // object — otherwise Annie's signature spell ends by simply switching off
      const burst = new Annie_Q_Burst(this.owner);
      burst.position = target.position.copy();
      burst.targetSize = target.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(burst);
    }

    update() {
      this._age += deltaTime;

      // embers fall off the back of the ball rather than out of its centre
      if (random() < 0.8) {
        const r = this.size / 2;
        this.particleSystem.addParticle({
          x: this.position.x + random(-r, r),
          y: this.position.y + random(-r, r),
          r: random(3, 8),
        });
      }

      super.update();
    }

    draw() {
      // ease-out: struck alight fast, because a slow bloom would make a 16px/frame
      // fireball look like it was dropped rather than thrown
      const grow = constrain(this._age / FIREBALL_SPAWN_MS, 0, 1);
      const born = 1 - (1 - grow) * (1 - grow);
      const roll = this._age / 260;
      const r = (this.size / 2) * born;

      push();
      translate(this.position.x, this.position.y);

      // heat glow. Additive so the ball washes out whatever it passes over,
      // which is what sells it as burning rather than as a painted disc.
      blendMode(ADD);
      noStroke();
      fill(255, 110, 20, 80);
      circle(0, 0, r * 4.4);
      blendMode(BLEND);

      // sharp tongues of flame, each on its own flicker so the silhouette never
      // settles. Irregular lengths — an even star would read as a cog.
      noStroke();
      rotate(roll);
      for (let i = 0; i < FLAME_TONGUES; i++) {
        const a = (TWO_PI * i) / FLAME_TONGUES;
        const lick = 1 + sin(this._age / 70 + i * 1.7) * 0.3;
        const len = r * (i % 3 === 0 ? 2.6 : 1.9) * lick;
        push();
        rotate(a);
        fill(214, 52, 22, 220);
        triangle(r * 0.6, -r * 0.62, r * 0.6, r * 0.62, len, 0);
        fill(255, 138, 34, 235);
        triangle(r * 0.7, -r * 0.34, r * 0.7, r * 0.34, len * 0.78, 0);
        pop();
      }

      // the ball: red shell, orange body, white-yellow heart
      fill(212, 48, 20, 235);
      circle(0, 0, r * 2);
      fill(255, 132, 34, 245);
      circle(0, 0, r * 1.5);
      fill(255, 214, 96, 250);
      circle(0, 0, r * 0.95);
      fill(255, 252, 224, 255);
      circle(0, 0, r * (0.45 + sin(this._age / 55) * 0.06));

      pop();
    }

    // tongues and heat glow both paint well past the 22px hitbox
    getDisplayBoundingBox() {
      const r = this.size * 1.8;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Annie_Q_Object;
}
const __cacheAnnie_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAnnie_Q_Object>>();
export function makeAnnie_Q_Object(api: ContentApi) {
  const cached = __cacheAnnie_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildAnnie_Q_Object(api);
  __cacheAnnie_Q_Object.set(api, built);
  return built;
}


/** The detonation: a hard flash, a scorch ring, and flame shrapnel. */
function __buildAnnie_Q_Burst(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Annie_Q_Burst extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = Q_BURST_MS;
    maxRadius = 58;

    _shards: { a: number; speed: number; len: number; width: number }[] = [];

    onAdded() {
      for (let i = 0; i < FLAME_TONGUES + 3; i++) {
        this._shards.push({
          a: random(0, TWO_PI),
          speed: random(0.6, 1.3),
          len: random(12, 26),
          width: random(3, 7),
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
      const flash = 1 - constrain(t / 0.25, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the blast itself, white at the centre and gone in a quarter of the life
      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(255, 220, 140, 220 * flash);
        circle(0, 0, this.targetSize * 0.9 + t * 70);
        fill(255, 255, 255, 200 * flash);
        circle(0, 0, this.targetSize * 0.5 * flash + 12);
        blendMode(BLEND);
      }

      // scorch ring: the footprint of the hit, so a target burned in a crowd is
      // identifiable after the flash has gone
      noFill();
      stroke(226, 74, 26, 225 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t);
      stroke(255, 190, 90, 235 * fade);
      strokeWeight(2 * fade + 0.8);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t * 0.82);

      // shrapnel of flame thrown outward, angular the whole way out
      noStroke();
      for (const s of this._shards) {
        const d = 8 + this.maxRadius * t * s.speed;
        push();
        translate(cos(s.a) * d, sin(s.a) * d);
        rotate(s.a);
        fill(232, 84, 24, 230 * fade);
        triangle(s.len * fade, 0, -s.len * 0.3, -s.width * fade, -s.len * 0.3, s.width * fade);
        fill(255, 206, 110, 235 * fade);
        triangle(
          s.len * fade * 0.7,
          0,
          -s.len * 0.2,
          -s.width * fade * 0.5,
          -s.len * 0.2,
          s.width * fade * 0.5
        );
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Annie_Q_Burst;
}
const __cacheAnnie_Q_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildAnnie_Q_Burst>>();
export function makeAnnie_Q_Burst(api: ContentApi) {
  const cached = __cacheAnnie_Q_Burst.get(api);
  if (cached) return cached;
  const built = __buildAnnie_Q_Burst(api);
  __cacheAnnie_Q_Burst.set(api, built);
  return built;
}