import { Circle, Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { GROUND_Z_INDEX, PredefinedFilters } from '@/game/managers/ObjectManager';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import Slow from '@/game/gameObject/buffs/Slow';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

export const TRYNDAMERE_W_RADIUS = 380;
export const TRYNDAMERE_W_SLOW_PERCENT = 0.35;
export const TRYNDAMERE_W_SLOW_MS = 2_500;
/** Flat attack damage taken off everyone who hears it. */
export const TRYNDAMERE_W_AD_REDUCTION = 10;
export const TRYNDAMERE_W_AD_REDUCTION_MS = 4_000;
export const TRYNDAMERE_W_STACK_ID = 'tryndamere-mocking-shout';

export default class Tryndamere_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_tryndamere_w');
  name = 'Tiếng Thét Uy Hiếp (Tryndamere_W)';
  description =
    'Gầm lên uy hiếp mọi kẻ địch trong <span>380px</span>: <span class="buff">giảm 10 sát thương đánh</span> ' +
    'trong <span class="time">4 giây</span> và <span class="buff">làm chậm 35%</span> trong <span class="time">2.5 giây</span>.';
  coolDown = 10_000;
  manaCost = 0;
  range = TRYNDAMERE_W_RADIUS;

  onSpellCast(): void {
    const origin = createVector(this.owner.position.x, this.owner.position.y);
    this.game.objectManager.addObject(new Tryndamere_W_Object(this.owner, origin));

    // An area effect, so no vision gate: the shout reaches the man in the bush
    // exactly as it reaches everyone else. The filter belongs on acquisition.
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: origin.x, y: origin.y, r: TRYNDAMERE_W_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const enemy of enemies) {
      const cower = new StatAmp(TRYNDAMERE_W_AD_REDUCTION_MS, this.owner, enemy);
      cower.stackId = TRYNDAMERE_W_STACK_ID;
      cower.name = 'Tiếng Thét Uy Hiếp';
      cower.image = this.image;
      cower.bonuses = { attackDamage: { flatBonus: -TRYNDAMERE_W_AD_REDUCTION } };
      enemy.addBuff(cower);

      const slow = new Slow(TRYNDAMERE_W_SLOW_MS, this.owner, enemy);
      slow.percent = TRYNDAMERE_W_SLOW_PERCENT;
      enemy.addBuff(slow);
    }
  }
}

/**
 * The shout: three rings leaving him a beat apart.
 *
 * Rings rather than a disc, and staggered rather than simultaneous, so it reads
 * as sound travelling outward instead of as another ground-slam AoE — nothing
 * in this spell touches the ground.
 */
export class Tryndamere_W_Object extends SpellObject {
  // The rings travel along the ground, so they pass under the champions they
  // reach instead of painting over them.
  zIndex = GROUND_Z_INDEX;
  origin: p5.Vector;
  age = 0;
  lifeTime = 700;
  /** Wobble per ring, seeded once so the rings breathe instead of flickering. */
  private wobble: number[] = [];

  constructor(owner: AttackableUnit, origin: p5.Vector) {
    super(owner);
    this.origin = origin.copy();
    this.position = origin.copy();
  }

  onAdded(): void {
    for (let i = 0; i < 3; i++) this.wobble.push(random(0.85, 1.05));
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    push();
    translate(this.origin.x, this.origin.y);
    noFill();
    for (let i = 0; i < 3; i++) {
      const ringAge = this.age - i * 110;
      if (ringAge <= 0) continue;
      const t = constrain(ringAge / 520, 0, 1);
      if (t >= 1) continue;
      // ease-out: the ring leaves fast and slows as it thins, like a shout does
      const eased = 1 - (1 - t) * (1 - t);
      const radius = TRYNDAMERE_W_RADIUS * eased * this.wobble[i];
      stroke(230, 200, 120, 200 * (1 - t));
      strokeWeight(5 * (1 - t) + 1);
      circle(0, 0, radius * 2);
    }

    // hard rim on the real reach, held for the first third so it can be read
    const rimT = constrain(this.age / 240, 0, 1);
    if (rimT < 1) {
      stroke(255, 235, 180, 180 * (1 - rimT));
      strokeWeight(2);
      circle(0, 0, TRYNDAMERE_W_RADIUS * 2);
    }
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const r = TRYNDAMERE_W_RADIUS + 40;
    return new Rectangle({
      x: this.origin.x - r,
      y: this.origin.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
