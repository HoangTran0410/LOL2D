import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import DamageOverTime from '../buffs/DamageOverTime';
import TrailSystem from '../helpers/TrailSystem';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const RANGE = 380;
export const ON_HIT_DAMAGE = 9;
export const POISON_DAMAGE_PER_TICK = 6;
export const POISON_TICK_INTERVAL_MS = 1_000;
// 4 ticks over the duration => 24 total poison damage, matching the imported
// rank-1 wiki figure ("Total Poison Damage: 24").
export const POISON_DURATION_MS = 4_000;
export const MANA_COST = 25;

/**
 * The real Toxic Shot is a passive that piggybacks on basic attacks. This
 * project has no auto-attack system for a passive to hang off, so it becomes
 * an active poison dart instead of a self-buff that waits for another
 * ability to land: a self-buff would have to reach into Teemo_Q/Teemo_R's
 * `onHit` to know when "the next ability" connects, coupling three spell
 * files together for one effect. A dedicated dart is self-contained, reads
 * immediately on cast like the rest of the kit (Q's dart, R's trap), and
 * gives Teemo a sustained-damage tool his kit is otherwise missing. It reuses
 * `DamageOverTime` for the poison rather than a second damage-over-time buff.
 */
export default class Teemo_E extends Spell {
  image = AssetManager.get('spell_teemo_e');
  name = 'Phi Tiêu Độc (Teemo_E)';
  description =
    'Chủ động: Teemo bắn một mũi tẩm độc đậm đặc về hướng chỉ định, gây <span class="damage">9 sát thương</span> tức thì và khiến mục tiêu <span class="buff">Trúng Độc</span>, mất thêm <span class="damage">6 sát thương mỗi giây</span> trong <span class="time">4 giây</span>.';
  // kept as a literal (not an exported constant) so the repo-wide arcade
  // cooldown-cap scan in tests/game/spells/cooldowns.test.ts can see it
  coolDown = 4_000;
  manaCost = MANA_COST;

  range = RANGE;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

    const obj = new Teemo_E_Object(this.owner);
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Teemo_E_Object extends MissileSpellObject {
  speed = 11;
  size = 16;
  onHitDamage = ON_HIT_DAMAGE;
  poisonDamagePerTick = POISON_DAMAGE_PER_TICK;
  poisonTickInterval = POISON_TICK_INTERVAL_MS;
  poisonDuration = POISON_DURATION_MS;

  // a single vial: it embeds in the first thing it hits, same as Teemo's Q
  maxHitCount = 1;

  /** Cosmetic: the vial tumbles end over end as it flies. */
  _spin = random(TWO_PI);

  trailSystem = new TrailSystem({
    trailSize: this.size / 2,
    trailColor: '#7CFF5C55',
    maxLength: 12,
  });

  onAfterMove() {
    this._spin += 0.35;
  }

  onHit(enemy: AttackableUnit) {
    enemy.takeDamage(this.onHitDamage, this.owner);

    const poison = new DamageOverTime(this.poisonDuration, this.owner, enemy);
    poison.stackId = 'teemo_e_toxicshot';
    poison.image = AssetManager.get('spell_teemo_e');
    poison.name = 'Trúng Độc';
    poison.damagePerTick = this.poisonDamagePerTick;
    poison.tickInterval = this.poisonTickInterval;
    poison.flameColor = [210, 255, 110];
    poison.emberColor = [55, 120, 20];
    enemy.addBuff(poison);

    // the vial shatters on impact, so the poison burst is its own object
    const splash = new Teemo_E_Splash(this.owner);
    splash.position = enemy.position.copy();
    splash.targetSize = enemy.animatedValues?.displaySize ?? 40;
    this.game.objectManager.addObject(splash);
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const s = this.size;

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    rotate(sin(this._spin) * 0.5);

    // ooze dripping off the vial as it flies
    noStroke();
    for (let i = 0; i < 3; i++) {
      fill(140, 230, 80, 65 - i * 18);
      circle(-s * (0.5 + i * 0.35) + random(-1, 1), s * 0.2 + i * 2, 5 - i);
    }

    // corked glass vial: a rounded body with a narrow neck
    stroke(30, 55, 20, 230);
    strokeWeight(1.5);
    fill(90, 200, 70, 195);
    ellipse(0, 0, s * 1.2, s * 0.85);
    fill(70, 60, 45, 230);
    rect(-s * 0.75, -s * 0.16, s * 0.3, s * 0.32, 2);

    // glowing toxic core inside the glass
    blendMode(ADD);
    noStroke();
    fill(170, 255, 110, 140);
    circle(s * 0.08, 0, s * 0.65);
    blendMode(BLEND);

    // glass highlight
    stroke(230, 255, 200, 200);
    strokeWeight(1);
    noFill();
    arc(0, -s * 0.08, s * 0.9, s * 0.6, PI + 0.4, PI + 1.6);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size * 2.2;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** Poison bursting where the vial shattered — the toxin taking hold. */
export class Teemo_E_Splash extends SpellObject {
  targetSize = 40;
  age = 0;
  lifeTime = 500;
  maxRadius = 40;

  _drops: { angle: number; distance: number; size: number }[] = [];

  onAdded() {
    for (let i = 0; i < 6; i++) {
      this._drops.push({
        angle: random(TWO_PI),
        distance: random(0.4, 1),
        size: random(6, 12),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);

    noStroke();
    fill(90, 190, 60, 150 * fade);
    circle(0, 0, this.targetSize * (0.6 + t * 0.6));

    for (const drop of this._drops) {
      const d = this.maxRadius * t * drop.distance;
      fill(150, 240, 100, 170 * fade);
      circle(cos(drop.angle) * d, sin(drop.angle) * d, drop.size * (1 - t * 0.5));
    }

    noFill();
    stroke(190, 255, 130, 210 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, this.targetSize * 0.6 + this.maxRadius * 1.3 * t);

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.targetSize + this.maxRadius * 1.5;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
