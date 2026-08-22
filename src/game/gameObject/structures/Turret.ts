import { Circle } from '@/libs/quadtree';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type { KillCredit } from '@/game/combat/MatchTally';
import type { AttackableUnitOptions } from '@/game/gameObject/attackableUnits/AttackableUnit';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion, { AGGRO_SCAN_INTERVAL_MS, teamColors } from '@/game/gameObject/attackableUnits/Minion';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import { OBJECTIVE_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';
import { canSee } from '@/game/combat/Vision';

export interface TurretPresetData {
  health: number;
  size: number;
  attackRange: number;
  attackInterval: number;
  damage: number;
  /** ms before a destroyed turret comes back. */
  rebuildTime: number;
  /** ms without taking damage before it starts repairing itself. */
  repairDelay: number;
  /** health per frame once repairing. */
  repairRate: number;
}

export const DEFAULT_TURRET_PRESET: TurretPresetData = {
  health: 400,
  size: 92,
  attackRange: 430,
  attackInterval: 1300,
  damage: 12,
  rebuildTime: 30000,
  repairDelay: 6000,
  repairRate: 0.4,
};

export interface TurretOptions {
  game: AttackableUnitOptions['game'];
  position?: p5.Vector;
  preset?: TurretPresetData;
  /** The base this turret defends, from TeamId. */
  teamId?: string;
}

/**
 * A team building. It carries the TeamId of the base it defends — `turret1` in
 * summoner_map.json is the blue row, `turret2` the red one — and shoots the
 * nearest hostile thing inside `attackRange`, preferring minions over champions
 * the way a real turret does. Destroying one opens the ground around it up for
 * `rebuildTime`, then it rebuilds where it stood, at full health.
 *
 * Production champions share one of the two lane team ids, so the same
 * `canTakeDamageFromTeam(this.teamId)` rule rejects allied champions and
 * minions while keeping the opposing side targetable. No turret-specific ally
 * exception is needed.
 */
export default class Turret extends AttackableUnit {
  /** A building is not farm — killing one moves nobody's CS. */
  killCredit: KillCredit = 'none';

  /** Above plain units, below champions. */
  zIndex = OBJECTIVE_Z_INDEX;
  /** A building the player has seen stays drawn through the fog. */
  alwaysVisible = true;
  /**
   * Units bounce off a turret, they never shove it. It re-anchors after its
   * buffs run each frame, so a body that pushed it would only make it snap back.
   */
  isImmovable = true;

  name = 'Trụ';
  attackRange: number;
  attackInterval: number;
  damage: number;
  rebuildTime: number;
  repairDelay: number;
  repairRate: number;

  target: AttackableUnit | null = null;
  _attackCooldown = 0;
  /** Time left until the next full target scan — see `update`. */
  _scanCooldown = 0;
  /** ms since the last hit taken — gates self-repair. */
  _sinceDamaged = Infinity;
  /** ms left on the muzzle flash. */
  _fireFlash = 0;
  /** ms left on the hit flash. */
  _hitFlash = 0;
  _spin = 0;
  /**
   * Where the turret was built. Buffs that displace a unit (Dash — which is what
   * a hook or a lantern-pull ability constructs) write straight to `position` and never
   * consult canMove, so a hook could otherwise drag a building across the map.
   */
  _anchor: p5.Vector;

  constructor({ game, position, preset = DEFAULT_TURRET_PRESET, teamId }: TurretOptions) {
    super({ game, position, visionRadius: 0, teamId });

    this.stats.size.baseValue = preset.size;
    this.stats.speed.baseValue = 0;
    this.stats.maxHealth.baseValue = preset.health;
    this.stats.health.baseValue = preset.health;
    this.stats.healthRegen.baseValue = 0;
    this.stats.manaRegen.baseValue = 0;
    this.stats.visionRadius.baseValue = 0;

    this.attackRange = preset.attackRange;
    this.attackInterval = preset.attackInterval;
    this.damage = preset.damage;
    this.rebuildTime = preset.rebuildTime;
    this.repairDelay = preset.repairDelay;
    this.repairRate = preset.repairRate;
    this.reviveTime = preset.rebuildTime;

    this._anchor = this.position.copy();
  }

  update() {
    this._sinceDamaged += deltaTime;
    // Stats.update() inside super.update() applies this, so set it first
    this.stats.healthRegen.baseValue =
      !this.isDead && this._sinceDamaged > this.repairDelay ? this.repairRate : 0;

    super.update();

    // buffs ran inside super.update(); undo anything that tried to move us
    this.position.set(this._anchor.x, this._anchor.y);
    this.destination.set(this._anchor.x, this._anchor.y);

    this._spin += deltaTime * 0.0006;
    if (this._fireFlash > 0) this._fireFlash -= deltaTime;
    if (this._hitFlash > 0) this._hitFlash -= deltaTime;

    if (this.isDead) {
      this.target = null;
      return;
    }

    this._attackCooldown -= deltaTime;

    // Re-scan on a cadence, the way minions and camps already do. A turret
    // fires at most once per `attackInterval` (1300ms), so re-picking its
    // target 60 times a second bought nothing and cost a quadtree query plus
    // a Circle and four filter closures every frame, per turret.
    //
    // The cadence never delays *dropping* a target: `stillValidTarget` re-runs
    // the same predicates `findTarget` filters on, against the one unit we
    // already hold, every frame. So stealth, death, untargetability, a team
    // change or walking out of range still break aggro on the frame they
    // happen — only *acquiring* a new target waits for the next scan, and it
    // rescans immediately when the current one is lost.
    this._scanCooldown -= deltaTime;
    if (this._scanCooldown <= 0 || !this.stillValidTarget(this.target)) {
      this._scanCooldown = AGGRO_SCAN_INTERVAL_MS;
      this.target = this.findTarget();
    }
    // `canAttack` for the same reason minions and camps need it: a building
    // fires on its own timer and never went through `BasicAttackController`, so
    // crowd control spent on a turret bought nothing at all.
    if (this.target && this.canAttack && this._attackCooldown <= 0) {
      this._attackCooldown = this.attackInterval;
      this._fireFlash = 220;
      this.fireAt(this.target);
    }
  }

  /**
   * Nearest hostile minion, else nearest hostile champion. Minions come first
   * because that is what makes a turret a lane obstacle rather than a champion
   * tax: a wave under an enemy turret soaks the shots while its champion pushes.
   *
   * Still champions and minions only — a turret next to a jungle camp would
   * otherwise farm it forever, and one next to another turret would shoot that.
   */
  /**
   * The predicates `findTarget` filters on, re-checked against a single unit
   * we already hold. Kept in step with the filter list below by hand — there
   * is no way to run a `PredefinedFilters` chain against one object without
   * rebuilding the closures this exists to avoid.
   */
  private stillValidTarget(target: AttackableUnit | null): boolean {
    if (!target) return false;
    if (target.isDead || !target.targetable) return false;
    if (target.isStealthed) return false;
    if (target.teamId === this.teamId) return false;
    if (!(target instanceof Champion || target instanceof Minion)) return false;

    const dx = target.position.x - this.position.x;
    const dy = target.position.y - this.position.y;
    if (dx * dx + dy * dy > this.attackRange * this.attackRange) return false;

    return canSee(this, target);
  }

  findTarget(): AttackableUnit | null {
    const found = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.attackRange,
      }),
      filters: [
        PredefinedFilters.includeTypes([Champion, Minion]),
        PredefinedFilters.canTakeDamageFromTeam(this.teamId),
        PredefinedFilters.visibleTo(this),
        PredefinedFilters.excludeStealthed,
      ],
    });

    // Ally protection: an enemy champion attacking an allied champion under this
    // turret is shot before anything else — the reason standing under your own
    // tower is safe. Only enemies already in `found` (in range, visible, not
    // stealthed) qualify, so the switch always lands on a shootable target.
    const defender = this.findAllyAttacker(found as AttackableUnit[]);
    if (defender) return defender;

    let nearestMinion: AttackableUnit | null = null;
    let nearestMinionDist = Infinity;
    let nearestChampion: AttackableUnit | null = null;
    let nearestChampionDist = Infinity;

    for (const unit of found) {
      // Squared: these two numbers are only ever compared with each other, and
      // squaring is monotonic, so the nearest unit is the same one without the
      // per-candidate sqrt (and without p5.Vector.dist's copy/sub pair).
      const dx = unit.position.x - this.position.x;
      const dy = unit.position.y - this.position.y;
      const d = dx * dx + dy * dy;
      if (unit instanceof Minion) {
        if (d < nearestMinionDist) {
          nearestMinionDist = d;
          nearestMinion = unit;
        }
      } else if (d < nearestChampionDist) {
        nearestChampionDist = d;
        nearestChampion = unit;
      }
    }

    return nearestMinion ?? nearestChampion;
  }

  /**
   * The enemy champion in range currently attacking an allied champion under
   * this turret, nearest to the turret — or null. Runs only on the aggro scan
   * cadence, not every frame, and reuses the freshly queried enemy set, so it
   * costs one extra ally query only when an enemy champion is actually present.
   */
  private findAllyAttacker(enemiesInRange: AttackableUnit[]): AttackableUnit | null {
    let hasEnemyChampion = false;
    for (const enemy of enemiesInRange) {
      if (enemy instanceof Champion) {
        hasEnemyChampion = true;
        break;
      }
    }
    if (!hasEnemyChampion) return null;

    const inRange = new Set(enemiesInRange);
    const allies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.attackRange }),
      filters: [PredefinedFilters.type(Champion), PredefinedFilters.teamId(this.teamId)],
    }) as AttackableUnit[];

    let best: AttackableUnit | null = null;
    let bestDist = Infinity;
    for (const ally of allies) {
      if (ally.isDead) continue;
      const enemy = ally.recentAttacker;
      if (!enemy || !(enemy instanceof Champion) || !inRange.has(enemy)) continue;
      const dx = enemy.position.x - this.position.x;
      const dy = enemy.position.y - this.position.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  /** A turret lights its own reach for the team; it carries no combat sight. */
  get fogRevealRadius(): number {
    return this.attackRange;
  }

  fireAt(target: AttackableUnit) {
    const bolt = new TurretBolt(this);
    bolt.target = target;
    bolt.damage = this.damage;
    bolt.position.set(this.position.x, this.position.y - this.stats.size.value * 0.35);
    bolt.destination.set(target.position.x, target.position.y);
    this.game.objectManager.addObject(bolt);
  }

  takeDamage(damage: number, attacker?: AttackableUnit) {
    if (this.isDead) return;
    super.takeDamage(damage, attacker);
    this._sinceDamaged = 0;
    this._hitFlash = 180;
  }

  respawn() {
    // the base drops the unit on a spawn point; a building rebuilds where it stood
    this.stats.health.baseValue = this.stats.maxHealth.value;
    this.deathData = null;
    this.position.set(this._anchor.x, this._anchor.y);
    this.destination.set(this._anchor.x, this._anchor.y);
    this._sinceDamaged = Infinity;
    this._attackCooldown = 0;
    this.target = null;
  }

  // ---------------------------------------------------------------- rendering

  draw() {
    const pos = this.position;
    const size = this.stats.size.value;

    push();
    if (this.isDead) {
      this.drawRubble(pos, size);
      pop();
      this.drawRebuildTimer(pos, size);
      return;
    }

    // threat ring, only while something is in range
    if (this.target) {
      noFill();
      stroke(255, 90, 60, 60);
      strokeWeight(3);
      circle(pos.x, pos.y, this.attackRange * 2);
    }

    // The stone stays dark, but the pad and tower take the base's team colour
    // so a turret row reads as its side's at a glance — the same blue/red a
    // minion carries, shared through `teamColors` so the two never disagree.
    const team = teamColors(this.teamId);

    // stone base
    noStroke();
    fill(28, 30, 38, 230);
    circle(pos.x, pos.y, size * 1.15);
    fill(team.trim[0], team.trim[1], team.trim[2]);
    circle(pos.x, pos.y, size);

    // body — an octagonal tower
    push();
    translate(pos.x, pos.y);
    rotate(this._spin);
    fill(team.body[0], team.body[1], team.body[2]);
    stroke(20, 22, 28);
    strokeWeight(3);
    beginShape();
    for (let i = 0; i < 8; i++) {
      const a = (TWO_PI / 8) * i;
      vertex(cos(a) * size * 0.34, sin(a) * size * 0.34);
    }
    endShape(CLOSE);
    pop();

    // the barrel points at whatever it is shooting
    const aim = this.target ? p5.Vector.sub(this.target.position, pos) : createVector(0, -1);
    if (aim.magSq() === 0) aim.set(0, -1);
    aim.setMag(size * 0.55);
    stroke(this.target ? [255, 170, 70] : [130, 136, 150]);
    strokeWeight(9);
    line(pos.x, pos.y, pos.x + aim.x, pos.y + aim.y);

    // core: brightens when charged, flares on the shot
    const charge = 1 - Math.max(0, this._attackCooldown) / this.attackInterval;
    const flash = Math.max(0, this._fireFlash) / 220;
    noStroke();
    fill(255, 200 - 80 * (1 - charge), 90, 120 + 135 * charge);
    circle(pos.x, pos.y, size * 0.26 + flash * size * 0.35);

    if (this._hitFlash > 0) {
      noFill();
      stroke(255, 80, 80, (this._hitFlash / 180) * 220);
      strokeWeight(5);
      circle(pos.x, pos.y, size * 1.2);
    }
    pop();

    this.drawHealthBar();
  }

  drawRubble(pos: p5.Vector, size: number) {
    noStroke();
    fill(26, 28, 34, 200);
    circle(pos.x, pos.y, size * 1.05);
    fill(64, 60, 56, 220);
    for (let i = 0; i < 6; i++) {
      const a = (TWO_PI / 6) * i + 0.4;
      circle(pos.x + cos(a) * size * 0.24, pos.y + sin(a) * size * 0.24, size * 0.2);
    }
  }

  drawRebuildTimer(pos: p5.Vector, size: number) {
    push();
    noStroke();
    fill(190, 190, 200, 200);
    textAlign(CENTER, CENTER);
    // Overlay, not world — see Camera.constantSize.
    textSize(13 * (this.game?.camera?.constantSize?.(1) ?? 1));
    text(
      `Xây lại sau ${Math.ceil((this.deathData?.reviveAfter ?? 0) / 1000)}s`,
      pos.x,
      pos.y - size * 0.75
    );
    pop();
  }

  /** Compact bar: the base one is champion-sized and reads as a unit. */
  drawHealthBar() {
    const pos = this.position;
    const size = this.stats.size.value;
    // Overlay, not world: the bar and its text compensate together, so a
    // turret's health reads the same on a phone as on a desktop.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    const w = 84 * k;
    const h = 7 * k;
    const x = pos.x - w / 2;
    const y = pos.y - size * 0.75;
    const percent = Math.max(0, this.stats.health.value / this.stats.maxHealth.value);

    push();
    noStroke();
    fill(12, 14, 18, 220);
    rect(x - 2 * k, y - 2 * k, w + 4 * k, h + 4 * k);
    // Team-coloured fill, the same bar shade a minion carries, so a turret's
    // side is legible from its health bar as well as its body.
    const bar = teamColors(this.teamId).bar;
    fill(bar[0], bar[1], bar[2]);
    rect(x, y, w * percent, h);
    fill(200, 200, 210);
    textAlign(CENTER, CENTER);
    textSize(11 * k);
    text(`${~~this.stats.health.value} / ${~~this.stats.maxHealth.value}`, pos.x, y - 9 * k);
    pop();
  }

  drawDir() {}

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(this.stats.size.value * 1.6);
  }
}

