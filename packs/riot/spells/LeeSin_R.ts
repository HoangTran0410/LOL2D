import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type LeeSin_R = InstanceType<ReturnType<typeof makeLeeSin_R>>;
type LeeSin_R_Object = InstanceType<ReturnType<typeof makeLeeSin_R_Object>>;



function __buildLeeSin_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const ParticleSystem = api.helpers.ParticleSystem;
  const LeeSin_R_Object = makeLeeSin_R_Object(api);
  class LeeSin_R extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_leesin_r');
    name = 'Nộ Long Cước (LeeSin_R)';
    description =
      'Tung cước đá mục tiêu <span class="buff">Văng ra xa</span>, gây <span class="damage">30 sát thương</span> và <span class="buff">Làm Choáng</span> mục tiêu trong <span class="time">0.5 giây</span>. Những kẻ địch khác bị mục tiêu va trúng sẽ bị <span class="buff">Hất Tung</span> trong <span class="time">1 giây</span> và nhận <span class="damage">30 sát thương</span>';
    coolDown = 10000;
    manaCost = 50;

    rangeToCheckEnemies = 80;
    rangeToDashEnemy = 350;
    dashSpeed = 8;
    damage = 30;
    collideDamage = 30;

    onSpellCast() {
      const mouse = this.aimPoint;

      // The shortest caster-centred range in the game, and the one body
      // separation broke first: 80 units cannot be satisfied by an enemy that a
      // grown Cho'Gath-sized Lee Sin holds 110 units away. effectiveRange gives
      // back the excess body radius and nothing else.
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.rangeToCheckEnemies, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });

      if (!enemies?.length) {
        this.resetCoolDown();
        this.owner.moveTo(mouse.x, mouse.y);
        return;
      }

      let closestEnemyToMouse: any = null;
      let closestDistanceToMouse = Infinity;
      enemies.forEach((enemy: any) => {
        const distance = p5.Vector.dist(enemy.position, mouse);
        if (distance < closestDistanceToMouse) {
          closestDistanceToMouse = distance;
          closestEnemyToMouse = enemy;
        }
      });

      const { from, to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        closestEnemyToMouse.position,
        this.rangeToDashEnemy
      );

      const obj = new LeeSin_R_Object(this.owner);
      obj.targetEnemy = closestEnemyToMouse;
      obj.collideDamage = this.collideDamage;
      obj.destination = destination;
      this.game.objectManager.addObject(obj);

      const airborneBuff = new Airborne(3000, this.owner, closestEnemyToMouse);
      closestEnemyToMouse.addBuff(airborneBuff);

      const dashBuff = new Dash(3000, this.owner, closestEnemyToMouse);
      dashBuff.dashDestination = destination;
      dashBuff.dashSpeed = this.dashSpeed;
      dashBuff.cancelable = false;
      dashBuff.onReachedDestination = () => {
        airborneBuff.deactivateBuff();
        obj.toRemove = true;

        const stunBuff = new Stun(500, this.owner, closestEnemyToMouse);
        closestEnemyToMouse.addBuff(stunBuff);
      };
      dashBuff.addDeactivateListener(() => {
        airborneBuff.deactivateBuff();
        obj.toRemove = true;
      });
      closestEnemyToMouse.addBuff(dashBuff);

      closestEnemyToMouse.takeDamage(this.damage, this.owner);

      const particleSystem = new ParticleSystem({
        getParticlePosFn: (p: any) => p.position,
        getParticleSizeFn: (p: any) => 10,
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

      const dir = p5.Vector.sub(destination, from);
      const pos = closestEnemyToMouse.position
        .copy()
        .sub(dir.setMag(closestEnemyToMouse.stats.size.value / 2));

      for (let i = 0; i < 20; i++) {
        const lifeTime = random(300, 1500);
        particleSystem.addParticle({
          position: pos.copy(),
          velocity: dir
            .copy()
            .setMag(random(2, 6))
            .rotate(random(-PI / 4, PI / 4)),
          lifeSpan: lifeTime,
          lifeTime,
        });
      }
      this.game.objectManager.addObject(particleSystem);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.rangeToCheckEnemies, this.owner));
    }
  }
  return LeeSin_R;
}
const __cacheLeeSin_R = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_R>>();
export default function makeLeeSin_R(api: ContentApi) {
  const cached = __cacheLeeSin_R.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_R(api);
  __cacheLeeSin_R.set(api, built);
  return built;
}


function __buildLeeSin_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Airborne = api.buffs.Airborne;
  class LeeSin_R_Object extends SpellObject {
    targetEnemy: any = null;
    collideDamage = 0;
    effectedEnemies: any[] = [];

    update() {
      if (this.targetEnemy.isDead) this.toRemove = true;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.targetEnemy.position.x,
          y: this.targetEnemy.position.y,
          r: this.targetEnemy.stats.size.value / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects([this.targetEnemy, ...this.effectedEnemies]),
        ],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(this.collideDamage, this.owner);

        const airbornBuff = new Airborne(1000, this.owner, enemy);
        enemy.addBuff(airbornBuff);

        this.effectedEnemies.push(enemy);
      });
    }
  }
  return LeeSin_R_Object;
}
const __cacheLeeSin_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_R_Object>>();
export function makeLeeSin_R_Object(api: ContentApi) {
  const cached = __cacheLeeSin_R_Object.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_R_Object(api);
  __cacheLeeSin_R_Object.set(api, built);
  return built;
}