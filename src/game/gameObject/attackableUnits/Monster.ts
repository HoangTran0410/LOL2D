import { withinRadius } from '@/utils/math.utils';
import { Circle } from '@/libs/quadtree';
import { packAsset } from '@/game/config/packAsset';
import { OBJECTIVE_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitRenderOptions } from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Champion from './Champion';

/**
 * Something a camp can do besides swing — a ranged spit, a melee slam,
 * a pool it leaves behind. Declared on the preset rather than written into
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
  /**
   * A pack-relative asset key (resolved through `packAsset`), or null for the
   * anonymous fallback camp — every real camp names its art.
   */
  avatar: string | null;
  /**
   * The camp point — where this body sits at rest, chases from and leashes
   * back to. **Also the pack's identity**: every body spawned into the same
   * neutral slot is handed the exact same `camp` object (`Game.spawnJungle()`
   * via `preset.ts`'s `monsterBodyPreset`), and `alertCamp` finds its
   * packmates by that shared reference rather than a separate id — see its
   * own doc comment.
   */
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

/** Extra chase distance past a camp's pit/reach, so it actually pursues a
 *  fleeing target instead of stopping at the edge of its own ground. */
export const MONSTER_CHASE_MARGIN = 350;
/** Grace after a camp's target leaves the chase leash before it turns for
 *  home, so a target that ducks out and back is still pursued. */
export const MONSTER_GIVE_UP_DELAY_MS = 2000;

/**
 * What a camp is when nobody said. Deliberately anonymous and at the origin.
 *
 * This was a specific jungle boss — its name, its art and its map's own
 * coordinates — which made an engine file depend on one map's content and put any
 * preset-less monster in the middle of that map's river. Every real camp comes
 * from map data; this exists so the constructor has something total to fall
 * back on, and a caller that reaches it has a bug worth seeing.
 */
