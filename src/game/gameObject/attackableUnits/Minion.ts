import { Circle, Rectangle } from '../../../libs/quadtree';
import TeamId from '../../enums/TeamId';
import type { LaneWaypoint } from '../../lanes';
import { PredefinedFilters } from '../../managers/ObjectManager';
import AttackableUnit from './AttackableUnit';
import type { AttackableUnitOptions, UnitDeathData } from './AttackableUnit';
import Monster from './Monster';

export type MinionKind = 'melee' | 'ranged';

export interface MinionPresetData {
  name: string;
  kind: MinionKind;
  speed: number;
  size: number;
  health: number;
  /** Per swing. */
  damage: number;
  /** ms between swings. */
  attackInterval: number;
  /** Surface-to-surface reach when swinging. */
  attackRange: number;
  /** Hostiles this close make it stop walking and fight. */
  aggroRange: number;
}

/**
 * Two bodies per wave, both cheap. The melee line tanks and the caster behind it
 * pokes; the caster is squishier and slightly further-reaching so the shape of a
 * wave fight reads at a glance without any pathing of its own.
 *
 * Numbers are picked so a lane fight resolves in roughly ten seconds — long
 * enough to watch, short enough that two waves never stack into a blob.
 */
export const MinionPresets: Record<MinionKind, MinionPresetData> = {
  melee: {
    name: 'Lính Cận Chiến',
    kind: 'melee',
    speed: 2.6,
    size: 34,
    health: 140,
    damage: 9,
    attackInterval: 1_100,
    attackRange: 40,
    aggroRange: 300,
  },
  ranged: {
    name: 'Lính Phép Sư',
    kind: 'ranged',
    speed: 2.6,
    size: 30,
    health: 90,
    damage: 13,
    attackInterval: 1_500,
    attackRange: 280,
    aggroRange: 340,
  },
};

/** World units from a waypoint that count as having reached it. */
export const WAYPOINT_TOLERANCE = 40;
/** ms between aggro scans. Re-querying the quadtree per minion per frame is the
 *  one thing on this class that would actually cost a full board its frame rate. */
export const AGGRO_SCAN_INTERVAL_MS = 200;

const TEAM_COLORS: Record<string, { body: number[]; trim: number[]; bar: number[] }> = {
  [TeamId.BLUE]: { body: [64, 142, 232], trim: [16, 44, 82], bar: [96, 186, 255] },
  [TeamId.RED]: { body: [226, 84, 68], trim: [86, 22, 18], bar: [255, 126, 106] },
};
const NEUTRAL_COLORS = { body: [150, 150, 160], trim: [40, 40, 48], bar: [200, 200, 210] };

export interface MinionOptions {
  game: AttackableUnitOptions['game'];
  position?: p5.Vector;
  teamId: string;
  /** Blue-base-first for blue, already reversed for red — see getLaneWaypoints. */
  waypoints: LaneWaypoint[];
  /** Which lane it belongs to, for debugging and for the spawner's bookkeeping. */
  lane?: string;
  preset?: MinionPresetData;
  /** Spawners hand in 1: waypoint 0 is the fountain the minion is standing on. */
  startWaypointIndex?: number;
}

export type MinionPhase = (typeof Minion.PHASES)[keyof typeof Minion.PHASES];

/**
 * A lane minion. A sibling of Monster rather than a rewrite of it: same
 * scan-on-an-interval, same swing-on-a-cooldown, same "read the phase before
 * super.update() so Stats.update() sees the right regen" ordering. What differs
 * is that a minion has somewhere to be — it walks a fixed waypoint list from its
 * own base to the enemy one, fighting whatever is in the way — and that it never
 * comes back once killed.
 */
export default class Minion extends AttackableUnit {
  static PHASES = {
    WALK: 'WALK',
    ATTACK: 'ATTACK',
  };

  /**
   * Above a bare AttackableUnit, below jungle camps, turrets and champions.
   * A wave should never paint over the units the player is actually reading.
   */
  static displayZIndex = 3.2;

  /** Read by spell damage multipliers (Pantheon Q) to soften hits on a wave. */
  readonly unitType = 'minion';

  name: string;
  kind: MinionKind;
  lane: string;
  phase: MinionPhase = Minion.PHASES.WALK;
  waypoints: LaneWaypoint[];
  waypointIndex: number;
  damage: number;
  attackInterval: number;
  attackRange: number;
  aggroRange: number;
  targetLock: AttackableUnit | null = null;

  /** ms left before the next swing. */
  _attackCooldown = 0;
  /** ms left on the swing flash — purely cosmetic. */
  _attackFlash = 0;
  /** ms left before the next aggro scan, jittered so a wave does not scan in lockstep. */
  _scanCooldown: number;

