import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Caitlyn_E = InstanceType<ReturnType<typeof makeCaitlyn_E>>;
type Caitlyn_E_MuzzleBlast = InstanceType<ReturnType<typeof makeCaitlyn_E_MuzzleBlast>>;
type Caitlyn_E_Net = InstanceType<ReturnType<typeof makeCaitlyn_E_Net>>;
type Caitlyn_E_Tangle = InstanceType<ReturnType<typeof makeCaitlyn_E_Tangle>>;



export const CAITLYN_E_RANGE = 430;

export const CAITLYN_E_SPEED = 19;

export const CAITLYN_E_NET_SIZE = 42;

export const CAITLYN_E_DAMAGE = 24;

export const CAITLYN_E_SLOW_PERCENT = 0.5;

export const CAITLYN_E_SLOW_MS = 1200;

/** How far the recoil throws her, straight back down the firing line. */
export const CAITLYN_E_RECOIL_DISTANCE = 240;

export const CAITLYN_E_RECOIL_SPEED = 22;


/**
 * 90 Caliber Net — the escape that also lands the slow.
 *
 * Firing and recoiling are two separate things on purpose: the net always goes
 * out, but she only gets thrown backwards if she is actually able to move
 * herself. `Dash.CanDash` is where that is decided, so a rooted or grounded
 * Caitlyn still gets her damage and her slow and simply does not get the
 * disengage — which is exactly the trade the ability is supposed to offer.
 */
function __buildCaitlyn_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Caitlyn_E_Net = makeCaitlyn_E_Net(api);
  const Caitlyn_E_MuzzleBlast = makeCaitlyn_E_MuzzleBlast(api);
  class Caitlyn_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_caitlyn_e');
    name = 'Lưới 90 (Caitlyn_E)';
    description =
      `Bắn một tấm lưới gây <span class="damage">${CAITLYN_E_DAMAGE} sát thương</span> và` +
      ` <span class="buff">Làm Chậm ${CAITLYN_E_SLOW_PERCENT * 100}%</span> kẻ địch đầu tiên trúng phải` +
      ` trong <span class="time">${CAITLYN_E_SLOW_MS / 1000} giây</span>.` +
      ` Lực giật đẩy Caitlyn lùi lại <span>${CAITLYN_E_RECOIL_DISTANCE}px</span> theo hướng ngược lại.`;

    coolDown = 9000;
    manaCost = 50;

    range = CAITLYN_E_RANGE;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        CAITLYN_E_RANGE
      );

      const net = new Caitlyn_E_Net(this.owner);
      net.position = from.copy();
      net.destination = to;
      this.game.objectManager.addObject(net);

      this.recoil(from, to);
    }

    /** Straight back down the line the net went out on. */
    recoil(from: p5.Vector, to: p5.Vector) {
      if (!Dash.CanDash(this.owner)) return;

      const back = createVector(from.x - (to.x - from.x), from.y - (to.y - from.y));
      const { to: landing } = VectorUtils.getVectorWithRange(
        this.owner.position,
        back,
        CAITLYN_E_RECOIL_DISTANCE
      );

      const kick = new Dash(1200, this.owner, this.owner);
      kick.image = this.image;
      kick.dashDestination = landing;
      kick.dashSpeed = CAITLYN_E_RECOIL_SPEED;
      kick.showTrail = true;
      this.owner.addBuff(kick);

      const blast = new Caitlyn_E_MuzzleBlast(this.owner);
      blast.position = from.copy();
      blast.angle = Math.atan2(to.y - from.y, to.x - from.x);
      blast.attachTo(this.owner);
      this.game.objectManager.addObject(blast);
    }
  }
  return Caitlyn_E;
}
const __cacheCaitlyn_E = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_E>>();
export default function makeCaitlyn_E(api: ContentApi) {
  const cached = __cacheCaitlyn_E.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_E(api);
  __cacheCaitlyn_E.set(api, built);
  return built;
}


/**
 * The net.
 *
 * Rope and knots, tumbling end over end — the one thing in the game that is not
 * made of light. It opens as it flies, so the shape you are dodging grows on the
 * way toward you rather than arriving at full size.
 */
