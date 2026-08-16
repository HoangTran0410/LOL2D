import { Circle } from '../../../libs/quadtree';
import AssetManager, { type AssetKey } from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitRenderOptions } from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Champion from './Champion';

/**
 * Something a camp can do besides swing — Baron's poison spit, its tail slam,
 * the pool it leaves behind. Declared on the preset rather than written into
 * `Monster`, so the second camp that wants a kit (a dragon, a buff camp) states
 * it the same way instead of adding another branch here.
 *
 * `cast` gets the camp and the champion it has locked, and is expected to do
 * the whole thing — spawn the projectile, start the telegraph, apply the buff.
 * `Monster` only decides *when*.
 */
export interface MonsterAbility {
  /** Read by tests and the debug overlay; never shown to a player. */
  name: string;
  cooldownMs: number;
  /**
   * How close the target has to be, centre to centre. Defaults to the camp's
   * `attackRange`, which is the honest default for a camp whose kit is built
   * around its reach — an ability that wants to be usable further out, or only
   * up close, says so.
   */
  range?: number;
  cast(monster: Monster, target: Champion): void;
}

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
  /** Tried in order, one per frame. A camp that declares none just swings. */
  abilities?: MonsterAbility[];
}

export interface MonsterOptions {
  game: AttackableUnitOptions['game'];
  preset?: MonsterPresetData;
}

export type MonsterPhase = (typeof Monster.PHASES)[keyof typeof Monster.PHASES];

/**
 * Floor on how close a camp has to get to its camp point to count as home.
 * The real threshold is this or the body's own radius, whichever is larger —
 * see `updateBackToCamp` for why a flat number is not reachable by a camp that
 * shares its clearing with two others.
 */
