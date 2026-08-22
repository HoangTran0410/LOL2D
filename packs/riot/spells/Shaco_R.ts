import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeShaco_W_Box } from './Shaco_W';
import { ATTACK_DAMAGE, ATTACK_RANGE } from './Shaco_W';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Pet = InstanceType<ContentApi['units']['Pet']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Shaco_R = InstanceType<ReturnType<typeof makeShaco_R>>;
type Shaco_R_Clone = InstanceType<ReturnType<typeof makeShaco_R_Clone>>;
type Shaco_W_Box = InstanceType<ReturnType<typeof makeShaco_W_Box>>;



function __buildShaco_R(api: ContentApi) {
  const Spell = api.Spell;
  const Shaco_R_Clone = makeShaco_R_Clone(api);
  class Shaco_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_shaco_r');
    name = 'Phân Thân (Shaco_R)';
    description =
      'Tạo ra một <span>phân thân</span> tồn tại trong <span class="time">10 giây</span>. Tái kích hoạt để điều khiển phân thân di chuyển. Khi chết, nó phát nổ, gây <span class="damage">30 sát thương</span> và gây <span class="buff">Hoảng Sợ</span> các kẻ địch xunh quanh trong <span class="time">1 giây</span> và để lại <span>3 Hộp Hề Ma Quái</span> nhỏ';
    coolDown = 10000;
    manaCost = 80;

    clonePlayer: Shaco_R_Clone | null = null;
    cloneLifeTime = 10000;
    maxRange = 1000;

    checkCastCondition() {
      if (this.clonePlayer) {
        // move clone to mouse position
        const aim = this.aimPoint;
        // `commandTo`, not `moveTo`: it routes around walls and it outranks the
        // clone's own target scan, which would otherwise overwrite the order.
        this.clonePlayer.commandTo(aim);

        return false;
      }

      return true;
    }

    onSpellCast() {
      const clone = new Shaco_R_Clone({
        game: this.game,
        position: this.owner.position.copy(),
        avatar: this.owner.avatar,
        teamId: this.owner.teamId,
        ownerUnit: this.owner,
        lifeTimeMs: this.cloneLifeTime,
        // Steered by the recast, so it must not walk itself back to Shaco.
        followsOwner: false,
      });
      clone.replaceSpells([]);
      clone.shacoR_maxRange = this.maxRange;
      const aim = this.aimPoint;
      clone.moveTo(aim.x, aim.y);
      this.game.objectManager.addObject(clone);

      this.clonePlayer = clone;
      this.image = api.asset('spell_shaco_r2');
      this.resetCoolDown();
    }

    onUpdate() {
      if (this.clonePlayer?.toRemove) {
        this.clonePlayer = null;
        this.image = api.asset('spell_shaco_r');
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }
  }
  return Shaco_R;
}
const __cacheShaco_R = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_R>>();
export default function makeShaco_R(api: ContentApi) {
  const cached = __cacheShaco_R.get(api);
  if (cached) return cached;
  const built = __buildShaco_R(api);
  __cacheShaco_R.set(api, built);
  return built;
}


/**
 * Hallucinate's clone. A `Pet` rather than a plain `Champion` since the pet
 * system landed: it now picks its own fights and swings at whatever is nearest
 * (which is what made the real Shaco's clone worth casting — it was inert art
 * that walked around), while the recast keeps steering it, and it dies with
 * Shaco like every other summon.
 */
