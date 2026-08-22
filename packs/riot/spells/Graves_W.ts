import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Nearsight = InstanceType<ContentApi['buffs']['Nearsight']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Graves_W = InstanceType<ReturnType<typeof makeGraves_W>>;
type Graves_W_Object = InstanceType<ReturnType<typeof makeGraves_W_Object>>;



/** Lobes of smoke making up the cloud. Enough to churn, few enough to stay cheap. */
export const SMOKE_LOBES = 14;

/** The canister cracks open over this long; nothing pops in at full size. */
export const CANISTER_BURST_MS = 260;

/** Fraction of the life spent thinning out at the end, as a warning. */
export const SMOKE_DISSIPATE = 0.18;

/** How often a fresh puff is fed to the particle system, in ms. */
export const PUFF_INTERVAL_MS = 120;


function __buildGraves_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Graves_W_Object = makeGraves_W_Object(api);
  class Graves_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_graves_w');
    name = 'Bom Mù (Graves_W)';
    description =
      'Tạo một làn khói tại khu vực chỉ định trong <span class="time">5 giây</span>, <span class="buff">Giảm tầm nhìn</span> và <span class="buff">Làm chậm 40%</span> tất cả kẻ địch / đồng minh trong khu vực';
    coolDown = 5000;
    manaCost = 30;

    range = 350;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new Graves_W_Object(this.owner);
      obj.position = to;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Graves_W;
}
const __cacheGraves_W = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_W>>();
export default function makeGraves_W(api: ContentApi) {
  const cached = __cacheGraves_W.get(api);
  if (cached) return cached;
  const built = __buildGraves_W(api);
  __cacheGraves_W.set(api, built);
  return built;
}


interface SmokeLobe {
  /** Where on the disc this lobe sits, and how far out. */
  angle: number;
  radius: number;
  size: number;
  /** Its own drift rate and phase, so no two lobes breathe together. */
  speed: number;
  phase: number;
  /** Darker lobes sit low in the cloud, paler ones ride on top. */
  shade: number;
}


function __buildGraves_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Nearsight = api.buffs.Nearsight;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const SpellObject = api.SpellObject;
  class Graves_W_Object extends SpellObject {
    position = createVector();
    range = 100;
    curRange = 0;
    lifeTime = 5000;
    age = 0;

    particleSystem = PredefinedParticleSystems.smoke([170, 168, 162], 0.8, 0.5);

    _lobes: SmokeLobe[] = [];
    _puffTimer = 0;

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);

      const pos = this.position;
      const size = this.range / 2;
      for (let i = 0; i < 10; i++) {
        this.particleSystem.addParticle({
          x: pos.x + random(-size, size),
          y: pos.y + random(-size, size),
          size: random(15, 30),
          opacity: random(100, 200),
        });
      }

      // The cloud is drawn as a churning pile of lobes rather than one disc: a
      // flat circle tells the player nothing about a screen that is supposed to
      // feel like it is boiling out of a grenade.
      for (let i = 0; i < SMOKE_LOBES; i++) {
        this._lobes.push({
          angle: (TWO_PI * i) / SMOKE_LOBES + random(-0.25, 0.25),
          radius: random(0.25, 0.95),
          size: random(0.45, 0.85),
          speed: random(0.6, 1.4),
          phase: random(0, TWO_PI),
          shade: random(0, 1),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        this.particleSystem.toRemove = true;
      }

      this.curRange = lerp(this.curRange, this.range, 0.08);

      // fresh smoke keeps being made for the whole five seconds — a cloud fed
      // once at spawn visibly stops moving halfway through its life
      this._puffTimer += deltaTime;
      if (this._puffTimer >= PUFF_INTERVAL_MS && this.age < this.lifeTime * (1 - SMOKE_DISSIPATE)) {
        this._puffTimer = 0;
        const spread = this.curRange * 0.8;
        this.particleSystem.addParticle({
          x: this.position.x + random(-spread, spread),
          y: this.position.y + random(-spread, spread),
          size: random(18, 34),
          opacity: random(70, 130),
        });
      }

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.curRange,
        }),
        filters: [PredefinedFilters.canTakeDamage],
      });

      enemies.forEach((enemy: any) => {
        if (!enemy.hasBuff(Nearsight)) {
          const nearsight = new Nearsight(500, this.owner, enemy);
          nearsight.newVisionRadius = this.range;
          enemy.addBuff(nearsight);

          const slow = new Slow(500, this.owner, enemy);
          slow.percent = 0.4;
          enemy.addBuff(slow);
        }
      });
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // thins out over the last stretch, which is the only warning a player
      // standing in it gets that the slow is about to end
      const density = 1 - constrain((t - (1 - SMOKE_DISSIPATE)) / SMOKE_DISSIPATE, 0, 1);
      const churn = this.age / 320;

      push();
      translate(this.position.x, this.position.y);
      noStroke();

      // the canister cracking open: a hard grey ring in the first quarter second,
      // so the cloud arrives from a bang instead of fading up out of nowhere
      const crack = 1 - constrain(this.age / CANISTER_BURST_MS, 0, 1);
      if (crack > 0) {
        noFill();
        stroke(220, 218, 210, 220 * crack);
        strokeWeight(6 * crack + 1);
        circle(0, 0, this.range * 1.6 * (1 - crack));
        noStroke();
      }

      // body of the cloud, low and dark, marking the ground it actually covers
      fill(78, 76, 72, 105 * density);
      circle(0, 0, this.curRange * 1.85);

      // the lobes, each drifting on its own clock — this is what makes the edge
      // ragged, and a ragged edge is what says "smoke" rather than "aura"
      for (const lobe of this._lobes) {
        const wobble = sin(churn * lobe.speed + lobe.phase);
        const d = this.curRange * lobe.radius * (0.85 + wobble * 0.18);
        const a = lobe.angle + churn * 0.08 * lobe.speed;
        const grey = 96 + lobe.shade * 78;
        fill(grey, grey - 3, grey - 8, (58 + lobe.shade * 45) * density);
        circle(cos(a) * d, sin(a) * d, this.curRange * lobe.size * (0.95 + wobble * 0.12));
      }

      // a pale crown riding on top, offset upward so the pile reads as having
      // height rather than being painted flat on the floor
      for (const lobe of this._lobes) {
        if (lobe.shade < 0.6) continue;
        const wobble = cos(churn * lobe.speed + lobe.phase);
        const d = this.curRange * lobe.radius * 0.7;
        const a = lobe.angle - churn * 0.05;
        fill(206, 204, 198, 46 * density);
        circle(cos(a) * d, sin(a) * d - this.curRange * 0.14, this.curRange * lobe.size * 0.6);
      }

      // the spent canister on the ground, still leaking — brass, because every
      // piece of Graves' kit is made of gun parts
      const jitter = sin(this.age / 40) * 0.6;
      fill(58, 52, 46, 200 * density);
      rect(-7, -3 + jitter, 14, 7, 2);
      fill(176, 138, 62, 220 * density);
      rect(-7, -3 + jitter, 5, 7, 2);

      pop();
    }

    getDisplayBoundingBox() {
      // lobes swing out past `range` and the crack ring further still
      const r = this.range * 1.8;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Graves_W_Object;
}
const __cacheGraves_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_W_Object>>();
export function makeGraves_W_Object(api: ContentApi) {
  const cached = __cacheGraves_W_Object.get(api);
  if (cached) return cached;
  const built = __buildGraves_W_Object(api);
  __cacheGraves_W_Object.set(api, built);
  return built;
}