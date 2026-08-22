import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Ground = InstanceType<ContentApi['buffs']['Ground']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Cassiopeia_W = InstanceType<ReturnType<typeof makeCassiopeia_W>>;
type Cassiopeia_W_Object = InstanceType<ReturnType<typeof makeCassiopeia_W_Object>>;



/**
 * Miasma. The real ability never silences — it lays down a lingering venom
 * field that POISONS, slows, and GROUNDS everything inside, so the victim can
 * walk out but cannot dash or blink out.
 */
function __buildCassiopeia_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Cassiopeia_W_Object = makeCassiopeia_W_Object(api);
  class Cassiopeia_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_cassiopeia_w');
    name = 'Chướng Khí (Cassiopeia_W)';
    description =
      'Phun ra một đám mây độc tồn tại <span class="time">5 giây</span>. Kẻ địch bên trong nhiễm độc, mất <span class="damage">2 sát thương</span> mỗi <span class="time">0.4 giây</span>, bị <span class="buff">Làm Chậm</span> (giảm dần từ 50% theo thời gian tồn tại của bãi độc) và bị <span class="buff">Ghìm</span> — vẫn đi được nhưng không thể dùng kỹ năng lướt hay dịch chuyển để thoát ra';
    coolDown = 10000;
    manaCost = 40;

    castRange = 320;
    radius = 100;
    duration = 5000;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.castRange
      );

      const obj = new Cassiopeia_W_Object(this.owner);
      obj.position = to;
      obj.radius = this.radius;
      obj.lifeTime = this.duration;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.castRange);
    }
  }
  return Cassiopeia_W;
}
const __cacheCassiopeia_W = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_W>>();
export default function makeCassiopeia_W(api: ContentApi) {
  const cached = __cacheCassiopeia_W.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_W(api);
  __cacheCassiopeia_W.set(api, built);
  return built;
}


interface VenomCloud {
  angle: number;
  distance: number;
  spin: number;
  size: number;
  phase: number;
}


const CLOUD_COUNT = 14;


