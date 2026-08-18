import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import {
  pickExecuteTarget,
  type ExecuteFallback,
  type ExecuteSpell,
} from '@/game/combat/ExecuteTargeting';
import { effectiveRange } from '@/game/combat/Reach';
import BuffAddType from '@/game/enums/BuffAddType';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import StatAmp from '@/game/gameObject/buffs/StatAmp';
import { MAX_UNIT_SIZE } from '@/game/gameObject/Stats';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/** One Feast stack. Kept as constants so the heal matches the max health gained. */
export const SIZE_PER_STACK = 6;
export const MAX_HEALTH_PER_STACK = 75;

export default class ChoGath_R extends Spell implements ExecuteSpell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_chogath_r');
  name = "Xơi Tái (Cho'Gath_R)";
  description =
    `Ngoạm một kẻ địch trong phạm vi <span>200px</span> — <span class="buff">ưu tiên kẻ sẽ chết vì cú ngoạm này</span>, ` +
    `nếu không có thì kẻ gần nhất — gây <span class="damage">40 sát thương</span>. ` +
    `Chỉ khi <span class="buff">ăn tươi nuốt sống</span> (hạ gục bằng chiêu này), Cho'Gath mới ` +
    `<span class="buff">To Lên Vĩnh Viễn</span>: cộng dồn <span>+${SIZE_PER_STACK} kích thước</span> ` +
    `(tối đa <span>${MAX_UNIT_SIZE}</span>) và <span class="buff">+${MAX_HEALTH_PER_STACK} máu tối đa</span> (không giới hạn)`;
  coolDown = 10000;
  manaCost = 50;

  range = 200;
  damage = 40;
  /** Effectively permanent — long enough that a match ends before it reverts. */
  growthDuration = 600000;

  /**
   * How many Feast stacks Cho'Gath is carrying, for the HUD badge and for the
   * practice panel. Deactivated buffs are skipped: `deactivateBuff()` only
   * marks `toRemove`, and `AttackableUnit.update()` — which is what drops it
   * off the list — cannot run while the panel holds the match paused.
   */
  get stackCount(): number {
    return liveStacks(this.owner).length;
  }

  /**
   * The practice panel's write side. Raising heals the health it just added,
   * exactly as `onSpellCast` does — 50 stacks that left Cho'Gath at a few
   * percent of a huge pool would look like a bug rather than a cheat.
   * Lowering does not heal, and has to clamp: see the note in the body.
   */
  setStackCount(count: number): boolean {
    if (!this.owner) return false;
    const target = Math.max(0, Math.floor(count));
    const current = liveStacks(this.owner);

    for (let i = current.length; i < target; i++) {
      this.owner.addBuff(createGrowthStack(this.owner, this.growthDuration, this.image));
    }
    const added = Math.max(0, target - current.length);
    if (added > 0) this.owner.takeHeal(MAX_HEALTH_PER_STACK * added, this.owner);

    for (const buff of current.slice(target)) buff.deactivateBuff();
    if (target < current.length) {
      // `Stats.update()` does constrain health to `maxHealth.value` — but only
      // when it runs, and it cannot: the panel that drives this holds the
      // match paused. Without this line Cho'Gath sits above his own maximum,
      // with a health bar past the end of itself, until the panel closes.
      this.owner.stats.health.baseValue = Math.min(
        this.owner.stats.health.baseValue,
        this.owner.stats.maxHealth.value
      );
    }
    return true;
  }

  /** A bite that kills nobody is still a bite: 40 damage on the nearest body. */
  readonly executeFallback: ExecuteFallback = 'nearest';

  checkCastCondition() {
    return !!this.findVictim();
  }

  onSpellCast() {
    const target = this.findVictim();
    if (!target) return;

    // The growth is paid for by the meal, not by the bite. Before this, holding
    // R next to anything at all bought permanent max health and size — the one
    // uncapped stat in the game, farmed off targets that never died.
    const wasAlive = !target.isDead;
    target.takeDamage(this.damage, this.owner);
    const devoured = wasAlive && target.isDead;

    if (devoured) {
      this.owner.addBuff(createGrowthStack(this.owner, this.growthDuration, this.image));
      // the extra max health is only worth something if it comes filled in
      this.owner.takeHeal(MAX_HEALTH_PER_STACK, this.owner);
    }

    const obj = new ChoGath_R_Object(this.owner);
    obj.position = target.position.copy();
    obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
    obj.targetSize = target.animatedValues?.displaySize ?? 50;
    obj.devoured = devoured;
    this.game.objectManager.addObject(obj);
  }

  /** The one he should eat: killable first, otherwise nearest. */
  findVictim(): AttackableUnit | null {
    return pickExecuteTarget(this);
  }

  executeDamageAgainst(_target: AttackableUnit): number {
    return this.damage;
  }

  executeCandidates(): AttackableUnit[] {
    return this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        // The spell that causes the problem is also subject to it: every stack
        // grows Cho'Gath, and the next Feast has to reach past the wider gap
        // his own body now enforces.
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/** The live stacks on `owner` — see `ChoGath_R.stackCount` on why `toRemove` is skipped. */
export const liveStacks = (owner: any): ChoGath_R_Growth[] =>
  (owner?.buffs ?? []).filter((buff: any) => buff instanceof ChoGath_R_Growth && !buff.toRemove);

/**
 * One Feast stack, configured the one way it is ever configured. Called from
 * `onSpellCast` (a real bite) and from `setStackCount` (the practice panel),
 * so the cheat cannot drift from the real thing.
 */
export function createGrowthStack(owner: any, duration: number, image: any): ChoGath_R_Growth {
  const growth = new ChoGath_R_Growth(duration, owner, owner);
  growth.image = image;
  return growth;
}

/**
 * Its own class rather than a bare `StatAmp`: `addBuff` groups stacks by
 * constructor, so a one-stack StatAmp from some other spell would otherwise
 * knock a Feast stack off the moment it landed.
 */
export class ChoGath_R_Growth extends StatAmp {
  name = 'Ăn Thịt';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 99;

  bonuses = {
    size: { baseBonus: SIZE_PER_STACK },
    maxHealth: { baseBonus: MAX_HEALTH_PER_STACK },
  };

  /**
   * A permanent stack that only makes the model bigger is impossible to count.
   * One stack draws the whole crown of horns for all of them — doing it per
   * stack would redraw the same ring N times.
   *
   * The horns are the *feel* of the count, not the count. The exact number is
   * already on the buff-icon row above the health bar, which `Champion`
   * assembles for every champion on screen by grouping buffs on `stackId` —
   * one place, every stacking ability, friend and enemy alike. This used to
   * paint its own number plate under the model as well; so did Veigar Q, and
   * every future stacking spell would have had to invent a third. Nothing
   * world-space prints a tally any more.
   */
  draw(): void {
    if (this.targetUnit.isDead) return;

    const stacks = this.targetUnit.buffs.filter((b: any) => b instanceof ChoGath_R_Growth);
    if (stacks[0] !== this) return;

    const n = stacks.length;
    const pos = this.targetUnit.position;
    const radius = this.targetUnit.animatedValues.displaySize / 2;
    const beat = 1 + 0.04 * sin(frameCount / 18);

    push();
    translate(pos.x, pos.y);

    // one horn per Feast stack, so the count is readable at a glance
    const shown = Math.min(n, 14);
    for (let i = 0; i < shown; i++) {
      const a = (i / shown) * TWO_PI - HALF_PI + frameCount / 400;
      const r = (radius + 5) * beat;
      push();
      rotate(a + HALF_PI);
      stroke(50, 24, 28, 235);
      strokeWeight(2);
      fill(238, 228, 205, 245);
      triangle(0, -r - 17, -7, -r + 3, 7, -r + 3);
      noStroke();
      fill(160, 140, 120, 200);
      triangle(0, -r - 17, 0, -r + 3, 7, -r + 3);
      pop();
    }

    // a dark, hungry aura that deepens as he eats
    noFill();
    stroke(150, 45, 60, Math.min(190, 70 + n * 16));
    strokeWeight(3);
    circle(0, 0, (radius + 20) * 2 * beat);
    pop();
  }
}

/** The bite mark left on the victim. */
export class ChoGath_R_Object extends SpellObject {
  size = 90;
  lifeTime = 400;
  age = 0;
  angle = 0;
  targetSize = 50;
  /** The bite that actually fed him. Only difference is how hard it reads. */
  devoured = false;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const alpha = 235 * (1 - t);
    // the jaws start wide open and snap shut
    const gap = (1 - t) * (PI / 3);
    const r = this.size / 2;

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    // flash of the bite landing — bigger and hotter when the jaws close on a
    // kill, which is the only bite that feeds him
    if (t < 0.4) {
      const bite = this.devoured ? 1.6 : 1.1;
      blendMode(ADD);
      noStroke();
      fill(255, 120, 110, (this.devoured ? 190 : 110) * (1 - t / 0.4));
      circle(0, 0, this.size * bite);
      blendMode(BLEND);
    }

    // upper and lower jaw, dark gums with a hard rim
    for (let side = -1; side <= 1; side += 2) {
      push();
      scale(1, side);

      noStroke();
      fill(95, 25, 35, alpha);
      arc(0, 0, this.size, this.size, gap, PI - gap, PIE);

      noFill();
      stroke(190, 70, 80, alpha);
      strokeWeight(3);
      arc(0, 0, this.size, this.size, gap, PI - gap);

      // teeth around the jaw line
      noStroke();
      fill(245, 240, 225, alpha);
      const teeth = 6;
      for (let i = 0; i <= teeth; i++) {
        const a = gap + ((PI - gap * 2) * i) / teeth;
        const tx = cos(a) * r;
        const ty = sin(a) * r;
        push();
        translate(tx, ty);
        rotate(a - HALF_PI);
        triangle(0, -13, -4.5, 2, 4.5, 2);
        pop();
      }
      pop();
    }

    // blood flicking out of the closing jaws
    noStroke();
    fill(170, 40, 55, alpha * 0.9);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      const d = r * (0.5 + t * 1.1);
      circle(cos(a) * d, sin(a) * d, (7 - i * 0.6) * (1 - t));
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size * 0.8;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
