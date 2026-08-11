import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Shield from '../buffs/Shield';
import TrailSystem from '../helpers/TrailSystem';

export default class Lux_W extends Spell {
  image = AssetManager.getAsset('spell_lux_w');
  name = 'Lá Chắn Lăng Kính (Lux_W)';
  description =
    'Ném cây đũa ánh sáng theo hướng chỉ định rồi thu về, tạo <span class="buff">Lá Chắn</span> hấp thụ <span class="damage">60 sát thương</span> trong <span class="time">3 giây</span> cho bản thân và mọi đồng minh nó đi xuyên qua, ở cả lượt đi lẫn lượt về';
  coolDown = 8000;
  manaCost = 25;

  range = 400;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Lux_W_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }
}

export class Lux_W_Object extends MissileSpellObject {
  speed = 8;
  size = 40;
  // shields only — it must never damage anything it flies through
  maxHitCount = 0;
  // the wand turns around at max range instead of dying there
  removeOnArrive = false;

  shieldAmount = 60;
  shieldDuration = 3000;

  /** Cleared on the turnaround, so each ally can be shielded once per leg. */
  shieldedAllies: any[] = [];
  returning = false;
  spin = 0;

  trailSystem = new TrailSystem({
    maxLength: 16,
    trailSize: this.size / 2.4,
    trailColor: '#FFDE8C66',
  });

  onBeforeMove() {
    this.spin += 0.35;
  }

  onArrive() {
    if (this.returning) {
      this.toRemove = true;
      return;
    }

    this.returning = true;
    this.destination = this.owner.position; // live ref: the wand follows the owner home
    this.shieldedAllies = [];

    // flare marking the turnaround, so the boomerang path is legible
    const flare = new Lux_W_Burst(this.owner);
    flare.position = this.position.copy();
    flare.targetSize = this.size;
    flare.lifeTime = 260;
    this.game.objectManager.addObject(flare);
  }

  onAfterMove() {
    const allies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.size / 2,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
        PredefinedFilters.excludeDead,
        PredefinedFilters.excludeObjects(this.shieldedAllies),
      ],
    });

    for (const ally of allies) {
      this.shieldedAllies.push(ally);

      const shield = new Shield(this.shieldDuration, this.owner, ally);
      shield.amount = this.shieldAmount;
      shield.color = [255, 225, 140];
      shield.image = AssetManager.getAsset('spell_lux_w');
      ally.addBuff(shield);

      // the shield ring alone is easy to miss, so flash the moment it lands
      const burst = new Lux_W_Burst(this.owner);
      burst.position = ally.position.copy();
      burst.follow = ally;
      burst.targetSize = ally.animatedValues?.displaySize ?? 50;
      this.game.objectManager.addObject(burst);
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);

    // halo, additive so the wand glows instead of looking like a flat disc
    blendMode(ADD);
    noStroke();
    fill(255, 220, 130, 45);
    circle(0, 0, this.size * 2);
    fill(255, 240, 190, 55);
    circle(0, 0, this.size * 1.15);
    blendMode(BLEND);

    rotate(this.spin);

    // prism: a six-pointed star of light rather than a spinning plus sign
    noStroke();
    for (let i = 0; i < 3; i++) {
      const a = (i * PI) / 3;
      push();
      rotate(a);
      fill(255, 245, 205, 235);
      quad(-this.size / 2, 0, 0, -5, this.size / 2, 0, 0, 5);
      pop();
    }

    // faceted core
    stroke(255, 250, 225, 220);
    strokeWeight(2);
    fill(255, 255, 255, 245);
    beginShape();
    for (let i = 0; i < 6; i++) {
      const a = (i * TWO_PI) / 6;
      vertex(cos(a) * this.size * 0.22, sin(a) * this.size * 0.22);
    }
    endShape(CLOSE);

    pop();

    // a thread of light back to Lux while the wand is coming home
    if (this.returning) {
      push();
      stroke(255, 235, 170, 70);
      strokeWeight(2);
      line(this.position.x, this.position.y, this.owner.position.x, this.owner.position.y);
      pop();
    }
  }

  getDisplayBoundingBox() {
    // the halo is twice the wand, and the return thread reaches back to Lux
    const minX = Math.min(this.position.x, this.owner.position.x) - this.size;
    const minY = Math.min(this.position.y, this.owner.position.y) - this.size;
    return new Rectangle({
      x: minX,
      y: minY,
      w: Math.abs(this.position.x - this.owner.position.x) + this.size * 2,
      h: Math.abs(this.position.y - this.owner.position.y) + this.size * 2,
      data: this,
    });
  }
}

/** The flash of a prismatic shield snapping into place on an ally. */
export class Lux_W_Burst extends SpellObject {
  follow: any = null;
  targetSize = 50;
  age = 0;
  lifeTime = 420;

  update() {
    this.age += deltaTime;
    if (this.follow) this.position.set(this.follow.position.x, this.follow.position.y);
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const r = this.targetSize * (0.55 + 0.55 * t);

    push();
    translate(this.position.x, this.position.y);

    blendMode(ADD);
    noStroke();
    fill(255, 225, 150, 90 * fade);
    circle(0, 0, r * 2);
    blendMode(BLEND);

    // hexagonal shield facet expanding off the ally
    noFill();
    stroke(255, 240, 190, 230 * fade);
    strokeWeight(3 * fade + 1);
    beginShape();
    for (let i = 0; i < 6; i++) {
      const a = (i * TWO_PI) / 6 + t * 0.6;
      vertex(cos(a) * r, sin(a) * r);
    }
    endShape(CLOSE);

    // splinters of light thrown off the facet
    stroke(255, 250, 220, 200 * fade);
    strokeWeight(2);
    for (let i = 0; i < 6; i++) {
      const a = (i * TWO_PI) / 6 + t * 0.6;
      line(cos(a) * r, sin(a) * r, cos(a) * (r + 10 * fade), sin(a) * (r + 10 * fade));
    }
    pop();
  }

  getDisplayBoundingBox() {
    const r = this.targetSize * 1.4;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