/**
 * Turret shot. Homes on its one target and damages nobody else, so a bolt cannot
 * clip a jungle camp or a bystander on the way (`maxHitCount = 0` switches the
 * base class's in-flight collision off entirely).
 */
export class TurretBolt extends MissileSpellObject {
  speed = 13;
  size = 16;
  maxHitCount = 0;
  removeOnArrive = true;
  damage = 12;
  target: AttackableUnit | null = null;
  /** Fizzles if it somehow never arrives. */
  _life = 4000;

  trailSystem: TrailSystem = new TrailSystem({
    trailColor: '#ffb04daa',
    trailSize: 7,
    maxLength: 10,
    trailLifeTime: 220,
  });

  onBeforeMove() {
    this._life -= deltaTime;
    if (this._life <= 0) {
      this.toRemove = true;
      return;
    }
    // keep homing while the target lives; once it dies the bolt flies to the last
    // known point and expires there
    if (this.target && !this.target.isDead && !this.target.toRemove) {
      this.destination.set(this.target.position.x, this.target.position.y);
    }
  }

  onArrive() {
    const t = this.target;
    if (t && !t.isDead && !t.toRemove && t.targetable) {
      t.takeDamage(this.damage, this.owner);
    }
  }

  draw() {
    push();
    noStroke();
    fill(255, 210, 130, 90);
    circle(this.position.x, this.position.y, this.size * 1.9);
    fill(255, 236, 190);
    circle(this.position.x, this.position.y, this.size * 0.75);
    pop();
  }
}
