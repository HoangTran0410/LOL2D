import { Circle } from '../../../libs/quadtree';
import AssetManager, { type AssetKey } from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Champion from './Champion';

export interface MonsterPresetData {
  name: string;
  avatar: AssetKey;
  camp: { x: number; y: number; r: number };
  speed: number;
  size: number;
  attackRange: number;
  reviveTime: number;
  health: number;
  /** Per swing. Defaults to a share of the camp's health. */
  damage?: number;
  /** ms between swings. */
  attackInterval?: number;
  /** Champions this close wake the camp up. Defaults to attackRange + 120. */
  aggroRange?: number;
}

export interface MonsterOptions {
  game: AttackableUnitOptions['game'];
  preset?: MonsterPresetData;
}

export type MonsterPhase = (typeof Monster.PHASES)[keyof typeof Monster.PHASES];

const DEFAULT_PRESET: MonsterPresetData = {
  name: 'Baron',
  avatar: 'monster_Baron_Nashor',
  camp: { x: 2147, y: 1876, r: 100 },
  speed: 0,
  size: 100,
  attackRange: 400,
  reviveTime: 3000,
  health: 1000,
};

/**
 * A jungle camp. Sits on its camp point until a champion damages it or walks
 * into aggro range, chases and hits that champion, then leashes home and heals
 * back to full once dragged past `camp.r`.
 */
export default class Monster extends AttackableUnit {
  static PHASES = {
    IDLE: 'IDLE',
    ATTACK: 'ATTACK',
    BACK_TO_CAMP: 'BACK_TO_CAMP',
  };

  /** Between AttackableUnit and Champion: monsters must not paint over players. */
  zIndex = 3.5;

  name: string;
  phase: MonsterPhase = Monster.PHASES.IDLE;
  camp: { x: number; y: number; r: number };
  attackRange: number;
  attackInterval: number;
  damage: number;
  aggroRange: number;
  reviveTime = 0;
  targetLock: Champion | null = null;

  /** ms left before the next swing. */
  _attackCooldown = 0;
  /** ms left on the swing flash — purely cosmetic. */
  _attackFlash = 0;
  /** ms left before the next idle aggro scan. */
  _scanCooldown = 0;
  /** Per-frame regen applied by Stats.update(), picked per phase. */
  _idleRegen: number;
  _leashRegen: number;

  constructor({ game, preset = DEFAULT_PRESET }: MonsterOptions) {
    super({
      game,
      position: createVector(preset.camp.x, preset.camp.y),
      avatar: AssetManager.get(preset.avatar),
    });

    this.name = preset.name;
    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.visionRadius.baseValue = 0;

    this.attackRange = preset.attackRange;
    this.reviveTime = preset.reviveTime;
    this.camp = preset.camp;
    this.attackInterval = preset.attackInterval ?? 1500;
    this.damage = preset.damage ?? Math.min(25, Math.max(3, Math.round(preset.health / 25)));
    this.aggroRange = preset.aggroRange ?? preset.attackRange + 120;

    // camps reset in ~2s when left alone, faster while walking home
    this._idleRegen = preset.health / 120;
    this._leashRegen = preset.health / 60;
  }

  update() {
    // Stats.update() (inside super.update()) is what actually applies regen, so
    // the phase rate has to be in place before we call up.
    this.stats.healthRegen.baseValue = this.isDead
      ? 0
      : this.phase === Monster.PHASES.IDLE
      ? this._idleRegen
      : this.phase === Monster.PHASES.BACK_TO_CAMP
      ? this._leashRegen
      : 0;

    super.update();

    if (this.isDead) return;

    if (this._attackFlash > 0) this._attackFlash -= deltaTime;
    if (this._attackCooldown > 0) this._attackCooldown -= deltaTime;

    if (this.phase === Monster.PHASES.IDLE) this.updateIdle();
    else if (this.phase === Monster.PHASES.ATTACK) this.updateAttack();
    else if (this.phase === Monster.PHASES.BACK_TO_CAMP) this.updateBackToCamp();
  }

  updateIdle() {
    this._scanCooldown -= deltaTime;
    if (this._scanCooldown > 0) return;
    this._scanCooldown = 250;

    const champion = this.findNearestChampion(this.aggroRange);
    if (champion) this.aggroOn(champion);
  }