function __buildCaitlyn_E_Net(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const BuffAddType = api.enums.BuffAddType;
  const TrailSystem = api.helpers.TrailSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Caitlyn_E_Tangle = makeCaitlyn_E_Tangle(api);
  class Caitlyn_E_Net extends MissileSpellObject {
    speed = CAITLYN_E_SPEED;
    size = CAITLYN_E_NET_SIZE;
    maxHitCount = 1;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(205, 180, 130, 0.32)',
      trailSize: CAITLYN_E_NET_SIZE * 0.4,
      trailLifeTime: 200,
      maxLength: 12,
    });

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(220, 200, 150, 0.5)',
      0.35
    );

    spin = 0;
    travelled = 0;

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    onAfterMove() {
      this.spin += 0.14;
      this.travelled += this.speed;
    }

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(CAITLYN_E_DAMAGE, this.owner);

      const slow = new Slow(CAITLYN_E_SLOW_MS, this.owner, enemy);
      slow.buffAddType = BuffAddType.RENEW_EXISTING;
      slow.percent = CAITLYN_E_SLOW_PERCENT;
      enemy.addBuff(slow);

      for (let i = 0; i < 12; i++) {
        this.particleSystem.addParticle({
          x: enemy.position.x + random(-20, 20),
          y: enemy.position.y + random(-20, 20),
          r: random(3, 8),
        });
      }
      const tangle = new Caitlyn_E_Tangle(this.owner);
      tangle.position = enemy.position.copy();
      tangle.attachTo(enemy);
      tangle.anchor = enemy;
      this.game.objectManager.addObject(tangle);
    }

    draw() {
      // it unfurls over the first 80px: a balled-up net leaving the barrel, then
      // an open mesh in flight
      const open = constrain(this.travelled / 80, 0.35, 1);
      const r = (this.size / 2) * open;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.spin);

      // the mesh: two crossing families of cords rather than a drawn circle
      stroke(214, 190, 138, 235);
      strokeWeight(2);
      noFill();
      for (let i = -2; i <= 2; i++) {
        const offset = (i / 2) * r * 0.85;
        const half = Math.sqrt(Math.max(0, r * r - offset * offset));
        line(-half, offset, half, offset);
        line(offset, -half, offset, half);
      }

      // the weighted rim, which is what actually catches
      stroke(150, 120, 70, 240);
      strokeWeight(3.5);
      circle(0, 0, r * 2);

      // knots on the rim
      noStroke();
      fill(120, 96, 54, 240);
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI / 6) * i;
        circle(cos(a) * r, sin(a) * r, 5);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_E_Net;
}
const __cacheCaitlyn_E_Net = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_E_Net>>();
export function makeCaitlyn_E_Net(api: ContentApi) {
  const cached = __cacheCaitlyn_E_Net.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_E_Net(api);
  __cacheCaitlyn_E_Net.set(api, built);
  return built;
}


/** Cords clinging to whoever got caught, for as long as the slow runs. */
function __buildCaitlyn_E_Tangle(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Caitlyn_E_Tangle extends SpellObject {
    age = 0;
    lifeTime = CAITLYN_E_SLOW_MS;
    anchor: AttackableUnit | null = null;
    radius = 30;

    /** Seeded once — cords re-rolled per frame would boil instead of hanging. */
    _cords: { angle: number; length: number; sag: number }[] = [];

    onAdded() {
      for (let i = 0; i < 9; i++) {
        this._cords.push({
          angle: (TWO_PI / 9) * i + random(-0.2, 0.2),
          length: random(0.6, 1.05),
          sag: random(0.15, 0.5),
        });
      }
    }

    update() {
      if (this.dropIfAttachmentLost()) return;
      if (this.anchor) {
        this.position.set(this.anchor.position.x, this.anchor.position.y);
        this.radius = (this.anchor.animatedValues?.displaySize ?? 40) * 0.55 + 8;
      }
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t * t;

      push();
      translate(this.position.x, this.position.y);
      stroke(206, 182, 132, 225 * fade);
      strokeWeight(2);
      noFill();
      for (const cord of this._cords) {
        const reach = this.radius * cord.length;
        const x = cos(cord.angle) * reach;
        const y = sin(cord.angle) * reach;
        // a slack cord, so it reads as rope draped over a body rather than spokes
        const midX = x * 0.5 - sin(cord.angle) * reach * cord.sag;
        const midY = y * 0.5 + cos(cord.angle) * reach * cord.sag;
        beginShape();
        vertex(0, 0);
        vertex(midX, midY);
        vertex(x, y);
        endShape();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_E_Tangle;
}
const __cacheCaitlyn_E_Tangle = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_E_Tangle>>();
export function makeCaitlyn_E_Tangle(api: ContentApi) {
  const cached = __cacheCaitlyn_E_Tangle.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_E_Tangle(api);
  __cacheCaitlyn_E_Tangle.set(api, built);
  return built;
}


/** The kick that throws her: a hard cone of muzzle smoke pointing forward. */
function __buildCaitlyn_E_MuzzleBlast(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Caitlyn_E_MuzzleBlast extends SpellObject {
    age = 0;
    lifeTime = 240;
    angle = 0;

    update() {
      // it stays on the barrel while she is thrown backwards, so the recoil reads
      // as the gun pushing her rather than a dash she chose
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const ease = 1 - (1 - t) * (1 - t);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      noStroke();
      fill(255, 236, 190, 190 * fade);
      triangle(10 + 60 * ease, 0, 8, -14 - 16 * ease, 8, 14 + 16 * ease);
      fill(255, 255, 240, 220 * fade);
      triangle(8 + 30 * ease, 0, 6, -7 - 7 * ease, 6, 7 + 7 * ease);

      // smoke curls, thrown wide of the barrel
      stroke(220, 210, 195, 160 * fade);
      strokeWeight(2.5 * fade + 1);
      noFill();
      for (let i = -1; i <= 1; i += 2) {
        arc(18 + 20 * ease, i * (10 + 12 * ease), 26 + 24 * ease, 20 + 18 * ease, 0, PI);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 110;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_E_MuzzleBlast;
}
const __cacheCaitlyn_E_MuzzleBlast = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_E_MuzzleBlast>>();
export function makeCaitlyn_E_MuzzleBlast(api: ContentApi) {
  const cached = __cacheCaitlyn_E_MuzzleBlast.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_E_MuzzleBlast(api);
  __cacheCaitlyn_E_MuzzleBlast.set(api, built);
  return built;
}