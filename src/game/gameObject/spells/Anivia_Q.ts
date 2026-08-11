import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';
import TrailSystem from '../helpers/TrailSystem';

/**
 * Flash Frost. The chunk of ice flies THROUGH everyone, chilling them, and only
 * shatters when Anivia recasts Q — or automatically once it reaches max range.
 *
 * Two-stage spell in the `LeeSin_Q` shape: `phase` on the Spell, `onSpellCast`
 * branches on it, `checkCastCondition` gates the recast, and `onUpdate` puts the
 * spell back to Q1 (on full cooldown) once the missile is gone.
 */
export default class Anivia_Q extends Spell {
  image = AssetManager.getAsset('spell_anivia_q');
  name = 'Sương Băng (Anivia_Q)';
  description =
    'Phóng một khối băng bay chậm <b>xuyên qua</b> mọi kẻ địch trên đường đi, gây <span class="damage">15 sát thương</span> và <span class="buff">Làm Chậm 40%</span> trong <span class="time">2 giây</span>. <b>Bấm lại phím chiêu</b> để cho khối băng nổ sớm: vụ nổ bán kính 150px gây thêm <span class="damage">25 sát thương</span> và <span class="buff">Làm Choáng</span> trong <span class="time">1.2 giây</span>. Nếu không bấm lại, khối băng tự nổ khi bay hết tầm';
  coolDown = 9000;
  manaCost = 30;

  range = 450;
  /** Short beat before the recast is allowed, so one tap cannot detonate instantly. */
  recastDelay = 400;

  phase: 'Q1' | 'Q2' = 'Q1';
  spellObject: Anivia_Q_Object | null = null;

  checkCastCondition() {
    // the recast only exists while there is a chunk of ice still in the air
    if (this.phase === 'Q2') {
      return !!this.spellObject && !this.spellObject.toRemove;
    }
    return true;
  }

  onSpellCast() {
    if (this.phase === 'Q1') {
      const { to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.game.worldMouse,
        this.range
      );

      const obj = new Anivia_Q_Object(this.owner);
      obj.destination = to;
      this.game.objectManager.addObject(obj);

      this.spellObject = obj;
      this.phase = 'Q2';
      // hand the recast back to the player almost immediately
      this.currentCooldown = this.recastDelay;
    } else {
      this.spellObject?.detonate();
      this.spellObject = null;
      this.phase = 'Q1';
      this.currentCooldown = this.coolDown;
    }
  }

  onUpdate() {
    // missile died on its own (auto-detonation at max range) => back to Q1
    if (this.phase === 'Q2' && (!this.spellObject || this.spellObject.toRemove)) {
      this.spellObject = null;
      this.phase = 'Q1';
      this.currentCooldown = this.coolDown;
    }
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Anivia_Q_Object extends MissileSpellObject {
  // deliberately sluggish — the payoff is the detonation, not the travel
  speed = 5;
  size = 32;
  damage = 15;
  slowTime = 2000;
  slowPercent = 0.4;

  // pierces everything on the way through
  maxHitCount = Infinity;
  // detonation is driven by `detonate()`, so arriving must not silently delete it
  removeOnArrive = false;

  blastRadius = 150;
  blastDamage = 25;
  blastStunTime = 1200;

  _detonated = false;

  trailSystem = new TrailSystem({
    trailSize: this.size / 1.5,
    trailColor: '#a8e4ff55',
    maxLength: 22,
  });

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const slowBuff = new Slow(this.slowTime, this.owner, enemy);
    slowBuff.percent = this.slowPercent;
    slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
    slowBuff.image = AssetManager.getAsset('spell_anivia_q');
    enemy.addBuff(slowBuff);
  }

  /** Shatter now. Safe to call twice: only the first call spawns the blast. */
  detonate() {
    if (this._detonated) return;
    this._detonated = true;

    const blast = new Anivia_Q_Blast(this.owner);
    blast.position = this.position.copy();
    blast.maxRadius = this.blastRadius;
    blast.damage = this.blastDamage;
    blast.stunTime = this.blastStunTime;
    this.game.objectManager.addObject(blast);

    this.toRemove = true;
  }

  /** Not recast in time: it shatters on its own at the end of the path. */
  onArrive() {
    this.detonate();
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(frameCount / 40);

    stroke(230, 250, 255, 220);
    strokeWeight(2);
    fill(140, 210, 245, 170);
    circle(0, 0, this.size);

    // jagged shards clinging to the core
    stroke(255, 200);
    strokeWeight(3);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TWO_PI;
      const len = this.size / 2 + 6;
      line((cos(a) * this.size) / 3, (sin(a) * this.size) / 3, cos(a) * len, sin(a) * len);
    }

    pop();

    // pulsing halo: a reminder that the chunk is armed and can be recast
    push();
    noFill();
    const pulse = 1 + 0.12 * sin(frameCount / 6);
    stroke(190, 235, 255, 110);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.size * 1.6 * pulse);
    pop();
  }
}

/** The shatter: one burst of damage and a stun, then it fades. */
export class Anivia_Q_Blast extends SpellObject {
  position = this.owner.position.copy();
  maxRadius = 150;
  damage = 25;
  stunTime = 1200;

  lifeTime = 500;
  age = 0;
  radius = 0;
  hasDealtDamage = false;

  update() {
    if (!this.hasDealtDamage) {
      this.hasDealtDamage = true;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.maxRadius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(this.damage, this.owner);

        const stunBuff = new Stun(this.stunTime, this.owner, enemy);
        stunBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        stunBuff.image = AssetManager.getAsset('spell_anivia_q');
        enemy.addBuff(stunBuff);
      });
    }

    this.age += deltaTime;
    this.radius = lerp(this.radius, this.maxRadius, 0.25);

    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const alpha = map(this.age, 0, this.lifeTime, 180, 0);

    push();
    strokeWeight(3);
    stroke(235, 250, 255, alpha);
    fill(150, 215, 250, alpha / 2.5);
    circle(this.position.x, this.position.y, this.radius * 2);

    // splinters flying outwards
    stroke(255, alpha);
    strokeWeight(2);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI;
      const inner = this.radius * 0.65;
      line(
        this.position.x + cos(a) * inner,
        this.position.y + sin(a) * inner,
        this.position.x + cos(a) * this.radius,
        this.position.y + sin(a) * this.radius
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.maxRadius,
      y: this.position.y - this.maxRadius,
      w: this.maxRadius * 2,
      h: this.maxRadius * 2,
      data: this,
    });
  }
}