const DEFAULT_PRESET: MonsterPresetData = {
  name: 'Quái',
  avatar: null,
  camp: { x: 0, y: 0, r: 100 },
  speed: 0,
  size: 60,
  attackRange: 100,
  reviveTime: 3000,
  health: 300,
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
  zIndex = OBJECTIVE_Z_INDEX;

  name: string;
  phase: MonsterPhase = Monster.PHASES.IDLE;
  camp: { x: number; y: number; r: number };
  attackRange: number;
  attackInterval: number;
  damage: number;
  aggroRange: number;
  reviveTime = 0;
  targetLock: AttackableUnit | null = null;

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
  /** Grace left before a camp whose target left the chase leash turns for home. */
  _giveUpTimer = MONSTER_GIVE_UP_DELAY_MS;
  /** Per-frame regen applied by Stats.update(), picked per phase. */
  _idleRegen: number;
  _leashRegen: number;

  constructor({ game, preset = DEFAULT_PRESET }: MonsterOptions) {
    super({
      game,
      position: createVector(preset.camp.x, preset.camp.y),
      avatar: preset.avatar ? packAsset(preset.avatar) : undefined,
    });

    this.name = preset.name;
    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.visionRadius.baseValue = 0;

    // A camp with no speed of its own (a stationary boss) is scenery: it pushes units off
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
    // and the same two lines. A stationary boss used to be draggable by a hook, a wall or a
    // dash-kick and then stranded for the rest of the match: past its 100px
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
    // a camp that was moved with nothing chasing it: a spell-made wall or a hook
    // that pushed a camp out of its pit while it was idle left it standing
    // wherever it was dumped for the rest of the match. Measured against the
    // camp radius, not the arrival tolerance — camps in a shared pit hold each
    // other tens of pixels off their own points forever, and walking home over
    // that would leave the three wolves shuffling and never idle enough to
    // aggro again.
    if (this.isOutsideCamp()) {
      this.goBackToCamp();
      return;
    }

    // Camps no longer wake on proximity: a champion can walk straight through a
    // pit untouched. A camp only enters ATTACK when something damages it —
    // `takeDamage` calls `aggroOn(attacker)`. IDLE is now a genuinely passive
    // state whose only job is to hold the camp point and regen.
  }

  /** Beyond the leash radius: too far from the camp point to still belong to it. */
  isOutsideCamp(): boolean {
    return !withinRadius(this.position, this.camp, this.camp.r);
  }

  /**
   * The circle a camp will chase inside, measured from the camp point — wider
   * than the pit on purpose so it actually pursues rather than stopping at the
   * edge of its own ground.
   *
   * The base is `camp.r`/`aggroRange`, whichever is wider (the pit for a small camp,
   * the reach for a stationary boss), plus `MONSTER_CHASE_MARGIN`. A target — or the camp
   * itself, once it has walked out chasing — outside this for longer than
   * `MONSTER_GIVE_UP_DELAY_MS` is let go.
   */
  chaseLeashRange(): number {
    return Math.max(this.camp.r, this.aggroRange) + MONSTER_CHASE_MARGIN;
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

    // Give-up leash, measured from the camp point. The camp keeps chasing while
    // it and its target are both inside `chaseLeashRange`; when either crosses
    // it — the target runs off, or the camp itself has walked too far out — a
    // delay runs before it turns for home. A player who kites just past the line
    // for a moment, or ducks out and back, is still pursued rather than dropped
    // the instant they step over it. A stationary boss (no legs) never moves, so only its
    // target leaving can start the clock.
    const leash = this.chaseLeashRange();
    const escaped =
      !withinRadius(pos, this.camp, leash) || !withinRadius(target.position, this.camp, leash);
    if (escaped) {
      this._giveUpTimer -= deltaTime;
      if (this._giveUpTimer <= 0) {
        this.goBackToCamp();
        return;
      }
    } else {
      this._giveUpTimer = MONSTER_GIVE_UP_DELAY_MS;
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
   * sit behind, so a stun or a knock-up landed on a camp cuts its combo the same
   * way it cuts yours. One per frame, and the caller returns straight after —
   * a camp that both quaked and bit in the same 16ms would be unreadable.
   */
  castAbility(target: AttackableUnit): boolean {
    if (!this.canCast) return false;
    // Camp abilities are written for champions; against a pet or a minion the
    // camp still basic-swings, it just does not cast on it.
    if (!(target instanceof Champion)) return false;

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
    if (withinRadius(this.position, this.camp, home)) {
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

  aggroOn(unit?: AttackableUnit) {
    if (!unit || unit === this) return;
    this.targetLock = unit;
    this.phase = Monster.PHASES.ATTACK;
    this._giveUpTimer = MONSTER_GIVE_UP_DELAY_MS;
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

  /**
   * A camp can only hold a champion: `targetLock` is typed that way because a
   * jungle monster chasing a minion down a lane is not a thing this game has.
   * So a taunt from anything else is simply not something a camp can obey —
   * which today is no restriction at all, since the only taunt in the game is
   * one champion's own.
   */
  forceAttackTarget(attacker: AttackableUnit): void {
    if (this.isDead || attacker.isDead || !(attacker instanceof Champion)) return;
    this.targetLock = attacker;
    this.phase = Monster.PHASES.ATTACK;
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    // Latched before the hit lands, because the hit may kill us: what decides
    // whether the pack gets shouted at is whether *this* body was already in
    // the fight, and a corpse has had its lock cleared by `die`.
    const engagedWith = this.phase === Monster.PHASES.ATTACK ? this.targetLock : null;

    super.takeDamage(damage, attacker);

    if (!attacker) return;
    // super.takeDamage may have killed us; a corpse must not hold aggro. A camp
    // fights back against *whatever* hit it — a champion, a pet, an allied
    // minion — not champions alone, so "only attack when attacked" holds for
    // every attacker (see aggroOn / castAbility).
    if (!this.isDead) this.aggroOn(attacker);
    // A dead wolf still gets to shout: the hit that one-shot the small one is
    // exactly the hit its pack should answer, and gating the alert on survival
    // meant an opener that killed a 50hp raptor woke nothing at all.
    //
    // Only on the frame this body *joins* the fight, never on every later tick.
    // A camp standing in a damage-over-time pool takes a hit per frame, and a
    // quadtree query per frame per body is the cost this guard buys back.
    if (engagedWith !== attacker) this.alertCamp(attacker);
  }

  /**
   * Pulls the rest of the pack in on `attacker`.
   *
   * A camp is a pack, not three strangers standing near each other: hitting
   * one wolf used to wake exactly that wolf — the others watched their
   * packmate die from 50px away, because `takeDamage` is the only thing that
   * aggros a camp and it only ever aggroed the body it was called on.
   *
   * Found by query rather than by a list wired up at spawn, so this works the
   * same in a headless test as it does in a match and survives the jungle being
   * switched off and back on (`MatchDirector.jungleEnabled` rebuilds every camp
   * from scratch). The circle is measured from the *camp point*, not from this
   * body — the packmate we want is the one still sitting at home — and
   * `chaseLeashRange` is its radius because that is already this camp's
   * definition of "ground we fight over".
   *
   * Membership used to be a shared `campId` string every body in a pack
   * carried. That field is gone: a camp is now a neutral slot, and every body
   * `Game.spawnJungle()` spawns into one slot is handed the exact same `camp`
   * object (`preset.ts`'s `monsterBodyPreset`) — so `mate.camp === this.camp`
   * *is* "in this pack", with no id to keep in sync and no distance re-scan
   * against map data. A solo camp's `camp` object is never shared with
   * anything else, so this still finds nobody for it, same as before.
   *
   * Calls `aggroOn`, never `takeDamage`, so an alert cannot re-broadcast.
   */
  alertCamp(attacker: AttackableUnit) {
    if (!this.game?.objectManager) return;

    const mates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.camp.x, y: this.camp.y, r: this.chaseLeashRange() }),
      filters: [PredefinedFilters.type(Monster)],
    });

    for (const mate of mates) {
      if (mate === this || mate === attacker) continue;
      if (mate.camp !== this.camp) continue;
      if (mate.isDead || mate.toRemove) continue;
      // A packmate already busy keeps its own target: the pack converges on
      // whoever walked in, it does not re-target as a unit every time one of
      // them is hit.
      if (mate.phase === Monster.PHASES.ATTACK && mate.targetLock) continue;
      mate.aggroOn(attacker);
    }
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
