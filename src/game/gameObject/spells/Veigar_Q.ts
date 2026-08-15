import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import StatAmp from '../buffs/StatAmp';
import TrailSystem from '../helpers/TrailSystem';

export default class Veigar_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_veigar_q');
  name = 'Quả Cầu Bóng Tối (Veigar_Q)';
  description =
    'Bắn ra một quả cầu năng lượng hắc ám xuyên qua mọi kẻ địch, gây <span class="damage">22 sát thương</span>. Mỗi kẻ địch trúng chiêu giúp Veigar <span class="buff">cộng dồn vĩnh viễn +20 năng lượng tối đa</span>';
  coolDown = 5000;
  manaCost = 20;

  range = 550;
  damage = 22;
  manaPerStack = 20;
  /** Effectively permanent — 10 minutes is longer than any match lasts. */
  stackDuration = 600000;
  maxStacks = 999;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      this.range
    );

    const obj = new Veigar_Q_Object(this.owner);
    obj.destination = to;
    obj.damage = this.damage;
    obj.manaPerStack = this.manaPerStack;
    obj.stackDuration = this.stackDuration;
    obj.maxStacks = this.maxStacks;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/**
 * The permanent power Veigar collects. A plain `StatAmp` has no visuals at all,
 * which makes the whole point of the spell invisible; this subclass only adds a
 * drawing, the stacking behaviour is untouched.
 */
export class Veigar_Q_Power extends StatAmp {
  draw(): void {
    if (this.targetUnit.isDead) return;

    const stacks = this.targetUnit.buffs.filter((b: any) => b instanceof Veigar_Q_Power);
    // one stack draws the whole orbit — otherwise every stack redraws all of it
    if (stacks[0] !== this) return;

    const n = stacks.length;
    const pos = this.targetUnit.position;
    const radius = this.targetUnit.animatedValues.displaySize / 2 + 14;
    const shown = Math.min(n, 12);

    push();
    translate(pos.x, pos.y);

    blendMode(ADD);
    noStroke();
    fill(90, 30, 150, Math.min(90, 22 + n * 7));
    circle(0, 0, radius * 2.2);
    blendMode(BLEND);

    // one dark mote in orbit per stack, up to a dozen; then the number carries it
    for (let i = 0; i < shown; i++) {
      const a = (i / shown) * TWO_PI + frameCount / 55;
      const r = radius + sin(frameCount / 30 + i) * 4;
      const x = cos(a) * r;
      const y = sin(a) * r;

      noStroke();
      blendMode(ADD);
      fill(120, 50, 210, 150);
      circle(x, y, 20);
      blendMode(BLEND);
      fill(185, 130, 255, 235);
      circle(x, y, 13);
      fill(22, 6, 40, 245);
      circle(x, y, 7);
    }

    // the tally, under the model: above it belongs to the health bar
    noStroke();
    textAlign(CENTER, CENTER);
    // Overlay, not world — see Camera.constantSize.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    fill(18, 6, 32, 185);
    rect(-24 * k, radius + 4 * k, 48 * k, 23 * k, 6 * k);
    fill(220, 185, 255, 245);
    textSize(17 * k);
    text(String(n), 0, radius + 16 * k);
    pop();
  }
}

export class Veigar_Q_Object extends MissileSpellObject {
  image = AssetManager.get('spell_veigar_q');
  speed = 8;
  size = 26;
  // pierces everything, and every victim feeds the stacking
  maxHitCount = Infinity;

  damage = 22;
  manaPerStack = 20;
  stackDuration = 600000;
  maxStacks = 999;

  trailSystem = new TrailSystem({
    trailColor: '#6A2CA855',
    trailSize: this.size,
  });

  _pulse = 0;

  onAfterMove() {
    this._pulse += deltaTime;
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const powerBuff = new Veigar_Q_Power(this.stackDuration, this.owner, this.owner);
    powerBuff.stackId = 'veigar_q_power';
    powerBuff.image = this.image;
    powerBuff.name = 'Sức Mạnh Hắc Ám';
    powerBuff.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    powerBuff.maxStacks = this.maxStacks;
    powerBuff.bonuses = { maxMana: { baseBonus: this.manaPerStack } };
    this.owner.addBuff(powerBuff);

    // the orb flies on through, so the hit gets its own collapse
    const implode = new Veigar_Q_Implode(this.owner);
    implode.position = enemy.position.copy();
    implode.targetSize = enemy.animatedValues?.displaySize ?? 40;
    this.game.objectManager.addObject(implode);
  }

  draw() {
    const s = this.size;
    const beat = 1 + 0.1 * sin(this._pulse / 90);

    push();
    translate(this.position.x, this.position.y);

    // corona: additive, so the orb glows rather than sitting flat on the ground
    blendMode(ADD);
    noStroke();
    fill(95, 35, 170, 55);
    circle(0, 0, s * 2.4 * beat);
    fill(150, 70, 235, 45);
    circle(0, 0, s * 1.5 * beat);
    blendMode(BLEND);

    // event horizon: bright rim, black core
    noStroke();
    fill(120, 55, 195);
    circle(0, 0, s * 1.06);
    fill(8, 2, 18);
    circle(0, 0, s * 0.72);

    // matter spiralling in
    noFill();
    stroke(205, 150, 255, 210);
    strokeWeight(2);
    for (let i = 0; i < 3; i++) {
      const a = this._pulse / 130 + (i * TWO_PI) / 3;
      arc(0, 0, s * (0.85 + i * 0.16), s * (0.85 + i * 0.16), a, a + 1.5);
    }

    // dark lightning licking off the rim
    stroke(190, 130, 255, 200);
    strokeWeight(1.5);
    for (let i = 0; i < 4; i++) {
      const a = this._pulse / 70 + (i * TWO_PI) / 4;
      const r0 = s * 0.55;
      const r1 = s * (0.75 + 0.25 * Math.abs(sin(this._pulse / 45 + i)));
      const mx = cos(a + 0.18) * ((r0 + r1) / 2);
      const my = sin(a + 0.18) * ((r0 + r1) / 2);
      beginShape();
      vertex(cos(a) * r0, sin(a) * r0);
      vertex(mx, my);
      vertex(cos(a - 0.14) * r1, sin(a - 0.14) * r1);
      endShape();
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size * 1.6;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/** Dark matter collapsing on whoever the orb passed through. */
export class Veigar_Q_Implode extends SpellObject {
  targetSize = 40;
  age = 0;
  lifeTime = 380;
  maxRadius = 55;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;

    push();
    translate(this.position.x, this.position.y);

    // ring rushing inward: the damage collapses onto the target
    noFill();
    stroke(180, 110, 255, 230 * fade);
    strokeWeight(4 * fade + 1);
    circle(0, 0, this.targetSize * 0.5 + this.maxRadius * 2 * (1 - t));

    // then a violet flash where it lands
    blendMode(ADD);
    noStroke();
    fill(140, 60, 220, 150 * t * fade * 3);
    circle(0, 0, this.targetSize * (0.8 + t));
    blendMode(BLEND);

    // shards of void flicking outward
    stroke(215, 175, 255, 220 * fade);
    strokeWeight(2);
    for (let i = 0; i < 6; i++) {
      const a = (i * TWO_PI) / 6 + t;
      const r0 = this.targetSize * 0.35 + 22 * t;
      line(cos(a) * r0, sin(a) * r0, cos(a) * (r0 + 12 * fade), sin(a) * (r0 + 12 * fade));
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.targetSize + this.maxRadius * 2;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
