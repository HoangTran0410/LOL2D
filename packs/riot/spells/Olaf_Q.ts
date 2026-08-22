import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Olaf_Q = InstanceType<ReturnType<typeof makeOlaf_Q>>;
type Olaf_Q_Object = InstanceType<ReturnType<typeof makeOlaf_Q_Object>>;



function __buildOlaf_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Olaf_Q_Object = makeOlaf_Q_Object(api);
  class Olaf_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_olaf_q');
    name = 'Phóng Rìu (Olaf_Q)';
    description =
      'Ném rìu đến điểm chỉ định, gây <span class="damage">15 sát thương</span> và <span class="buff">Làm chậm 40%</span> trong <span class="time">1 giây</span> cho những kẻ địch trúng chiêu. Bạn được <span class="buff">Tăng Tốc 30%</span> trong <span class="time">1 giây</span> cho mỗi kẻ địch trúng chiêu. Rìu tồn tại trong <span class="time">4 giây</span>, nếu nhặt được rìu <span>thời gian hồi chiêu</span> được <span class="buff">Giảm 60%</span>.';
    coolDown = 7500;
    manaCost = 30;

    maxThrowRange = 350;
    axeLifeTime = 4000;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.maxThrowRange
      );

      const axe = new Olaf_Q_Object(this.owner);
      axe.destination = to;
      axe.position = from;
      axe.initialAngle = to.copy().sub(from).heading();
      axe.speed = 8.5;
      axe.waitForPickUpLifeTime = this.axeLifeTime;
      axe.damage = 15;
      axe.spellSource = this;
      this.game.objectManager.addObject(axe);
    }

    drawPreview() {
      super.drawPreview(this.maxThrowRange);
    }
  }
  return Olaf_Q;
}
const __cacheOlaf_Q = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_Q>>();
export default function makeOlaf_Q(api: ContentApi) {
  const cached = __cacheOlaf_Q.get(api);
  if (cached) return cached;
  const built = __buildOlaf_Q(api);
  __cacheOlaf_Q.set(api, built);
  return built;
}


function __buildOlaf_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const ParticleSystem = api.helpers.ParticleSystem;
  const TrailSystem = api.helpers.TrailSystem;
  const Slow = api.buffs.Slow;
  const Speedup = api.buffs.Speedup;
  const MissileSpellObject = api.MissileSpellObject;
  class Olaf_Q_Object extends MissileSpellObject {
    spellSource: Olaf_Q | null = null;
    angle = 0;
    initialAngle = 0;
    speed = 10;
    rotateSpeed = 0.25;
    size = 40;
    pickupRange = 100;
    timeSinceReachedDestination = 0;
    waitForPickUpLifeTime = 5000;
    damage = 15;
    color: [number, number, number] = [2, 151, 177];
    // the axe lands and waits to be picked up instead of vanishing at max range
    removeOnArrive = false;

    static PHASES = {
      FLYING: 'FLYING',
      WAIT_FOR_PICK_UP: 'WAIT_FOR_PICK_UP',
    };

    phase: string = Olaf_Q_Object.PHASES.FLYING;

    trailSystem = new TrailSystem({
      trailSize: this.size,
      trailColor: [...this.color, 100] as any,
    });
    particleSystem = new ParticleSystem({
      getParticlePosFn: (p: any) => p.position,
      getParticleSizeFn: (p: any) => p.size,
      isDeadFn: (p: any) => p.age > 1000,
      updateFn: (p: any) => {
        p.size += 1;
        p.age += deltaTime;
      },
      drawFn: (p: any) => {
        const alpha = map(p.age, 0, 1000, 200, 0);
        stroke(200, alpha + 10);
        (fill as any)(...(this.color as [number, number, number]), alpha);
        circle(p.position.x, p.position.y, p.size);
      },
    });

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
    }

    get willRotateRight() {
      return this.initialAngle > -PI / 2 && this.initialAngle < PI / 2;
    }

    onBeforeMove() {
      if (this.willRotateRight) this.angle += this.rotateSpeed;
      else this.angle -= this.rotateSpeed;
    }

    getTrailPosition() {
      return this.position.copy().add(p5.Vector.fromAngle(this.angle).mult(this.size / 2));
    }

    onArrive() {
      this.phase = Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP;
      this.isMissile = false;
    }

    onHit(enemy: any) {
      const slowBuff = new Slow(1000, this.owner, enemy);
      slowBuff.percent = 0.4;
      enemy.addBuff(slowBuff);
      enemy.takeDamage(this.damage, this.owner);

      this.particleSystem.addParticle({
        position: enemy.position,
        size: enemy.stats.size.value + 20,
        age: 0,
      });
    }

    checkCollision() {
      const hitCountBefore = this.hitTargets.length;
      super.checkCollision();

      // one speed-up stack per pass-through, however many enemies it caught
      if (this.hitTargets.length > hitCountBefore) {
        const speedUpBuff = new Speedup(1000, this.owner, this.owner);
        speedUpBuff.maxStacks = 3;
        speedUpBuff.image = api.asset('spell_olaf_q');
        speedUpBuff.percent = 0.3;
        this.owner.addBuff(speedUpBuff);
      }
    }

    update() {
      if (this.phase === Olaf_Q_Object.PHASES.FLYING) {
        super.update();
        return;
      }

      this.timeSinceReachedDestination += deltaTime;
      if (this.timeSinceReachedDestination >= this.waitForPickUpLifeTime) {
        this.toRemove = true;
      }

      if (this.owner.position.dist(this.position) < this.owner.stats.size.value / 2 + this.size / 2) {
        if (this.spellSource) {
          this.spellSource.currentCooldown *= 0.4;
        }
        this.toRemove = true;
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      stroke('#eeea');
      strokeWeight(3);
      (fill as any)(...(this.color as [number, number, number]), 200);

      let shape: [number, number][] = [
        [-45, -10],
        [-10, -5],
        [30, -10],
        [35, 20],
        [0, 20],
        [10, 0],
        [-45, 0],
      ];
      if (!this.willRotateRight) shape = shape.map(([x, y]) => [-x, y]);
      beginShape();
      shape.forEach(([x, y]) => vertex(x, y));
      endShape(CLOSE);

      pop();

      if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
        push();
        noFill();
        stroke(200, 100);
        const arcLength = map(
          this.timeSinceReachedDestination,
          0,
          this.waitForPickUpLifeTime,
          2 * PI,
          0
        );
        arc(this.position.x, this.position.y, this.pickupRange, this.pickupRange, 0, arcLength);
        pop();
      }
    }

    // sized to the pickup radius so the axe stays visible while waiting on the ground
    getDisplayBoundingBox() {
      return new Rectangle({
        x: this.position.x - this.pickupRange / 2,
        y: this.position.y - this.pickupRange / 2,
        w: this.pickupRange,
        h: this.pickupRange,
        data: this,
      });
    }
  }
  return Olaf_Q_Object;
}
const __cacheOlaf_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_Q_Object>>();
export function makeOlaf_Q_Object(api: ContentApi) {
  const cached = __cacheOlaf_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildOlaf_Q_Object(api);
  __cacheOlaf_Q_Object.set(api, built);
  return built;
}