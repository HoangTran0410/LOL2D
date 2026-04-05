import AssetManager from '../../../managers/AssetManager';
import AttackableUnit from './AttackableUnit';

export default class Monster extends AttackableUnit {
  static PHASES = {
    IDLE: 'IDLE',
    ATTACK: 'ATTACK',
    BACK_TO_CAMP: 'BACK_TO_CAMP',
  };

  phase: string = Monster.PHASES.IDLE;
  camp: { x: number; y: number; r: number };
  attackRange: number;
  reviveTime = 0;
  targetLock: any = null;

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
  }: {
    game?: any;
    preset?: any;
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
  }

  update() {
    super.update();

    if (this.phase === Monster.PHASES.IDLE) {
      this.stats.health.baseValue += 2;
      this.stats.health.baseValue = min(
        this.stats.health.baseValue,
        this.stats.maxHealth.baseValue
      );
    } else if (this.phase === Monster.PHASES.ATTACK) {
      let pos = this.position;
      let targetPos = this.targetLock.position;

      let distance = p5.Vector.dist(pos, targetPos);
      if (distance > this.attackRange) {
        this.moveTo(targetPos.x, targetPos.y);
      } else if (distance > 0) {
        this.moveTo(pos.x, pos.y);
      }

      let distToCamp = p5.Vector.dist(pos, createVector(this.camp.x, this.camp.y));
      if (distToCamp > this.camp.r) {
        this.phase = Monster.PHASES.BACK_TO_CAMP;
        this.moveTo(this.camp.x, this.camp.y);
        this.targetLock = null;
      }
    } else if (this.phase === Monster.PHASES.BACK_TO_CAMP) {
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

  takeDamage(damage: number, attacker: any) {
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
