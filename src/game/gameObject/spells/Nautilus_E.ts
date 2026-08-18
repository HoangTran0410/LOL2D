import { Circle, Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange } from '@/game/combat/Reach';
import BuffAddType from '@/game/enums/BuffAddType';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Slow from '@/game/gameObject/buffs/Slow';

export const E_RADII = [130, 220, 310];
export const E_MAX_RADIUS = E_RADII[E_RADII.length - 1];
export const E_WAVE_GAP_MS = 250;
export const E_WAVE_DAMAGE = 14;
export const E_SLOW = 0.3;
export const E_SLOW_MS = 1_500;
/** How long one wave's columns stand before they fall back. */
export const E_WAVE_LIFE_MS = 520;
export const E_COLUMN_SPACING = 26;
export const E_COLUMN_HEIGHT = 34;

const IRON: [number, number, number] = [120, 144, 156];
const RUST: [number, number, number] = [75, 101, 132];
const FOAM: [number, number, number] = [168, 230, 207];

export default class Nautilus_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_nautilus_e');
  name = 'Thủy Triều Dữ Dội (Nautilus_E)';
  description =
    `Ba đợt cột nước dựng lên quanh Nautilus ở ${E_RADII.join(', ')} đơn vị, cách nhau ` +
    `${E_WAVE_GAP_MS / 1000} giây. Mỗi đợt gây <span class="damage">${E_WAVE_DAMAGE} sát thương</span> ` +
    `và làm chậm ${Math.round(E_SLOW * 100)}%. Đứng yên là ăn đủ cả ba.`;
  coolDown = 10_000;
  manaCost = 40;
  range = E_MAX_RADIUS;

  onSpellCast(): void {
    this.game.objectManager.addObject(new Nautilus_E_Object(this.owner));
  }
}

/** One of the three eruptions: its own radius, its own moment, its own hit set. */
export interface NautilusTide {
  radius: number;
  fireAtMs: number;
  fired: boolean;
  age: number;
  hit: Set<AttackableUnit>;
  columns: number[];
}

/**
 * Three waves from one object.
 *
 * The hit sets are deliberately *per wave* and never shared: a unit that stands
 * through all three takes three hits, and one that walks out after the first
 * takes one. Sharing a single set would silently turn the ability into a single
 * 14-damage pulse with a long animation.
 *
 * Ground art, so `zIndex = 2` — `Z_INDEX_MAP` is keyed by exact constructor and a
 * `SpellObject` subclass otherwise falls through to 99, above the feet of
 * everyone standing in the rings.
 */
export class Nautilus_E_Object extends SpellObject {
  zIndex = 2;
  age = 0;
  lifeTime = (E_RADII.length - 1) * E_WAVE_GAP_MS + E_WAVE_LIFE_MS;
  waves: NautilusTide[] = [];

  constructor(owner: AttackableUnit) {
    super(owner);
    this.position = owner.position.copy();
    for (let i = 0; i < E_RADII.length; i++) {
      this.waves.push({
        radius: E_RADII[i],
        fireAtMs: i * E_WAVE_GAP_MS,
        fired: false,
        age: 0,
        hit: new Set<AttackableUnit>(),
        columns: [],
      });
    }
  }

  onAdded(): void {
    // Seeded once: a per-wave spin, so the three rings are visibly three rings
    // instead of one set of spokes drawn at three sizes.
    for (const wave of this.waves) {
      const spin = random(0, TWO_PI);
      const count = Math.max(8, Math.round((TWO_PI * wave.radius) / (E_COLUMN_SPACING * 2)));
      for (let i = 0; i < count; i++) wave.columns.push(spin + (TWO_PI * i) / count);
    }
  }

  update(): void {
    for (const wave of this.waves) {
      if (!wave.fired && this.age >= wave.fireAtMs) {
        wave.fired = true;
        this.fireWave(wave);
      }
      if (wave.fired) wave.age += deltaTime;
    }
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  /**
   * One wave's damage, gated by that wave's own set. The query keeps its collide
   * test, so the radius takes only the caster term from `Reach`.
   */
  fireWave(wave: NautilusTide): void {
    const drowned = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: effectiveRange(wave.radius, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of drowned) {
      if (wave.hit.has(victim)) continue;
      wave.hit.add(victim);
      victim.takeDamage(E_WAVE_DAMAGE, this.owner);
      const undertow = new Slow(E_SLOW_MS, this.owner, victim);
      undertow.percent = E_SLOW;
      undertow.stackId = 'nautilus_e_undertow';
      // Three waves refresh one undertow rather than stacking to a 90% slow.
      undertow.buffAddType = BuffAddType.RENEW_EXISTING;
      victim.addBuff(undertow);
    }
  }

  draw(): void {
    push();
    for (const wave of this.waves) {
      if (!wave.fired) continue;
      const t = constrain(wave.age / E_WAVE_LIFE_MS, 0, 1);
      if (t >= 1) continue;
      const risen = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      noFill();
      stroke(RUST[0], RUST[1], RUST[2], 180 * fade);
      strokeWeight(3);
      circle(this.position.x, this.position.y, wave.radius * 2);

      for (const angle of wave.columns) {
        const cx = this.position.x + cos(angle) * wave.radius;
        const cy = this.position.y + sin(angle) * wave.radius;
        const tall = E_COLUMN_HEIGHT * risen * fade + 5;
        stroke(FOAM[0], FOAM[1], FOAM[2], 220 * fade);
        strokeWeight(5 * fade + 2);
        line(cx, cy, cx, cy - tall);
        stroke(IRON[0], IRON[1], IRON[2], 160 * fade);
        strokeWeight(3);
        line(cx, cy, cx, cy - tall * 0.55);
      }
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    return this.squareDisplayBoundingBox((E_MAX_RADIUS + E_COLUMN_HEIGHT + 14) * 2);
  }
}
