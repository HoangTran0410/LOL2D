import { Circle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import Stun from '../buffs/Stun';
import ParticleSystem from '../helpers/ParticleSystem';

export default class LeeSin_R extends Spell {
  image = AssetManager.getAsset('spell_leesin_r');
  name = 'Nộ Long Cước (LeeSin_R)';
  description =
    'Tung cước đá mục tiêu <span class="buff">Văng ra xa</span>, gây <span class="damage">30 sát thương</span> và <span class="buff">Làm Choáng</span> mục tiêu trong <span class="time">0.5 giây</span>. Những kẻ địch khác bị mục tiêu va trúng sẽ bị <span class="buff">Hất Tung</span> trong <span class="time">1 giây</span> và nhận <span class="damage">30 sát thương</span>';
  coolDown = 10000;

  rangeToCheckEnemies = 80;
  rangeToDashEnemy = 350;
  dashSpeed = 8;
  damage = 30;
  collideDamage = 30;

  onSpellCast() {
    const mouse = this.game.worldMouse.copy();

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.rangeToCheckEnemies,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
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
    dashBuff.image = this.image;
    dashBuff.cancelable = false;
    dashBuff.onReachedDestination = () => {
      airborneBuff.deactivateBuff();
      obj.toRemove = true;

      const stunBuff = new Stun(500, this.owner, closestEnemyToMouse);
      stunBuff.image = this.image;
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
    super.drawPreview(this.rangeToCheckEnemies);
  }
}

export class LeeSin_R_Object extends SpellObject {
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
      airbornBuff.image = AssetManager.getAsset('spell_leesin_r');
      enemy.addBuff(airbornBuff);

      this.effectedEnemies.push(enemy);
    });
  }
}