  constructor({
    game,
    position,
    teamId,
    waypoints,
    lane = '',
    preset = MinionPresets.melee,
    startWaypointIndex = 0,
  }: MinionOptions) {
    super({
      game,
      position: position ?? createVector(waypoints[0]?.x ?? 0, waypoints[0]?.y ?? 0),
      teamId,
      visionRadius: 0,
    });

    this.name = preset.name;
    this.kind = preset.kind;
    this.lane = lane;
    this.waypoints = waypoints;
    this.waypointIndex = Math.min(startWaypointIndex, Math.max(0, waypoints.length - 1));

    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = preset.speed;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.manaRegen.baseValue = 0;
    // no vision: FogOfWar only queries the player's own team for sight sources,
    // so this would be dead weight in the quadtree's display boxes
    this.stats.visionRadius.baseValue = 0;

    this.damage = preset.damage;
    this.attackInterval = preset.attackInterval;
    this.attackRange = preset.attackRange;
    this.aggroRange = preset.aggroRange;
    this._scanCooldown = Math.random() * AGGRO_SCAN_INTERVAL_MS;

    // animatedValues start at 10 and lerp; a wave popping in from a dot looks
    // like a bug when four of them spawn at once
    this.animatedValues.size = preset.size;
    this.animatedValues.displaySize = preset.size;
  }

  update() {
    super.update();
    if (this.isDead) return;

    if (this._attackFlash > 0) this._attackFlash -= deltaTime;
    if (this._attackCooldown > 0) this._attackCooldown -= deltaTime;

    this._scanCooldown -= deltaTime;
    if (this._scanCooldown <= 0) {
      this._scanCooldown = AGGRO_SCAN_INTERVAL_MS;
      this.targetLock = this.findTarget();
      this.phase = this.targetLock ? Minion.PHASES.ATTACK : Minion.PHASES.WALK;
    }

    if (this.phase === Minion.PHASES.ATTACK) this.updateAttack();
    else this.updateWalk();
  }

  updateWalk() {
    const waypoint = this.currentWaypoint;
    if (!waypoint) {
      this.stopMovement();
      return;
    }

    const reached =
      Math.hypot(this.position.x - waypoint.x, this.position.y - waypoint.y) <=
      WAYPOINT_TOLERANCE;
    if (reached && this.waypointIndex < this.waypoints.length - 1) {
      this.waypointIndex += 1;
    }

    const next = this.currentWaypoint;
    if (next) this.moveTo(next.x, next.y);
  }

  updateAttack() {
    const target = this.targetLock;
    // a lock can go stale between scans: the target dies, gets removed, or is
    // made untargetable by a buff. Monster hit exactly this and threw on the
    // next frame reading target.position off a corpse.
    if (!target || target.toRemove || target.isDead || !target.position) {
      this.targetLock = null;
      this.phase = Minion.PHASES.WALK;
      return;
    }

    // surface to surface, otherwise a 40px reach can never satisfy its own check
    // against two 34px bodies standing next to each other
    const reach =
      this.attackRange +
      this.stats.size.value / 2 +
      (target.stats?.size?.value ?? 0) / 2;
    const distance = p5.Vector.dist(this.position, target.position);

    if (distance > reach) {
      // close the gap, but only inside the radius that made us stop: a minion
      // that chases past it would leave the lane and its wall clearance behind
      this.moveTo(target.position.x, target.position.y);
    } else {
      this.stopMovement();
      if (this._attackCooldown <= 0) {
        this._attackCooldown = this.attackInterval;
        this._attackFlash = this.kind === 'ranged' ? 220 : 160;
        target.takeDamage(this.damage, this);
      }
    }
  }