export const MONSTER_HOME_TOLERANCE = 12;

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

  /** What this camp can do besides swing, in the order it prefers to do it. */
  abilities: MonsterAbility[];
  /** ms left on each entry of `abilities`, by index. */
  _abilityCooldowns: number[];

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

    // A camp with no speed of its own (Baron) is scenery: it pushes units off
    // itself and never budges. One with legs takes its half like everyone else.
    this.isImmovable = preset.speed === 0;

    this.attackRange = preset.attackRange;
    this.reviveTime = preset.reviveTime;
    this.camp = preset.camp;
    this.attackInterval = preset.attackInterval ?? 1500;
    this.damage = preset.damage ?? Math.min(25, Math.max(3, Math.round(preset.health / 25)));
    this.aggroRange = preset.aggroRange ?? preset.attackRange + 120;
    this.abilities = preset.abilities ?? [];
    this._abilityCooldowns = this.abilities.map(() => 0);

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

    // Buffs ran inside super.update(); undo anything that tried to move us.
    //
    // A camp with no speed of its own has no way back from a displacement, so
    // it never accepts one — exactly the contract a turret's foundation has,
    // and the same two lines. Baron used to be draggable by a hook, a wall or a
    // Lee Sin kick and then stranded for the rest of the match: past its 100px
    // camp radius `updateAttack` bounces it into BACK_TO_CAMP, a phase it can
    // never walk out of, and a camp in BACK_TO_CAMP never runs `updateIdle`
    // again — so it stopped aggroing, stopped swinging, and stopped drawing the
    // swing flash that made it look alive at all.
    if (this.isImmovable) {
      this.position.set(this.camp.x, this.camp.y);
      this.destination.set(this.camp.x, this.camp.y);
    }

    if (this.isDead) return;

    if (this._attackFlash > 0) this._attackFlash -= deltaTime;
    if (this._attackCooldown > 0) this._attackCooldown -= deltaTime;
    for (let i = 0; i < this._abilityCooldowns.length; i++) {
      if (this._abilityCooldowns[i] > 0) this._abilityCooldowns[i] -= deltaTime;
    }

    if (this.phase === Monster.PHASES.IDLE) this.updateIdle();
    else if (this.phase === Monster.PHASES.ATTACK) this.updateAttack();
    else if (this.phase === Monster.PHASES.BACK_TO_CAMP) this.updateBackToCamp();
  }

  updateIdle() {
    this._scanCooldown -= deltaTime;
    if (this._scanCooldown > 0) return;
    this._scanCooldown = 250;

    // The leash check used to live only in `updateAttack`, so it could not see
    // a camp that was moved with nothing chasing it: an Anivia wall or a hook
    // that pushed a wolf out of its pit while it was idle left it standing
    // wherever it was dumped for the rest of the match. Measured against the
    // camp radius, not the arrival tolerance — camps in a shared pit hold each
    // other tens of pixels off their own points forever, and walking home over
    // that would leave the three wolves shuffling and never idle enough to
    // aggro again.
    if (this.isOutsideCamp()) {
      this.goBackToCamp();
      return;
    }

    const champion = this.findNearestChampion(this.aggroRange);
    if (champion) this.aggroOn(champion);
  }

  /** Beyond the leash radius: too far from the camp point to still belong to it. */
  isOutsideCamp(): boolean {
    return Math.hypot(this.position.x - this.camp.x, this.position.y - this.camp.y) > this.camp.r;
  }

  /**
   * The circle a camp will fight inside, measured from the camp point.
   *
   * `camp.r` alone is the wrong measure for a camp that outranges its own pit:
   * Baron's circle is 100px and its reach is 400, so it would drop a champion
   * it was happily hitting. `aggroRange` alone is the wrong measure for a small
   * camp, whose 170 sits only ~50px past its own reach — a champion kiting at
   * the edge would be dropped and re-acquired every other scan. The wider of
   * the two is right for both: the pit for a wolf, the reach for Baron.
   */
  targetLeashRange(): number {
    return Math.max(this.camp.r, this.aggroRange);
  }

  /** Whether `target` has left the circle this camp is willing to fight in. */
  hasEscaped(target: AttackableUnit): boolean {
    return (
      Math.hypot(target.position.x - this.camp.x, target.position.y - this.camp.y) >
      this.targetLeashRange()
    );
  }

  updateAttack() {
    const target = this.targetLock;
    // the original read target.position unconditionally: a damage source with
    // no attacker (a zone tick, a dead owner) put the camp into ATTACK with a
    // null lock and threw on the next frame
    // `isStealthed` here as well as in the scan: the idle scan is on a 250ms
    // interval, so vanishing mid-fight otherwise left the camp swinging at
    // something it could no longer see until the next one came round.
    if (!target || target.toRemove || target.isDead || !target.position || target.isStealthed) {
      this.goBackToCamp();
      return;
    }

    const pos = this.position;
    if (this.isOutsideCamp()) {
      this.goBackToCamp();
      return;
    }

    // The leash above measures the camp against its own circle, which is the
    // whole story only for a camp that chases. Baron never moves, so it never
    // left that circle and never let go of anything: a player could teleport
    // across the map, come back minutes later, and still be its target — while
    // a Shaco clone standing on top of it was never considered, because the
    // scan that finds a new target only runs in IDLE.
    if (this.hasEscaped(target)) {
      this.goBackToCamp();
      return;
    }

    // Before the reach check, so a camp can open with an ability while it is
    // still walking in, and before the swing, so it never does both at once.
    if (this.castAbility(target)) return;

    // reach from surface to surface, otherwise a melee camp with attackRange 50
    // can never satisfy its own check against a 55px champion
    const reach =
      this.attackRange + this.stats.size.value / 2 + (target.stats?.size?.value ?? 0) / 2;
    const distance = p5.Vector.dist(pos, target.position);

    if (distance > reach) {
      // A camp with no legs cannot close a gap, so holding the lock is a
      // promise it can never keep — it lets go instead, and its next idle scan
      // is free to pick whatever did walk into reach.
      if (this.isImmovable) {
        this.goBackToCamp();
        return;
      }
      // routed: a camp whose champion stepped behind the wall of its own pit
      // used to grind into that wall until the leash radius saved it
      this.navigateTo(target.position.x, target.position.y);
    } else {
      this.stopMovement();
      // Same gate `BasicAttackController` gives champions. A camp swings on its
      // own timer, so without it a knocked-up or stunned camp kept hitting on
      // the beat right through the control that was supposed to stop it.
      if (this.canAttack && this._attackCooldown <= 0) {
        this._attackCooldown = this.attackInterval;
        this._attackFlash = 180;
        target.takeDamage(this.damage, this);
      }
    }
  }

  /**
   * The first ability that is off cooldown and close enough, or nothing.
   *
   * `canCast` rather than `canAttack`: this is the gate a champion's abilities
   * sit behind, so a stun or a knock-up landed on Baron cuts its combo the same
   * way it cuts yours. One per frame, and the caller returns straight after —
   * a camp that both quaked and bit in the same 16ms would be unreadable.
   */
  castAbility(target: Champion): boolean {
    if (!this.canCast) return false;

    for (let i = 0; i < this.abilities.length; i++) {
      if (this._abilityCooldowns[i] > 0) continue;

      const ability = this.abilities[i];
      const range = ability.range ?? this.attackRange;
      if (p5.Vector.dist(this.position, target.position) > range) continue;

      this._abilityCooldowns[i] = ability.cooldownMs;
      ability.cast(this, target);
      return true;
    }

    return false;
  }

  updateBackToCamp() {
    // Checked before the order, so the frame a camp gets home does not also
    // spend an order it is about to drop.
    //
    // "Home" scales with the body instead of being a flat 10px bullseye. Camp
    // points sit ~100px apart (the three wolves, the four raptors) while
    // `UnitCollisionSystem` holds two bodies `bodyRadius + bodyRadius` apart —
    // 55px for a greater wolf beside a wolf — so the small ones physically
    // cannot reach the exact point their preset names. A camp that never
    // arrives never leaves this phase, which means it keeps the walking-home
    // regen rate and, far worse, never runs `updateIdle` again: it stops
    // re-aggroing on proximity for the rest of the match while standing on its
    // own camp.
    const home = Math.max(MONSTER_HOME_TOLERANCE, this.stats.size.value / 2);
    if (Math.hypot(this.position.x - this.camp.x, this.position.y - this.camp.y) <= home) {
      this.phase = Monster.PHASES.IDLE;
      this.stopMovement();
      return;
    }

    // leashing home is the one walk a camp does with nothing chasing it, and
    // the one it must not fail: routed, so a pit wall cannot strand it outside.
    // `PathAgent.order` deliberately re-plans a BLOCKED agent rather than
    // swallowing this repeat, which is what stopped a dragged camp freezing
    // mid-jungle — see that method.
    this.navigateTo(this.camp.x, this.camp.y);
  }

  findNearestChampion(radius: number): Champion | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: radius }),
      filters: [
        PredefinedFilters.type(Champion),
        PredefinedFilters.canTakeDamageFromTeam(this.teamId),
        // a camp does not wake up for a champion hidden in a bush
        PredefinedFilters.excludeStealthed,
        PredefinedFilters.visibleTo(this),
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
    this.navigateTo(this.camp.x, this.camp.y);
  }

  draw(options: AttackableUnitRenderOptions = {}) {
    if (this.isDead) return;
    super.draw(options);

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
    this._abilityCooldowns = this._abilityCooldowns.map(() => 0);
    // super.respawn() drops every unit on a spawn point; a camp belongs at its camp
    this.position.set(this.camp.x, this.camp.y);
    this.destination.set(this.camp.x, this.camp.y);
  }
}
