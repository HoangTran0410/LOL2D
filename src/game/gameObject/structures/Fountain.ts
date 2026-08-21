import { Circle, Rectangle } from '@/libs/quadtree';
import GameObject from '@/game/gameObject/GameObject';
import type { GameObjectRuntimeContext } from '@/game/gameObject/GameObject';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import { FOUNTAIN_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';

export interface FountainPresetData {
  name: string;
  x: number;
  y: number;
  /** Healing radius, also the drawn platform radius. */
  r: number;
  /** Which base this platform is, from TeamId. Its minions inherit it. */
  teamId?: string;
  /** ms between restore ticks. */
  tickInterval?: number;
  /** Fraction of max health restored per tick. */
  healPercent?: number;
  /** Fraction of max mana restored per tick. */
  manaPercent?: number;
}

interface Mote {
  angle: number;
  radius: number;
  rise: number;
  life: number;
}

/**
 * Bệ Đá Cổ — the spawn platform. Allied champions standing inside get a slice
 * of health and mana back on every tick, so it is somewhere to retreat to
 * rather than just a spawn marker.
 *
 * Deliberately a plain GameObject, not an AttackableUnit: it has no health, it
 * cannot be attacked, and FogOfWar's visibleToPlayerTeam reset only touches units.
 *
 * Its TeamId is shared with that base's turrets, minions and champions. Enemy
 * champions may cross the platform, but never receive its restoration.
 */
export default class Fountain extends GameObject {
  declare game: GameObjectRuntimeContext;
  /** Under everything else — it is a floor. */
  zIndex = FOUNTAIN_Z_INDEX;

  name: string;
  radius: number;
  tickInterval: number;
  healPercent: number;
  manaPercent: number;

  _tickCooldown = 0;
  _pulse = 0;
  _motes: Mote[] = [];
  _moteCooldown = 0;

  constructor({ game, preset }: { game: GameObjectRuntimeContext; preset: FountainPresetData }) {
    super({
      game,
      position: createVector(preset.x, preset.y),
      visionRadius: 0,
      teamId: preset.teamId,
    });

    this.name = preset.name;
    this.radius = preset.r;
    this.tickInterval = preset.tickInterval ?? 500;
    this.healPercent = preset.healPercent ?? 0.12;
    this.manaPercent = preset.manaPercent ?? 0.12;
  }

  update() {
    this._pulse += deltaTime * 0.0022;
    this.updateMotes();

    this._tickCooldown -= deltaTime;
    if (this._tickCooldown > 0) return;
    this._tickCooldown = this.tickInterval;

    for (const champion of this.championsInside()) {
      const stats = champion.stats;

      // takeHeal spawns a CombatText, so only heal something that is missing
      const missingHealth = stats.maxHealth.value - stats.health.value;
      if (missingHealth > 0.5) {
        const heal = Math.min(missingHealth, stats.maxHealth.value * this.healPercent);
        champion.takeHeal(Math.round(heal), this);
      }

      const missingMana = stats.maxMana.value - stats.mana.value;
      if (missingMana > 0.5) {
        stats.mana.baseValue = Math.min(
          stats.maxMana.value,
          stats.mana.baseValue + stats.maxMana.value * this.manaPercent
        );
      }
    }
  }

  championsInside(): Champion[] {
    return this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [
        PredefinedFilters.type(Champion),
        PredefinedFilters.teamId(this.teamId),
        PredefinedFilters.excludeDead,
      ],
    });
  }

  updateMotes() {
    this._moteCooldown -= deltaTime;
    if (this._moteCooldown <= 0 && this._motes.length < 26) {
      this._moteCooldown = 90;
      this._motes.push({
        angle: random(TWO_PI),
        radius: random(this.radius * 0.2, this.radius * 0.95),
        rise: 0,
        life: 1,
      });
    }

    let i = 0;
    while (i < this._motes.length) {
      const m = this._motes[i];
      m.rise += deltaTime * 0.045;
      m.angle += deltaTime * 0.0004;
      m.life -= deltaTime * 0.0009;
      if (m.life <= 0) this._motes.splice(i, 1);
      else i++;
    }
  }

  draw() {
    const { x, y } = this.position;
    const r = this.radius;
    const breathe = 1 + Math.sin(this._pulse) * 0.03;

    push();
    noStroke();

    // outer glow
    fill(70, 190, 235, 26);
    circle(x, y, r * 2 * breathe);
    fill(70, 190, 235, 34);
    circle(x, y, r * 1.7);

    // platform
    fill(22, 44, 60, 235);
    circle(x, y, r * 1.5);
    fill(30, 62, 82, 235);
    circle(x, y, r * 1.32);

    // rune ring
    push();
    translate(x, y);
    rotate(this._pulse * 0.35);
    noFill();
    stroke(120, 230, 255, 170);
    strokeWeight(4);
    circle(0, 0, r * 1.05);
    strokeWeight(3);
    for (let i = 0; i < 8; i++) {
      const a0 = (TWO_PI / 8) * i;
      arc(0, 0, r * 1.32, r * 1.32, a0, a0 + 0.28);
    }
    pop();

    // centre sigil
    push();
    translate(x, y);
    rotate(-this._pulse * 0.6);
    stroke(180, 245, 255, 210);
    strokeWeight(5);
    noFill();
    beginShape();
    for (let i = 0; i < 6; i++) {
      const a = (TWO_PI / 6) * i;
      vertex(cos(a) * r * 0.3, sin(a) * r * 0.3);
    }
    endShape(CLOSE);
    pop();

    // rising motes
    noStroke();
    for (const m of this._motes) {
      const mx = x + cos(m.angle) * m.radius;
      const my = y + sin(m.angle) * m.radius - m.rise;
      fill(150, 240, 255, 200 * m.life);
      circle(mx, my, 6 * m.life + 2);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const size = this.radius * 2.2;
    return new Rectangle({
      x: this.position.x - size / 2,
      y: this.position.y - size / 2,
      w: size,
      h: size,
      data: this,
    });
  }

  getCollideBoundingBox(): Circle {
    return new Circle({
      x: this.position.x,
      y: this.position.y,
      r: this.radius,
      data: this,
    });
  }

  /** A jittered point on the platform, used as a spawn / respawn location. */
  randomPointInside(): p5.Vector {
    const a = random(TWO_PI);
    const d = random(this.radius * 0.65);
    return createVector(this.position.x + cos(a) * d, this.position.y + sin(a) * d);
  }
}