  /**
   * Nearest hostile minion if there is one, otherwise the nearest of anything
   * else hostile — that ordering is what makes a wave fight the other wave
   * instead of peeling off after whichever champion wandered past. Jungle camps
   * are excluded outright: a lane minion has no business clearing the jungle,
   * and the camps leash anyway so it would be a fight nobody wins.
   */
  findTarget(): AttackableUnit | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.aggroRange,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.teamId),
        PredefinedFilters.excludeType(Monster),
      ],
    });

    let nearestMinion: AttackableUnit | null = null;
    let nearestMinionDist = Infinity;
    let nearestOther: AttackableUnit | null = null;
    let nearestOtherDist = Infinity;

    for (const unit of found) {
      if (unit === this) continue;
      const d = p5.Vector.dist(this.position, unit.position);
      if (d > this.aggroRange) continue;
      if (unit instanceof Minion) {
        if (d < nearestMinionDist) {
          nearestMinionDist = d;
          nearestMinion = unit;
        }
      } else if (d < nearestOtherDist) {
        nearestOtherDist = d;
        nearestOther = unit;
      }
    }

    return nearestMinion ?? nearestOther;
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    super.takeDamage(damage, attacker);
    // super.takeDamage may have killed us; a corpse must not pick a fight. Only
    // swap targets when we have none — otherwise a wave under turret fire would
    // drop the minion it was killing every time a bolt landed.
    if (this.isDead || this.targetLock) return;
    if (!attacker || attacker instanceof Monster) return;
    if (attacker.teamId === this.teamId || attacker.isDead) return;
    this.targetLock = attacker;
    this.phase = Minion.PHASES.ATTACK;
  }

  /**
   * Minions are spent, not benched. AttackableUnit.update() runs a respawn timer
   * off `deathData`, so retiring the object outright is the only way to stay off
   * that path — a minion that respawned would come back at the enemy fountain
   * (randomSpawnPoint picks either one) with a lane it had already walked.
   */
  die(deathData: UnitDeathData) {
    super.die(deathData);
    this.targetLock = null;
    this.stopMovement();
    this.toRemove = true;
  }

  /** Belt and braces: nothing should reach this, and if it does it must not revive. */
  respawn() {
    this.toRemove = true;
  }

  // ---------------------------------------------------------------- rendering

  get currentWaypoint(): LaneWaypoint | undefined {
    return this.waypoints[this.waypointIndex];
  }

  get colors() {
    return TEAM_COLORS[this.teamId] ?? NEUTRAL_COLORS;
  }

  /**
   * Team colour, not `isAllied`: that getter means "same team as the player",
   * and since the player carries a uuid teamId it would paint every minion on
   * the map with the enemy's red outline.
   *
   * Hand-drawn on purpose — no avatar, no particle system, no trail. There can
   * be four dozen of these on screen and each one has to stay a handful of
   * draw calls.
   */
  draw() {
    if (this.isDead) return;

    const pos = this.position;
    const size = this.stats.size.value;
    const { body, trim } = this.colors;

    push();
    noStroke();
    fill(trim[0], trim[1], trim[2], 200);
    circle(pos.x, pos.y, size * 1.12);
    fill(body[0], body[1], body[2]);
    circle(pos.x, pos.y, size);

    if (this.kind === 'ranged') {
      // a caster reads as a ring rather than a disc, so the back line of a wave
      // is separable from the front one at a glance
      noFill();
      stroke(255, 235, 190, 220);
      strokeWeight(3);
      circle(pos.x, pos.y, size * 0.5);
    } else {
      fill(255, 255, 255, 90);
      circle(pos.x - size * 0.14, pos.y - size * 0.14, size * 0.34);
    }
    pop();

    this.drawSwing();
    // buffs land on minions like they do on anyone else — a stunned minion with
    // no visual reads as a stuck one. Free when the list is empty, which it
    // usually is
    this.drawBuffs();
    this.drawHealthBar();
  }

  /** Points at whatever it is hitting. The base class points at the mouse. */
  drawDir() {}

  drawSwing() {
    if (this._attackFlash <= 0 || !this.targetLock?.position) return;

    const pos = this.position;
    const dir = p5.Vector.sub(this.targetLock.position, pos);
    if (dir.magSq() === 0) return;

    const flash = Math.min(255, this._attackFlash * 1.6);
    push();
    if (this.kind === 'ranged') {
      // a bolt drawn as a fading tracer, rather than a MissileSpellObject: one
      // more object per minion per swing is exactly the cost this class avoids
      const { bar } = this.colors;
      stroke(bar[0], bar[1], bar[2], flash * 0.8);
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + dir.x, pos.y + dir.y);
    } else {
      dir.setMag(this.stats.size.value / 2 + 12);
      stroke(255, 220, 160, flash);
      strokeWeight(5);
      line(pos.x, pos.y, pos.x + dir.x, pos.y + dir.y);
    }
    pop();
  }

  /** Tiny, and no readout — a champion bar on 48 units is a wall of text. */
  drawHealthBar() {
    const pos = this.position;
    const size = this.stats.size.value;
    const w = 30;
    const h = 4;
    const x = pos.x - w / 2;
    const y = pos.y - size * 0.72 - h;
    const percent = Math.max(
      0,
      Math.min(1, this.stats.health.value / this.stats.maxHealth.value)
    );

    push();
    noStroke();
    fill(10, 12, 16, 210);
    rect(x - 1, y - 1, w + 2, h + 2);
    const { bar } = this.colors;
    fill(bar[0], bar[1], bar[2]);
    rect(x, y, w * percent, h);
    pop();
  }

  getDisplayBoundingBox() {
    // the base sizes an allied unit's box by its vision radius; a minion grants
    // no vision, so its box is just its body
    const size = this.stats.size.value * 1.4;
    return new Rectangle({
      x: this.position.x - size / 2,
      y: this.position.y - size / 2,
      w: size,
      h: size,
      data: this,
    });
  }
}