  updateAttack() {
    const target = this.targetLock;
    // the original read target.position unconditionally: a damage source with
    // no attacker (a zone tick, a dead owner) put the camp into ATTACK with a
    // null lock and threw on the next frame
    if (!target || target.toRemove || target.isDead || !target.position) {
      this.goBackToCamp();
      return;
    }

    const pos = this.position;
    const distToCamp = Math.hypot(pos.x - this.camp.x, pos.y - this.camp.y);
    if (distToCamp > this.camp.r) {
      this.goBackToCamp();
      return;
    }

    // reach from surface to surface, otherwise a melee camp with attackRange 50
    // can never satisfy its own check against a 55px champion
    const reach =
      this.attackRange + this.stats.size.value / 2 + (target.stats?.size?.value ?? 0) / 2;
    const distance = p5.Vector.dist(pos, target.position);

    if (distance > reach) {
      this.moveTo(target.position.x, target.position.y);
    } else {
      this.stopMovement();
      if (this._attackCooldown <= 0) {
        this._attackCooldown = this.attackInterval;
        this._attackFlash = 180;
        target.takeDamage(this.damage, this);
      }
    }
  }

  updateBackToCamp() {
    this.moveTo(this.camp.x, this.camp.y);
    // the original never left this phase, so a leashed camp stayed on 'walking
    // home' regen forever and never re-aggroed on proximity
    if (Math.hypot(this.position.x - this.camp.x, this.position.y - this.camp.y) < 10) {
      this.phase = Monster.PHASES.IDLE;
      this.stopMovement();
    }
  }

  findNearestChampion(radius: number): Champion | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: radius }),
      filters: [
        PredefinedFilters.type(Champion),
        PredefinedFilters.canTakeDamageFromTeam(this.teamId),
      ],
    });

    let nearest = null;
    let nearestDist = Infinity;
    for (const c of found) {
      const d = p5.Vector.dist(this.position, c.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = c;
      }
    }
    return nearest;
  }

  aggroOn(unit?: Champion) {
    if (!unit || !(unit instanceof Champion)) return;
    this.targetLock = unit;
    this.phase = Monster.PHASES.ATTACK;
  }

  goBackToCamp() {
    this.targetLock = null;
    this.phase = Monster.PHASES.BACK_TO_CAMP;
    this.moveTo(this.camp.x, this.camp.y);
  }

  draw() {
    if (this.isDead) return;
    super.draw();

    // swing flash
    if (this._attackFlash > 0 && this.targetLock?.position) {
      const pos = this.position;
      const dir = p5.Vector.sub(this.targetLock.position, pos);
      if (dir.magSq() > 0) {
        dir.setMag(this.animatedValues.displaySize / 2 + 14);
        push();
        stroke(255, 190, 80, Math.min(255, this._attackFlash * 1.6));
        strokeWeight(7);
        line(pos.x, pos.y, pos.x + dir.x, pos.y + dir.y);
        pop();
      }
    }
  }

  drawDir() {
    // the base draws a pointer at the mouse; a monster points at what it is hitting
    if (this.targetLock?.position && !this.isDead) {
      let pos = this.position;
      let { displaySize: size, alpha } = this.animatedValues;

      const target = p5.Vector.sub(this.targetLock.position, pos);
      if (target.magSq() === 0) return;
      target.setMag(size / 2 + 2);

      push();
      stroke(255, Math.min(alpha, 150));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + target.x, pos.y + target.y);
      pop();
    }
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    super.takeDamage(damage, attacker);
    // super.takeDamage may have killed us; a corpse must not hold aggro
    if (!this.isDead && attacker instanceof Champion) this.aggroOn(attacker);
  }

  die(deathData: UnitDeathData) {
    super.die(deathData);
    this.targetLock = null;
    this.phase = Monster.PHASES.IDLE;
    this.stopMovement();
  }

  respawn() {
    super.respawn();
    this.targetLock = null;
    this.phase = Monster.PHASES.IDLE;
    this._attackCooldown = 0;
    this._attackFlash = 0;
    // super.respawn() drops every unit on a spawn point; a camp belongs at its camp
    this.position.set(this.camp.x, this.camp.y);
    this.destination.set(this.camp.x, this.camp.y);
  }
}
