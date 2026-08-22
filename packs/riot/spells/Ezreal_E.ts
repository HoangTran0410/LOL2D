import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeDetonateEssenceFlux, makeEssenceFluxSpell } from './Ezreal_W';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ezreal_E = InstanceType<ReturnType<typeof makeEzreal_E>>;
type Ezreal_E_Bolt = InstanceType<ReturnType<typeof makeEzreal_E_Bolt>>;
type Ezreal_E_Rift = InstanceType<ReturnType<typeof makeEzreal_E_Rift>>;



export const EZREAL_E_BLINK_RANGE = 300;

/** Fast enough to read as a blink, slow enough to leave a trail worth watching. */
export const EZREAL_E_BLINK_SPEED = 42;

export const EZREAL_E_BOLT_DAMAGE = 26;

/** How far the homing bolt will look for somebody once he lands. */
export const EZREAL_E_BOLT_SEARCH_RANGE = 380;

export const EZREAL_E_BOLT_SPEED = 22;

export const EZREAL_E_REVEAL_MS = 1500;

export const EZREAL_E_REVEAL_STACK_ID = 'ezreal_e';


/**
 * Arcane Shift — the reposition, and the free bolt that punishes whoever was
 * closest to where he came out.
 *
 * The blink is a `Dash` rather than a teleport on purpose: `Dash.CanDash` is
 * where grounding is enforced, and a dash short enough to look instant still
 * gets cancelled by the crowd control that should stop it.
 */
function __buildEzreal_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const essenceFluxSpell = makeEssenceFluxSpell(api);
  const Ezreal_E_Bolt = makeEzreal_E_Bolt(api);
  const Ezreal_E_Rift = makeEzreal_E_Rift(api);
  class Ezreal_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_ezreal_e');
    name = 'Dịch Chuyển Cổ Học (Ezreal_E)';
    description =
      `Dịch chuyển tối đa <span>${EZREAL_E_BLINK_RANGE}px</span> về hướng con trỏ, sau đó bắn một` +
      ` tia dẫn đường vào kẻ địch gần nhất, gây <span class="damage">${EZREAL_E_BOLT_DAMAGE} sát thương</span>` +
      ` và <span class="buff">Lộ Diện</span> mục tiêu trong <span class="time">${EZREAL_E_REVEAL_MS / 1000} giây</span>.` +
      ' Ưu tiên mục tiêu đang mang dấu Tinh Hoa Tuôn Chảy.';

    coolDown = 9000;
    manaCost = 55;

    range = EZREAL_E_BLINK_RANGE;

    checkCastCondition() {
      return Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        EZREAL_E_BLINK_RANGE
      );

      const departure = new Ezreal_E_Rift(this.owner);
      departure.position = from.copy();
      this.game.objectManager.addObject(departure);

      const blink = new Dash(1000, this.owner, this.owner);
      blink.image = this.image;
      blink.dashDestination = to;
      blink.dashSpeed = EZREAL_E_BLINK_SPEED;
      blink.showTrail = true;
      // `onReachedDestination`, never `onUpdate` — assigning `onUpdate` on a Dash
      // instance shadows the prototype and deletes the movement itself.
      blink.onReachedDestination = () => this.fireBolt();
      this.owner.addBuff(blink);
    }

    /** The bolt goes off where he *lands*, so this runs from the dash's arrival. */
    fireBolt() {
      const arrival = new Ezreal_E_Rift(this.owner);
      arrival.position = this.owner.position.copy();
      arrival.incoming = true;
      this.game.objectManager.addObject(arrival);

      const target = this.pickBoltTarget();
      if (!target) return;

      const bolt = new Ezreal_E_Bolt(this.owner, target);
      bolt.position = this.owner.position.copy();
      this.game.objectManager.addObject(bolt);
    }

    /**
     * Whoever the bolt goes to: the champion carrying his own W mark if one is in
     * reach, otherwise the nearest enemy.
     *
     * `visibleTo` is on the query because this *picks* a unit — an auto-lock that
     * can reach through a wall into the fog would let Ezreal shoot things the
     * screen is not showing him.
     */
    pickBoltTarget(): AttackableUnit | null {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(EZREAL_E_BOLT_SEARCH_RANGE, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeUntargetable,
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      const marked = essenceFluxSpell(this.owner)?.mark?.target ?? null;
      let best: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const candidate of candidates) {
        if (marked && candidate === marked) return candidate;
        const distance = candidate.position.dist(this.owner.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          best = candidate;
        }
      }
      return best;
    }
  }
  return Ezreal_E;
}
const __cacheEzreal_E = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_E>>();
export default function makeEzreal_E(api: ContentApi) {
  const cached = __cacheEzreal_E.get(api);
  if (cached) return cached;
  const built = __buildEzreal_E(api);
  __cacheEzreal_E.set(api, built);
  return built;
}


