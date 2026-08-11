import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import StatAmp from '../buffs/StatAmp';
import TrailSystem from '../helpers/TrailSystem';

export default class Veigar_Q extends Spell {
  image = AssetManager.getAsset('spell_veigar_q');
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
      this.game.worldMouse,
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

export class Veigar_Q_Object extends MissileSpellObject {
  image = AssetManager.getAsset('spell_veigar_q');
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

    const powerBuff = new StatAmp(this.stackDuration, this.owner, this.owner);
    powerBuff.stackId = 'veigar_q_power';
    powerBuff.image = this.image;
    powerBuff.name = 'Sức Mạnh Hắc Ám';
    powerBuff.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    powerBuff.maxStacks = this.maxStacks;
    powerBuff.bonuses = { maxMana: { baseBonus: this.manaPerStack } };
    this.owner.addBuff(powerBuff);
  }

  draw() {
    const halo = this.size * (1.4 + 0.12 * sin(this._pulse / 90));

    push();
    noStroke();

    fill(110, 50, 180, 60);
    circle(this.position.x, this.position.y, halo);

    fill(70, 30, 120);
    circle(this.position.x, this.position.y, this.size);

    fill(20, 5, 40);
    circle(this.position.x, this.position.y, this.size * 0.55);

    stroke(190, 130, 255, 200);
    strokeWeight(2);
    noFill();
    circle(this.position.x, this.position.y, this.size * (0.75 + 0.1 * sin(this._pulse / 60)));

    pop();
  }
}
