import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { effectiveRange } from '../../combat/Reach';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import StatAmp from '../buffs/StatAmp';
import { MAX_UNIT_SIZE } from '../Stats';

/** One Feast stack. Kept as constants so the heal matches the max health gained. */
export const SIZE_PER_STACK = 6;
export const MAX_HEALTH_PER_STACK = 75;

export default class ChoGath_R extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_chogath_r');
  name = "Ăn Thịt (Cho'Gath_R)";
  description =
    `Ngoạm kẻ địch gần nhất trong phạm vi <span>200px</span>, gây <span class="damage">40 sát thương</span>. Mỗi lần ăn, Cho'Gath <span class="buff">To Lên Vĩnh Viễn</span>: cộng dồn <span>+${SIZE_PER_STACK} kích thước</span> (tối đa <span>${MAX_UNIT_SIZE}</span>) và <span class="buff">+${MAX_HEALTH_PER_STACK} máu tối đa</span> (không giới hạn)`;
  coolDown = 10000;
  manaCost = 50;

  range = 200;
  damage = 40;
  /** Effectively permanent — long enough that a match ends before it reverts. */
  growthDuration = 600000;

  checkCastCondition() {
    return !!this._findNearestEnemy();
  }

  onSpellCast() {
    const target = this._findNearestEnemy();
    if (!target) return;

    target.takeDamage(this.damage, this.owner);

    const growth = new ChoGath_R_Growth(this.growthDuration, this.owner, this.owner);
    growth.image = this.image;
    this.owner.addBuff(growth);

    // the extra max health is only worth something if it comes filled in
    this.owner.takeHeal(MAX_HEALTH_PER_STACK, this.owner);

    const obj = new ChoGath_R_Object(this.owner);
    obj.position = target.position.copy();
    obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
    obj.targetSize = target.animatedValues?.displaySize ?? 50;
    this.game.objectManager.addObject(obj);
  }

  _findNearestEnemy() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        // The spell that causes the problem is also subject to it: every stack
        // grows Cho'Gath, and the next Feast has to reach past the wider gap
        // his own body now enforces.
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = this.owner.position.dist(enemy.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
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

    // the tally, under the model: above it belongs to the health bar
    noStroke();
    textAlign(CENTER, CENTER);
    // Overlay, not world — see Camera.constantSize.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    fill(30, 8, 12, 185);
    rect(-24 * k, radius + 8 * k, 48 * k, 23 * k, 6 * k);
    fill(255, 228, 205, 245);
    textSize(17 * k);
    text(String(n), 0, radius + 20 * k);
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

    // flash of the bite landing
    if (t < 0.4) {
      blendMode(ADD);
      noStroke();
      fill(255, 120, 110, 110 * (1 - t / 0.4));
      circle(0, 0, this.size * 1.1);
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
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
