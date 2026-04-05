import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';
import RootBuff from '../buffs/Root';
import VectorUtils from '../../../utils/vector.utils';
import { Circle, Rectangle } from '../../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';

export default class Blitzcrank_Q extends Spell {
  name = 'Bàn Tay Hỏa Tiễn (Blitzcrank_Q)';
  image = AssetManager.getAsset('spell_blitzcrank_q');
  description =
    'Bắn bàn tay theo hướng chỉ định, <span class="buff">Kéo</span> kẻ địch đầu tiên trúng phải về phía bạn, gây <span class="damage">20 sát thương</span> và <span class="buff">Làm Choáng</span> chúng trong <span class="time">0.5 giây</span>';
  coolDown = 5000;
  manaCost = 20;

  blitObj: Blitzcrank_Q_Object | null = null;
  ownerStunBuff: RootBuff | null = null;

  onSpellCast() {
    const range = 500;
    const speed = 10;
    const grabSpeed = 10;

    const { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      range
    );

    this.blitObj = new Blitzcrank_Q_Object(this.owner);
    this.blitObj.position = this.owner.position.copy();
    this.blitObj.destination = destination;
    this.blitObj.speed = speed;
    this.blitObj.grabSpeed = grabSpeed;
    this.blitObj.range = range;
    this.game.objectManager.addObject(this.blitObj);

    this.ownerStunBuff = new RootBuff(1500, this.owner, this.owner);
    this.ownerStunBuff.buffAddType = BuffAddType.REPLACE_EXISTING;
    this.ownerStunBuff.image = this.image;
    this.owner.addBuff(this.ownerStunBuff);
  }

  onUpdate() {
    if (this.blitObj) {
      if (this.blitObj.phase === Blitzcrank_Q_Object.PHASES.GRAB || this.blitObj.toRemove) {
        this.ownerStunBuff?.deactivateBuff();
      }

      if (this.blitObj.toRemove) {
        this.blitObj = null;
      }
    }
  }
}

export class Blitzcrank_Q_Object extends SpellObject {
  isMissile = true;

  position: p5.Vector = createVector();
  destination: p5.Vector = createVector();
  range = 500;
  speed = 10;
  grabSpeed = 10;
  handSize = 30;

  airborneBuff: Airborne | null = null;
  dashBuff: Dash | null = null;
  champToGrab: any = null;

  static PHASES = {
    FORWARD: 'forward',
    GRAB: 'grab',
  } as const;
  phase: (typeof Blitzcrank_Q_Object.PHASES)[keyof typeof Blitzcrank_Q_Object.PHASES] =
    Blitzcrank_Q_Object.PHASES.FORWARD;

  update() {
    const distance = this.destination.dist(this.position);
    const speed =
      this.phase === Blitzcrank_Q_Object.PHASES.FORWARD ? this.speed : this.grabSpeed;
    if (distance < speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      VectorUtils.moveVectorToVector(this.position, this.destination, speed);
    }

    if (this.phase === Blitzcrank_Q_Object.PHASES.FORWARD) {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.handSize / 2,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      const enemy = enemies?.[0];
      if (enemy) {
        this.phase = Blitzcrank_Q_Object.PHASES.GRAB;
        this.champToGrab = enemy;
        this.destination = this.owner.position;

        this.airborneBuff = new Airborne(7000, this.owner, enemy);
        this.airborneBuff.image = AssetManager.getAsset('spell_blitzcrank_q');
        enemy.addBuff(this.airborneBuff);

        this.dashBuff = new Dash(10000, this.owner, enemy);
        this.dashBuff.showTrail = false;
        this.dashBuff.cancelable = false;
        enemy.addBuff(this.dashBuff);

        enemy.takeDamage(20, this.owner);
      }
    } else if (this.champToGrab) {
      this.dashBuff!.dashDestination = this.owner.position.copy();
      this.champToGrab.position.set(this.position.x, this.position.y);

      if (this.champToGrab.isDead) {
        this.toRemove = true;
      }
    }
  }

  onRemoved() {
    this.airborneBuff?.deactivateBuff?.();
    this.dashBuff?.deactivateBuff?.();
  }

  draw() {
    push();

    const alpha = constrain(
      map(this.position.dist(this.owner.position), 0, this.range, 200, 50),
      50,
      200
    );
    stroke(255, alpha);
    strokeWeight(4);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    noStroke();
    fill(255, 150, 50);
    circle(this.position.x, this.position.y, this.handSize);

    fill(200, 100, 90);
    const dir = p5.Vector.sub(this.destination, this.position).normalize();
    for (let i = 0; i < 3; i++) {
      const angle = dir.heading() + (i - 1) * 0.5;
      const x = this.position.x + cos(angle) * this.handSize;
      const y = this.position.y + sin(angle) * this.handSize;
      circle(x, y, 15);
    }

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: Math.min(this.position.x, this.owner.position.x) - this.handSize / 2,
      y: Math.min(this.position.y, this.owner.position.y) - this.handSize / 2,
      w: Math.abs(this.position.x - this.owner.position.x) + this.handSize,
      h: Math.abs(this.position.y - this.owner.position.y) + this.handSize,
      data: this,
    });
  }
}