function __buildShaco_R_Clone(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Pet = api.units.Pet;
  const Fear = api.buffs.Fear;
  const ParticleSystem = api.helpers.ParticleSystem;
  const Shaco_W_Box = makeShaco_W_Box(api);
  class Shaco_R_Clone extends Pet {
    shacoR_maxRange = 1000;

    /** The clone is a copy of Shaco, so it fights at his reach rather than a pet's. */
    aggroRadius = 500;

    update() {
      super.update();
      if (this.toRemove) return;

      // Snapped back rather than leashed: the clone is a decoy, and one left
      // stranded across the map fools nobody.
      const ownerPos = this.ownerUnit.position;
      if (this.position.dist(ownerPos) > this.shacoR_maxRange) {
        this.teleportTo(ownerPos.x, ownerPos.y);
      }
    }

    draw() {
      super.draw();
      if (this.toRemove) return;

      // draw circle if clone too far away from owner
      if (this.ownerUnit != this.game.player) return;
      const distance = this.position.dist(this.ownerUnit.position);
      if (distance > this.shacoR_maxRange / 2) {
        const alpha = map(distance, this.shacoR_maxRange / 2, this.shacoR_maxRange, 0, 255);
        noFill();
        stroke(255, alpha);
        circle(this.position.x, this.position.y, this.shacoR_maxRange * 2);
      }
    }

    /** The parting gift: `Pet.expire()` calls this, whatever ended the clone. */
    onExpire() {
      this.shacoR_explode();
    }

    shacoR_explode() {
      const explodeRadius = 100;
      const clonePos = this.position.copy();

      // create explosion
      const explodeEffect = new ParticleSystem({
        getParticlePosFn: (p: any) => p.pos,
        getParticleSizeFn: (p: any) => 20,
        isDeadFn: (p: any) => p.pos.dist(clonePos) > explodeRadius,
        updateFn: (p: any) => {
          p.pos.add(p.vel);
        },
        preDrawFn: () => {
          fill(100, 50);
          stroke(100, 150);
          circle(clonePos.x, clonePos.y, explodeRadius * 2);
        },
        drawFn: (p: any) => {
          // draw lazer beam from clone to explosion
          const alpha = map(p.pos.dist(clonePos), 0, explodeRadius, 200, 10);
          stroke(255, 255, 50, alpha);
          strokeWeight(5);
          line(p.pos.x, p.pos.y, p.pos.x - p.vel.x * 5, p.pos.y - p.vel.y * 5);
        },
      });
      for (let i = 0; i < 20; i++) {
        const p = clonePos.copy();
        const v = p5.Vector.random2D().mult(random(1, 3));
        explodeEffect.addParticle({ pos: p, vel: v });
      }
      this.game.objectManager.addObject(explodeEffect);

      // take damage + fear nearby enemies
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: clonePos.x,
          y: clonePos.y,
          r: explodeRadius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      });

      enemies.forEach((e: any) => {
        const fearBuff = new Fear(1000, this.ownerUnit, e);
        fearBuff.sourcePosition = clonePos;
        e.addBuff(fearBuff);
        e.takeDamage(30, this.ownerUnit);
      });

      // three boxes scattered around the corpse, each a real one: hidden and
      // untargetable until something walks into it, killable once it pops.
      const count = 3;
      for (let i = 0; i < count; i++) {
        const spot = clonePos.copy().add(
          Math.cos((i * 2 * Math.PI) / count) * 100, // 100 is the radius
          Math.sin((i * 2 * Math.PI) / count) * 100
        );
        const box = new Shaco_W_Box({
          game: this.game,
          position: clonePos.copy(),
          teamId: this.teamId,
          ownerUnit: this.ownerUnit,
          lifeTimeMs: 3000,
          stationary: true,
          followsOwner: false,
          aggroRadius: ATTACK_RANGE,
          preset: {
            name: 'Hộp Hề Ma Quái',
            spells: [],
            attack: { damage: ATTACK_DAMAGE, attacksPerSecond: 2, range: ATTACK_RANGE },
          },
        });
        box.slideTo = spot;
        this.game.objectManager.addObject(box);
      }
    }
  }
  return Shaco_R_Clone;
}
const __cacheShaco_R_Clone = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_R_Clone>>();
export function makeShaco_R_Clone(api: ContentApi) {
  const cached = __cacheShaco_R_Clone.get(api);
  if (cached) return cached;
  const built = __buildShaco_R_Clone(api);
  __cacheShaco_R_Clone.set(api, built);
  return built;
}