function __buildCassiopeia_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const DamageOverTime = api.buffs.DamageOverTime;
  const Ground = api.buffs.Ground;
  const Slow = api.buffs.Slow;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Cassiopeia_W_Object extends SpellObject {
    image = api.asset('spell_cassiopeia_w');
    position: p5.Vector = this.owner.position.copy();

    /** A pool of venom on the floor: painted under the units wading through it. */
    zIndex = GROUND_Z_INDEX;

    radius = 100;
    lifeTime = 5000;
    age = 0;
    fadeTime = 500;

    damagePerTick = 2;
    tickInterval = 400;
    poisonDuration = 800;

    /** The slow decays over the field's lifetime, as it does in game. */
    slowPercentStart = 0.5;
    slowPercentEnd = 0.15;

    /** Buffs are refreshed on a tick instead of every frame to avoid per-frame garbage. */
    reapplyInterval = 200;
    /** Slow and ground linger a beat after stepping out of the cloud. */
    debuffLinger = 250;

    _timeSinceReapply = this.reapplyInterval; // so the field bites the very first frame
    _clouds: VenomCloud[] = [];

    onAdded() {
      for (let i = 0; i < CLOUD_COUNT; i++) {
        this._clouds.push({
          angle: (TWO_PI * i) / CLOUD_COUNT + random(-0.3, 0.3),
          distance: random(this.radius * 0.15, this.radius * 0.8),
          spin: random(0.0002, 0.0007) * (random() < 0.5 ? -1 : 1),
          size: random(this.radius * 0.4, this.radius * 0.75),
          phase: random(TWO_PI),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      this._timeSinceReapply += deltaTime;
      if (this._timeSinceReapply >= this.reapplyInterval) {
        this._timeSinceReapply = 0;
        this._poisonEnemiesInside();
      }

      for (const cloud of this._clouds) {
        cloud.angle += cloud.spin * deltaTime;
      }
    }

    _currentSlowPercent() {
      const t = Math.min(1, this.age / this.lifeTime);
      return this.slowPercentStart + (this.slowPercentEnd - this.slowPercentStart) * t;
    }

    _poisonEnemiesInside() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.radius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      const controlDuration = this.reapplyInterval + this.debuffLinger;
      const slowPercent = this._currentSlowPercent();

      enemies.forEach((enemy: any) => {
        // DamageOverTime renews by default, so standing in the cloud only pushes the
        // remaining duration back instead of restarting the damage ticks
        const poisonBuff = new DamageOverTime(this.poisonDuration, this.owner, enemy);
        poisonBuff.stackId = 'cassiopeia_w_poison';
        poisonBuff.image = this.image;
        poisonBuff.name = 'Nhiễm Độc';
        poisonBuff.damagePerTick = this.damagePerTick;
        poisonBuff.tickInterval = this.tickInterval;
        poisonBuff.flameColor = [150, 255, 120];
        poisonBuff.emberColor = [30, 110, 40];
        enemy.addBuff(poisonBuff);

        const slowBuff = new Slow(controlDuration, this.owner, enemy);
        slowBuff.image = this.image;
        slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        slowBuff.percent = slowPercent;
        enemy.addBuff(slowBuff);

        // Miasma grounds, it does not silence: casting still works, escaping does not
        const groundBuff = new Ground(controlDuration, this.owner, enemy);
        groundBuff.image = this.image;
        enemy.addBuff(groundBuff);
      });
    }

    _getOpacity() {
      if (this.age < 250) return this.age / 250;
      if (this.age > this.lifeTime - this.fadeTime) {
        return map(this.age, this.lifeTime - this.fadeTime, this.lifeTime, 1, 0);
      }
      return 1;
    }

    draw() {
      const opacity = this._getOpacity();
      const left = constrain(1 - this.age / this.lifeTime, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // dark base so the cloud reads as a hole of venom on the ground
      noStroke();
      fill(38, 16, 52, 150 * opacity);
      circle(0, 0, this.radius * 2);
      fill(70, 130, 45, 90 * opacity);
      circle(0, 0, this.radius * 1.7);

      // slowly churning puffs of gas
      for (const cloud of this._clouds) {
        const breathe = 1 + 0.15 * sin(this.age / 350 + cloud.phase);
        const x = cos(cloud.angle) * cloud.distance;
        const y = sin(cloud.angle) * cloud.distance;

        fill(105, 45, 145, 70 * opacity);
        circle(x, y, cloud.size * breathe);
        fill(150, 235, 110, 65 * opacity);
        circle(x, y, cloud.size * breathe * 0.55);
        fill(215, 255, 175, 55 * opacity);
        circle(x, y, cloud.size * breathe * 0.22);
      }

      // scalloped boundary: a hard, unmistakable line around the venom
      const lobes = 22;
      noFill();
      stroke(25, 10, 38, 220 * opacity);
      strokeWeight(7);
      beginShape();
      for (let i = 0; i <= lobes; i++) {
        const a = (TWO_PI * i) / lobes;
        const r = this.radius * (1 + 0.045 * sin(i * 3 + this.age / 700));
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape(CLOSE);
      stroke(175, 255, 130, 240 * opacity);
      strokeWeight(3);
      beginShape();
      for (let i = 0; i <= lobes; i++) {
        const a = (TWO_PI * i) / lobes;
        const r = this.radius * (1 + 0.045 * sin(i * 3 + this.age / 700));
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape(CLOSE);

      // how much venom is left, read off the rim
      stroke(220, 255, 190, 200 * opacity);
      strokeWeight(5);
      arc(0, 0, this.radius * 2 + 12, this.radius * 2 + 12, -HALF_PI, -HALF_PI + TWO_PI * left);

      // tendrils curling in off the edge: the grounding, made visible
      noFill();
      for (let i = 0; i < 10; i++) {
        const a = (TWO_PI * i) / 10 + this.age / 2200;
        const wave = sin(this.age / 600 + i) * 0.12;
        for (const [col, weight] of [
          [[35, 12, 55, 190 * opacity], 7],
          [[200, 150, 245, 220 * opacity], 3],
        ] as [number[], number][]) {
          (stroke as any)(...col);
          strokeWeight(weight);
          beginShape();
          for (let k = 0; k <= 6; k++) {
            const u = k / 6;
            // spiralling inwards and tightening: a tentacle, not a dash
            const ang = a + u * (0.75 + wave);
            const rr = this.radius * (1.02 - u * 0.45);
            vertex(cos(ang) * rr, sin(ang) * rr);
          }
          endShape();
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 20; // the duration arc sits outside the rim
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Cassiopeia_W_Object;
}
const __cacheCassiopeia_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_W_Object>>();
export function makeCassiopeia_W_Object(api: ContentApi) {
  const cached = __cacheCassiopeia_W_Object.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_W_Object(api);
  __cacheCassiopeia_W_Object.set(api, built);
  return built;
}