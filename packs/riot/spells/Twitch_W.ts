import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Twitch_W = InstanceType<ReturnType<typeof makeTwitch_W>>;
type Twitch_W_Cask = InstanceType<ReturnType<typeof makeTwitch_W_Cask>>;
type Twitch_W_Object = InstanceType<ReturnType<typeof makeTwitch_W_Object>>;



export const MAX_RANGE = 450;

export const RADIUS = 160;

export const DURATION = 3000;

export const SLOW_PERCENT = 0.3;

export const POISON_PER_TICK = 3;

export const THROW_SPEED = 9;


function __buildTwitch_W(api: ContentApi) {
  const Spell = api.Spell;
  const Twitch_W_Cask = makeTwitch_W_Cask(api);
  class Twitch_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_twitch_w');
    name = 'Độc Suy Nhược (Twitch_W)';
    description =
      `Ném một bình độc bay tới vị trí chỉ định; <span class="damage">khi chạm đất</span> bình vỡ thành vũng` +
      ` bán kính <span>${RADIUS}px</span> trong <span class="time">${DURATION / 1000} giây</span>,` +
      ` <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> và <span class="damage">nhiễm độc</span> kẻ địch bước vào`;
    coolDown = 10000;
    manaCost = 30;

    maxRange = MAX_RANGE;

    onSpellCast() {
      const aim = this.aimPoint;
      const landing = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      // The flask flies; the puddle is what it leaves. Spawning the puddle at
      // cast time (which this used to do) meant the throw had no travel and no
      // tell — the gas simply existed, at range, the instant the key went down.
      const cask = new Twitch_W_Cask(this.owner);
      cask.destination = landing;
      this.game.objectManager.addObject(cask);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Twitch_W;
}
const __cacheTwitch_W = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_W>>();
export default function makeTwitch_W(api: ContentApi) {
  const cached = __cacheTwitch_W.get(api);
  if (cached) return cached;
  const built = __buildTwitch_W(api);
  __cacheTwitch_W.set(api, built);
  return built;
}


/**
 * The flask in flight. `maxHitCount = 0` on purpose: it is lobbed *over* the
 * fight and only matters where it lands, so a body between Twitch and the
 * chosen ground must not eat it.
 */
function __buildTwitch_W_Cask(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const Twitch_W_Object = makeTwitch_W_Object(api);
  class Twitch_W_Cask extends MissileSpellObject {
    speed = THROW_SPEED;
    size = 22;
    maxHitCount = 0;
    spin = 0;
    /** Distance the throw covers, fixed on the first frame — the arc reads off it. */
    totalDistance = 0;

    onAdded() {
      super.onAdded();
      this.totalDistance = Math.max(1, this.position.dist(this.destination));
    }

    onAfterMove() {
      this.spin += deltaTime / 90;
    }

    onArrive() {
      const puddle = new Twitch_W_Object(this.owner);
      puddle.position = this.destination.copy();
      this.game.objectManager.addObject(puddle);
    }

    /** How high the flask is riding right now, 0 at both ends. */
    _arcLift(): number {
      const travelled =
        1 - constrain(this.position.dist(this.destination) / this.totalDistance, 0, 1);
      return Math.sin(travelled * PI) * Math.min(60, this.totalDistance * 0.18);
    }

    draw() {
      const lift = this._arcLift();
      push();
      // shadow stays on the ground and shrinks as the flask climbs
      noStroke();
      fill(0, 0, 0, 70);
      ellipse(this.position.x, this.position.y, this.size * (1 - lift / 140), this.size * 0.5);

      translate(this.position.x, this.position.y - lift);
      rotate(this.spin);
      // the flask: a squat green bottle with a cork
      fill(110, 180, 70, 240);
      stroke(60, 110, 40, 240);
      strokeWeight(2);
      ellipse(0, 0, this.size, this.size * 0.9);
      noStroke();
      fill(200, 240, 150, 220);
      ellipse(-this.size * 0.18, -this.size * 0.18, this.size * 0.3, this.size * 0.22);
      fill(150, 110, 70, 240);
      rect(-this.size * 0.14, -this.size * 0.62, this.size * 0.28, this.size * 0.28, 2);
      pop();

      // a thin dribble of gas trailing the flask
      push();
      noStroke();
      for (let i = 1; i <= 3; i++) {
        fill(150, 220, 100, 90 / i);
        circle(this.position.x, this.position.y - lift + i * 5, (this.size * 0.5) / i);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.size,
        y: this.position.y - this.size - 70,
        w: this.size * 2,
        h: this.size * 2 + 70,
        data: this,
      });
    }
  }
  return Twitch_W_Cask;
}
const __cacheTwitch_W_Cask = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_W_Cask>>();
export function makeTwitch_W_Cask(api: ContentApi) {
  const cached = __cacheTwitch_W_Cask.get(api);
  if (cached) return cached;
  const built = __buildTwitch_W_Cask(api);
  __cacheTwitch_W_Cask.set(api, built);
  return built;
}


function __buildTwitch_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const DamageOverTime = api.buffs.DamageOverTime;
  const Slow = api.buffs.Slow;
  class Twitch_W_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    sinceTick = 0;
    seed = Math.random() * Math.PI * 2;

    update() {
      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (this.sinceTick < 400) return;
      this.sinceTick -= 400;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        const slow = new Slow(700, this.owner, enemy);
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);

        // Its own stack slot: Twitch's E reads this poison, and it must not be
        // confused with a burn some other spell left on the same victim.
        const poison = new DamageOverTime(1600, this.owner, enemy);
        poison.stackId = 'twitch_poison';
        poison.name = 'Nhiễm Độc';
        poison.damagePerTick = POISON_PER_TICK;
        poison.tickInterval = 400;
        poison.flameColor = [190, 255, 120];
        poison.emberColor = [40, 120, 30];
        enemy.addBuff(poison);
      });
    }

    draw() {
      const t = this.age / this.lifeTime;
      const fade = t > 0.8 ? (1 - t) / 0.2 : 1;
      // the splash on the first frames, so landing is a visible event
      const splash = constrain(1 - t * 8, 0, 1);

      push();
      translate(this.position.x, this.position.y);
      noStroke();
      fill(120, 200, 70, 55 * fade);
      circle(0, 0, this.radius * 2 * Math.min(1, 0.35 + t * 8));

      // low, boiling gas: overlapping blobs on their own clocks
      for (let i = 0; i < 9; i++) {
        const a = this.seed + (i / 9) * TWO_PI + this.age / 900;
        const d = this.radius * (0.3 + 0.5 * Math.abs(Math.sin(this.age / 400 + i)));
        fill(150, 230, 90, 110 * fade);
        circle(cos(a) * d, sin(a) * d, 30 + 8 * Math.sin(this.age / 200 + i));
      }

      if (splash > 0) {
        noFill();
        stroke(220, 255, 180, 240 * splash);
        strokeWeight(6 * splash + 1);
        circle(0, 0, this.radius * 2 * (0.4 + 0.6 * (1 - splash)));
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.radius * 2);
    }
  }
  return Twitch_W_Object;
}
const __cacheTwitch_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_W_Object>>();
export function makeTwitch_W_Object(api: ContentApi) {
  const cached = __cacheTwitch_W_Object.get(api);
  if (cached) return cached;
  const built = __buildTwitch_W_Object(api);
  __cacheTwitch_W_Object.set(api, built);
  return built;
}