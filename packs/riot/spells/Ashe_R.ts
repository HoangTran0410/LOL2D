import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ashe_R = InstanceType<ReturnType<typeof makeAshe_R>>;
type Ashe_R_Object = InstanceType<ReturnType<typeof makeAshe_R_Object>>;



export const SIZE = 35;

export const DAMAGE = 30;

export const EXPLODE_RADIUS = 250;

export const EXPLODE_ANIMATION_MS = 1_000;


/**
 * `docs/abilities/ashe/r.json`: range **Global**, speed 1500 rising to 2100,
 * stun 1s rising to 3.5s with the distance travelled, and it shatters on an
 * enemy *champion* — a lane full of minions is not what stops it.
 *
 * The previous version fizzled at 2400px and stunned for a flat 2.5s, which
 * made it a long poke rather than the ultimate the whole champion is known
 * for: the shot you take from your own jungle at a fight on the other side of
 * the map.
 */
export const SPEED = 14;

export const MAX_SPEED = 26;

/** Distance over which the arrow reaches full speed and full stun. */
export const FULL_POWER_DISTANCE = 2_000;

export const MIN_STUN_MS = 1_000;

export const MAX_STUN_MS = 3_500;

/** Not a range limit — a leash on the object, so a shot into empty map is collected. */
export const MAX_TRAVEL = 12_000;


function __buildAshe_R(api: ContentApi) {
  const Spell = api.Spell;
  const Ashe_R_Object = makeAshe_R_Object(api);
  class Ashe_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ashe_r');
    name = 'Đại Băng Tiễn (Ashe_R)';
    description =
      `Bắn mũi tên băng <span class="buff">bay khắp bản đồ</span>, chỉ vỡ khi trúng <span class="damage">tướng địch</span>` +
      ` (đi xuyên qua lính). Bay càng xa càng nhanh và càng mạnh:` +
      ` <span class="buff">Làm Choáng</span> từ <span class="time">${MIN_STUN_MS / 1000}</span> tới` +
      ` <span class="time">${MAX_STUN_MS / 1000} giây</span> theo quãng đường, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span> cho mục tiêu và mọi kẻ địch xung quanh`;
    coolDown = 10000;
    manaCost = 80;

    onSpellCast() {
      const toAim = p5.Vector.sub(this.aimPoint, this.owner.position);
      // A cursor sitting exactly on the caster — a stationary AI's resting aim
      // (idle bots never move, so `destination` equals `position`), or a player
      // who has not moved the mouse since spawning — subtracts to a zero vector.
      // p5's normalize() leaves a zero vector unchanged instead of throwing, so
      // the arrow would silently get a (0, 0) direction and never leave the spot
      // it spawned on. Fall back to an arbitrary heading instead of stalling.
      const direction = toAim.magSq() === 0 ? p5.Vector.random2D() : toAim.normalize();

      const obj = new Ashe_R_Object(this.owner);
      obj.position = this.owner.position.copy();
      obj.direction = direction;

      this.game.objectManager.addObject(obj);
    }
  }
  return Ashe_R;
}
const __cacheAshe_R = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_R>>();
export default function makeAshe_R(api: ContentApi) {
  const cached = __cacheAshe_R.get(api);
  if (cached) return cached;
  const built = __buildAshe_R(api);
  __cacheAshe_R.set(api, built);
  return built;
}


function __buildAshe_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Stun = api.buffs.Stun;
  const TrailSystem = api.helpers.TrailSystem;
  const acceleratedSpeed = api.combat.GlobalShot.acceleratedSpeed;
  const enemyChampionsOnly = api.combat.GlobalShot.enemyChampionsOnly;
  const travelRamp = api.combat.GlobalShot.travelRamp;
  class Ashe_R_Object extends SpellObject {
    isMissile = true;
    speed = SPEED;
    size = SIZE;
    /** Travelled distance, in world units — the arrow expires at RANGE, not on a timer. */
    distanceTravelled = 0;

    explodeSize = EXPLODE_RADIUS;
    exploding = false;
    /** Elapsed time since the explosion started, drives the fade-out only. */
    explodeAge = 0;

    trailSystem = new TrailSystem({
      trailSize: this.size / 1.5,
      trailColor: [100, 100, 200, 50] as any,
    });

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
    }

    update() {
      // moving phase
      if (!this.exploding) {
        this.speed = acceleratedSpeed(this.distanceTravelled, SPEED, MAX_SPEED, FULL_POWER_DISTANCE);
        this.position.add(this.direction.copy().mult(this.speed));
        this.distanceTravelled += this.speed;
        this.trailSystem.addTrail(this.position);

        // Not a range: the arrow is global. This only collects a shot fired into
        // empty map so the object does not live forever.
        if (this.distanceTravelled >= MAX_TRAVEL) {
          this.toRemove = true;
          return;
        }

        // Enemy champions only — it flies straight through a minion wave.
        let enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: this.size / 4,
          }),
          filters: enemyChampionsOnly(this.owner.teamId),
        });

        if (enemies?.length > 0) {
          this.exploding = true;
          this.isMissile = false;

          // add buff to enemies
          let enemiesInRange = this.game.objectManager.queryObjects({
            area: new Circle({
              x: this.position.x,
              y: this.position.y,
              r: this.explodeSize / 2,
            }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
          });
          // The stun the flight earned, paid to everyone the shatter catches.
          const stunMs =
            MIN_STUN_MS +
            (MAX_STUN_MS - MIN_STUN_MS) * travelRamp(this.distanceTravelled, FULL_POWER_DISTANCE);
          enemiesInRange.forEach((p: any) => {
            let stunBuff = new Stun(stunMs, this.owner, p);
            stunBuff.buffAddType = BuffAddType.RENEW_EXISTING;
            p.addBuff(stunBuff);
            p.takeDamage(DAMAGE, this.owner);
          });

          this.visionRadius = this.explodeSize;
        }
      }

      // explode phase
      else {
        this.explodeAge += deltaTime;
        this.size = lerp(this.size, this.explodeSize, 0.2);
        if (this.explodeAge > EXPLODE_ANIMATION_MS) {
          this.toRemove = true;
        }
      }
    }

    draw() {
      push();

      // explode
      if (this.exploding) {
        let alpha = Math.min(EXPLODE_ANIMATION_MS - this.explodeAge, 150);

        stroke(200, alpha);
        fill(100, 100, 200, alpha);
        circle(this.position.x, this.position.y, this.size);

        fill(200, alpha);
        for (let i = 0; i < 5; i++) {
          let randPos = p5.Vector.random2D().mult(random(this.size / 2));
          circle(this.position.x + randPos.x, this.position.y + randPos.y, random(10, 20));
        }
      }

      // moving
      else {
        translate(this.position.x, this.position.y);
        rotate(this.direction.heading());

        stroke(random(100, 255));
        fill(50, 50, 200);
        rect(-60, -10, 30, 20);
        triangle(
          this._randSize(),
          0,
          -this._randSize(),
          -this._randSize() / 2,
          -this._randSize(),
          this._randSize() / 2
        );
      }
      pop();
    }

    _randSize() {
      return random(this.size / 1.5, this.size * 1.5);
    }

    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.size / 2,
        y: this.position.y - this.size / 2,
        w: this.size,
        h: this.size,
        data: this,
      });
    }
  }
  return Ashe_R_Object;
}
const __cacheAshe_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_R_Object>>();
export function makeAshe_R_Object(api: ContentApi) {
  const cached = __cacheAshe_R_Object.get(api);
  if (cached) return cached;
  const built = __buildAshe_R_Object(api);
  __cacheAshe_R_Object.set(api, built);
  return built;
}