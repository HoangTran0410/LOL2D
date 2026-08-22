import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Zed_Q = InstanceType<ReturnType<typeof makeZed_Q>>;
type Zed_Q_Object = InstanceType<ReturnType<typeof makeZed_Q_Object>>;



function __buildZed_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Zed_Q_Object = makeZed_Q_Object(api);
  class Zed_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_zed_q');
    name = 'Phi Tiêu Sắc Lẻm (Zed_Q)';
    description =
      'Phóng 1 phi tiêu về phía trước, gây <span class="damage">15 sát thương</span> và <span class="buff">làm chậm 50%</span> trong <span class="time">0.2 giây</span> cho mỗi kẻ địch bị xuyên qua.';
    coolDown = 3000;
    manaCost = 30;

    maxThrowRange = 350;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.maxThrowRange
      );

      const shuriken = new Zed_Q_Object(this.owner);
      shuriken.destination = to;
      shuriken.position = from;
      shuriken.speed = 8.5;
      shuriken.damage = 15;
      this.game.objectManager.addObject(shuriken);
    }

    onUpdate() {}
  }
  return Zed_Q;
}
const __cacheZed_Q = new WeakMap<ContentApi, ReturnType<typeof __buildZed_Q>>();
export default function makeZed_Q(api: ContentApi) {
  const cached = __cacheZed_Q.get(api);
  if (cached) return cached;
  const built = __buildZed_Q(api);
  __cacheZed_Q.set(api, built);
  return built;
}


function __buildZed_Q_Object(api: ContentApi) {
  const ParticleSystem = api.helpers.ParticleSystem;
  const TrailSystem = api.helpers.TrailSystem;
  const Slow = api.buffs.Slow;
  const MissileSpellObject = api.MissileSpellObject;
  class Zed_Q_Object extends MissileSpellObject {
    angle = 0;
    speed = 11;
    rotateSpeed = -0.5;
    size = 40;
    damage = 20;
    color: [number, number, number] = [205, 102, 147];

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

    onBeforeMove() {
      this.angle += this.rotateSpeed;
    }

    getTrailPosition() {
      return this.position.copy().add(p5.Vector.fromAngle(this.angle).mult(5));
    }

    onHit(enemy: any) {
      const slowBuff = new Slow(200, this.owner, enemy);
      slowBuff.percent = 0.5;
      enemy.addBuff(slowBuff);

      enemy.takeDamage(this.damage, this.owner);
      this.particleSystem.addParticle({
        position: enemy.position,
        size: enemy.stats.size.value + 20,
        age: 0,
      });
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      stroke('#111a');
      strokeWeight(3);
      const alpha = Math.min(255, this.position.dist(this.destination) + 50);
      (fill as any)(...(this.color as [number, number, number]), alpha);

      const shape: [number, number][] = [
        [0, -25],
        [0, 0],
        [25, -25],
        [25, 0],
        [0, 0],
        [26, 25],
        [0, 25],
        [0, 0],
        [-25, 25],
        [-25, 0],
        [0, 0],
        [-25, -25],
      ];
      beginShape();
      shape.forEach(([x, y]) => vertex(x, y));
      endShape(CLOSE);

      pop();
    }
  }
  return Zed_Q_Object;
}
const __cacheZed_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZed_Q_Object>>();
export function makeZed_Q_Object(api: ContentApi) {
  const cached = __cacheZed_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildZed_Q_Object(api);
  __cacheZed_Q_Object.set(api, built);
  return built;
}