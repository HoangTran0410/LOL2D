import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Zed_E = InstanceType<ReturnType<typeof makeZed_E>>;
type Zed_E_Object = InstanceType<ReturnType<typeof makeZed_E_Object>>;



function __buildZed_E(api: ContentApi) {
  const Spell = api.Spell;
  const Zed_E_Object = makeZed_E_Object(api);
  class Zed_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_zed_e');
    name = 'Đường Kiếm Bóng Tối (Zed_E)';
    description =
      'Xoay lưỡi kiếm xung quanh bản thân. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm chậm 30%</span> các kẻ địch trong <span class="time">1 giây</span>';
    coolDown = 1000;
    manaCost = 10;

    onSpellCast() {
      const obj = new Zed_E_Object(this.owner);
      // the blade sweeps around Zed's body, so it goes when the body does
      obj.attachTo(this.owner);
      this.game.objectManager.addObject(obj);
    }
  }
  return Zed_E;
}
const __cacheZed_E = new WeakMap<ContentApi, ReturnType<typeof __buildZed_E>>();
export default function makeZed_E(api: ContentApi) {
  const cached = __cacheZed_E.get(api);
  if (cached) return cached;
  const built = __buildZed_E(api);
  __cacheZed_E.set(api, built);
  return built;
}


function __buildZed_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Slow = api.buffs.Slow;
  const ParticleSystem = api.helpers.ParticleSystem;
  const SpellObject = api.SpellObject;
  class Zed_E_Object extends SpellObject {
    angle = 0;
    angleSpeed = 0.5;
    radius = 100;
    damage = 15;
    slowPercent = 0.3;
    slowDuration = 1000;

    /** Hit once each, as the blade sweeps past them. */
    playersEffected: any[] = [];

    particleSystem = new ParticleSystem({
      getParticlePosFn: (p: any) => p.position,
      getParticleSizeFn: () => 10,
      isDeadFn: (p: any) => p.lifeSpan <= 0,
      updateFn: (p: any) => {
        p.position.add(p.velocity);
        p.lifeSpan -= deltaTime;
      },
      drawFn: (p: any) => {
        const alpha = map(p.lifeSpan, 0, p.lifeTime, 100, 255);
        stroke(255, 234, 79, alpha);
        strokeWeight(random(3, 8));
        const len = p.velocity.copy().setMag(random(5, 10));
        line(p.position.x, p.position.y, p.position.x + len.x, p.position.y + len.y);
      },
    });

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
    }

    onRemoved() {}

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.position.set(this.owner.position.x, this.owner.position.y);

      this.angle += this.angleSpeed;
      if (this.angle > 2 * Math.PI) {
        this.toRemove = true;
        return;
      }

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.radius,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playersEffected),
        ],
      });

      for (const enemy of enemies) {
        const bearing = Math.atan2(
          enemy.position.y - this.position.y,
          enemy.position.x - this.position.x
        );

        // the blade is a bar through the centre, so both ends sweep at once —
        // fold the difference into [0, PI/2] and hit whichever end arrives
        let delta = Math.abs(((this.angle - bearing + Math.PI) % (2 * Math.PI)) - Math.PI);
        delta = Math.min(delta, Math.PI - delta);
        // wide enough that a bearing can never slip between two frames' angles
        if (delta > this.angleSpeed) continue;

        enemy.takeDamage(this.damage, this.owner);

        const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
        slowBuff.percent = this.slowPercent;
        enemy.addBuff(slowBuff);

        this.playersEffected.push(enemy);
        this.particleSystem.addParticle({
          position: enemy.position.copy(),
          velocity: p5.Vector.fromAngle(bearing).mult(random(1, 3)),
          lifeSpan: 300,
          lifeTime: 300,
        });
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      // The shuriken sweeps as a *bar through the centre* — both ends land at
      // once, which is what `update` actually tests. A plain grey rectangle said
      // none of that; these are the two arcs the two ends are cutting.
      noFill();
      for (let i = 1; i <= 4; i++) {
        const trail = this.angle - i * 0.22;
        stroke(190, 90, 230, 150 - i * 30);
        strokeWeight(6 - i);
        arc(0, 0, this.radius * 2, this.radius * 2, trail - 0.22, trail);
        arc(0, 0, this.radius * 2, this.radius * 2, trail - 0.22 + PI, trail + PI);
      }

      rotate(this.angle);

      // the blade itself: a dark bar with a lit leading edge at each end
      noStroke();
      fill(45, 25, 70, 230);
      rect(-this.radius, -6, this.radius * 2, 12, 6);
      fill(215, 150, 255, 245);
      rect(-this.radius, -6, this.radius * 2, 3, 3);
      // the two cutting tips
      fill(240, 220, 255);
      triangle(this.radius - 16, -9, this.radius + 6, 0, this.radius - 16, 9);
      triangle(-this.radius + 16, -9, -this.radius - 6, 0, -this.radius + 16, 9);
      // the hub it spins on
      fill(120, 60, 170, 220);
      circle(0, 0, 16);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(this.radius * 2);
    }
  }
  return Zed_E_Object;
}
const __cacheZed_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZed_E_Object>>();
export function makeZed_E_Object(api: ContentApi) {
  const cached = __cacheZed_E_Object.get(api);
  if (cached) return cached;
  const built = __buildZed_E_Object(api);
  __cacheZed_E_Object.set(api, built);
  return built;
}