/** The homing bolt — a thin lance of light, visibly *pulled* toward its target. */
function __buildEzreal_E_Bolt(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const createReveal = api.buffs.createReveal;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const detonateEssenceFlux = makeDetonateEssenceFlux(api);
  const Ezreal_E_Rift = makeEzreal_E_Rift(api);
  class Ezreal_E_Bolt extends HomingMissileSpellObject {
    speed = EZREAL_E_BOLT_SPEED;
    size = 20;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(150, 215, 255, 0.55)',
      trailSize: 9,
      trailLifeTime: 280,
      maxLength: 18,
    });

    onTargetArrive(target: AttackableUnit): void {
      target.takeDamage(EZREAL_E_BOLT_DAMAGE, this.owner);
      target.addBuff(
        createReveal({
          stackId: EZREAL_E_REVEAL_STACK_ID,
          durationMs: EZREAL_E_REVEAL_MS,
          source: this.owner,
          target,
          visionRadius: 160,
        })
      );
      detonateEssenceFlux(this.owner, target);

      const rift = new Ezreal_E_Rift(this.owner);
      rift.position = target.position.copy();
      rift.incoming = true;
      rift.lifeTime = 260;
      this.game.objectManager.addObject(rift);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      noStroke();
      fill(140, 210, 255, 70);
      ellipse(0, 0, this.size * 2.6, this.size * 0.9);

      // a lance rather than a dot: the tail stretches back toward where it left
      fill(205, 240, 255, 240);
      triangle(this.size * 0.9, 0, -this.size * 1.4, -3.5, -this.size * 1.4, 3.5);
      fill(255, 255, 255, 250);
      ellipse(this.size * 0.35, 0, this.size * 0.7, 4);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2.4;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_E_Bolt;
}
const __cacheEzreal_E_Bolt = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_E_Bolt>>();
export function makeEzreal_E_Bolt(api: ContentApi) {
  const cached = __cacheEzreal_E_Bolt.get(api);
  if (cached) return cached;
  const built = __buildEzreal_E_Bolt(api);
  __cacheEzreal_E_Bolt.set(api, built);
  return built;
}


/**
 * A tear in the air at either end of the blink.
 *
 * Departure and arrival are the same shape run in opposite directions — the
 * rift he leaves collapses outward, the one he steps out of snaps shut — so a
 * spectator can tell which end of the blink they are looking at.
 */
function __buildEzreal_E_Rift(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Ezreal_E_Rift extends SpellObject {
    age = 0;
    lifeTime = 320;
    radius = 46;
    incoming = false;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(170, 220, 255, 0.55)',
      0.34
    );

    /** Seeded once — a rift redrawn from fresh randoms every frame is static, not magic. */
    _shards: { angle: number; length: number; width: number }[] = [];

    onAdded() {
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 8; i++) {
        this._shards.push({
          angle: (TWO_PI / 8) * i + random(-0.22, 0.22),
          length: random(0.55, 1.05),
          width: random(2, 5),
        });
      }
      for (let i = 0; i < 10; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-18, 18),
          y: this.position.y + random(-18, 18),
          r: random(3, 9),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const raw = constrain(this.age / this.lifeTime, 0, 1);
      // arrival plays the same animation backwards, so the two ends read apart
      const t = this.incoming ? 1 - raw : raw;
      const fade = 1 - raw;
      const ease = 1 - (1 - t) * (1 - t);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.incoming ? -raw * 0.9 : raw * 0.9);

      noStroke();
      fill(120, 180, 255, 60 * fade);
      circle(0, 0, this.radius * 1.6 * (0.4 + ease));

      stroke(190, 230, 255, 230 * fade);
      for (const shard of this._shards) {
        strokeWeight(shard.width * fade + 0.8);
        const inner = this.radius * 0.2;
        const outer = this.radius * shard.length * (0.3 + ease);
        line(
          cos(shard.angle) * inner,
          sin(shard.angle) * inner,
          cos(shard.angle) * outer,
          sin(shard.angle) * outer
        );
      }

      noFill();
      stroke(215, 240, 255, 200 * fade);
      strokeWeight(2);
      circle(0, 0, this.radius * (0.35 + ease));
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_E_Rift;
}
const __cacheEzreal_E_Rift = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_E_Rift>>();
export function makeEzreal_E_Rift(api: ContentApi) {
  const cached = __cacheEzreal_E_Rift.get(api);
  if (cached) return cached;
  const built = __buildEzreal_E_Rift(api);
  __cacheEzreal_E_Rift.set(api, built);
  return built;
}