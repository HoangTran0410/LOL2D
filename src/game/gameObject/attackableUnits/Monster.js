import AssetManager from '../../../managers/AssetManager.js';
import AttackableUnit from './AttackableUnit.js';

export default class Monster extends AttackableUnit {
  static PHASES = {
    IDLE: 'IDLE',
    ATTACK: 'ATTACK',
    // SEARCH_FOR_TARGET: 'SEARCH_FOR_TARGET',
    BACK_TO_CAMP: 'BACK_TO_CAMP',
  };
  phase = Monster.PHASES.IDLE;

  constructor({
    game,
    preset = {
      name: 'Baron',
      avatar: 'monster_Baron_Nashor',
      camp: {
        x: 2147,
        y: 1876,
        r: 100,
      },
      speed: 0,
      size: 100,
      attackRange: 400,
      reviveTime: 3000,
      health: 1000,
    },
  }) {
    super({
      game,
      position: createVector(preset.camp.x, preset.camp.y),
      avatar: AssetManager.getAsset(preset.avatar),
    });

    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.attackRange = preset.attackRange;
    this.reviveTime = preset.reviveTime;
    this.camp = preset.camp;

    this.targetLock = null;
  }

  update() {
    super.update();

    // Idle
    if (this.phase === Monster.PHASES.IDLE) {
      this.stats.health.baseValue += 2;
      this.stats.health.baseValue = min(
        this.stats.health.baseValue,
        this.stats.maxHealth.baseValue
      );
    }

    // Attack
    else if (this.phase === Monster.PHASES.ATTACK) {
      let pos = this.position;
      let targetPos = this.targetLock.position;

      // move close to target
      let distance = p5.Vector.dist(pos, targetPos);
      if (distance > this.attackRange) {
        // this.phase = Monster.PHASES.SEARCH_FOR_TARGET;
        this.moveTo(targetPos.x, targetPos.y);
      } else if (distance > 0) {
        this.moveTo(pos.x, pos.y);
      }

      // move back to camp if too far
      let distToCamp = p5.Vector.dist(pos, createVector(this.camp.x, this.camp.y));
      if (distToCamp > this.camp.r) {
        this.phase = Monster.PHASES.BACK_TO_CAMP;
        this.moveTo(this.camp.x, this.camp.y);
        this.targetLock = null;
      }
    }

    // search for closest target
    // else if (this.phase === Monster.PHASES.SEARCH_FOR_TARGET) {
    //   let closestTarget = null;
    //   let closestDistance = Infinity;
    //   for (let p of this.game.players) {
    //     if (p.isDead) continue;
    //     let distToPlayer = p5.Vector.dist(this.position, p.position);
    //     if (distToPlayer < closestDistance) {
    //       closestTarget = p;
    //       closestDistance = distToPlayer;
    //     }
    //   }
    //   if (closestTarget) this.targetLock = closestTarget;
    //   this.phase = Monster.PHASES.ATTACK;
    // }

    // back to camp
    else if (this.phase === Monster.PHASES.BACK_TO_CAMP) {
      this.stats.health.baseValue += 1;
      this.stats.health.baseValue = min(
        this.stats.health.baseValue,
        this.stats.maxHealth.baseValue
      );
    }
  }

  draw() {
    if (this.isDead) return;
    super.draw();
  }

  drawDir() {
    if (this.targetLock && !this.isDead) {
      let pos = this.position;
      let { displaySize: size, alpha } = this.animatedValues;

      push();
      let target = p5.Vector.sub(this.targetLock.position, pos).setMag(size / 2 + 2);
      stroke(255, 150);
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + target.x, pos.y + target.y);
      pop();
    }
  }

  takeDamage(damage, attacker) {
    super.takeDamage(damage, attacker);
    this.phase = Monster.PHASES.ATTACK;
    this.targetLock = attacker;
  }

  respawn() {
    super.respawn();
    this.targetLock = null;
    this.phase = Monster.PHASES.IDLE;
    this.position.set(this.camp.x, this.camp.y);
    this.destination.set(this.camp.x, this.camp.y);
  }
}
