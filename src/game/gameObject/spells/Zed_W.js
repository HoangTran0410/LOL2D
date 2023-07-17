import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import EventType from '../../enums/EventType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Champion from '../attackableUnits/Champion.js';
import Dash from '../buffs/Dash.js';

export default class Zed_W extends Spell {
  image = AssetManager.getAsset('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân lướt tới trước và đứng yên trong 5s, nó có thể bắt chước các kỹ năng bạn tung ra. Có thể tái kích hoạt kỹ nămg để đổi chỗ với phân thân.';
  coolDown = 5000;

  zedWClone = null;

  onSpellCast() {
    // create zedWObj
    if (!this.zedWClone) {
      let { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.game.worldMouse,
        350
      );

      this.zedWClone = new Zed_W_Clone({
        game: this.game,
        position: from,
        teamId: this.owner.teamId,
        avatar: this.owner.avatar,
      });
      this.zedWClone.owner = this.owner;
      this.zedWClone.destination = to;
      this.zedWClone.onReachedDestination = () => {
        this.currentCooldown = 500;
      };
      this.game.addPlayer(this.zedWClone);

      this.currentCooldown = 1000;
    }

    // teleport to zedWObj
    else {
      this.owner.teleportTo(this.zedWClone.position.x, this.zedWClone.position.y);
      this.zedWClone.toRemove = true;
      this.zedWClone = null;
      this.currentCooldown = this.coolDown;
    }
  }

  onUpdate() {
    if (this.zedWClone?.toRemove) {
      this.zedWClone = null;
      this.currentCooldown = this.coolDown;
    }
  }
}

export class Zed_W_Clone extends Champion {
  lifeTime = 3000;
  age = 0;

  onSomeoneCastSpell = spellInstance => {
    if (spellInstance instanceof Zed_W) return;
    if (spellInstance.owner != this.owner) return;
    let spellClone = new spellInstance.constructor(this);
    spellClone.cast();
  };

  onAdded() {
    this.game.eventManager.on(EventType.ON_CAST_SPELL, this.onSomeoneCastSpell);

    let originSize = this.stats.size.baseValue;
    this.stats.size.baseValue = 15;

    let originVisionRadius = this.stats.visionRadius.baseValue;
    this.stats.visionRadius.baseValue = 0;

    let dashBuff = new Dash(1000, this, this);
    dashBuff.dashSpeed = 20;
    dashBuff.cancelable = false;
    dashBuff.dashDestination = this.destination;
    dashBuff.onReachedDestination = () => {
      this.stats.size.baseValue = originSize;
      this.stats.visionRadius.baseValue = originVisionRadius / 3;
      this.onReachedDestination?.();
    };
    this.buffs.push(dashBuff);
  }

  onRemoved() {
    this.game.eventManager.unsub(EventType.ON_CAST_SPELL, this.onSomeoneCastSpell);
  }

  update() {
    super.update();

    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    super.draw();

    push();
    //gray overlay
    fill(50, 150);
    noStroke();
    circle(this.position.x, this.position.y, this.animatedValues.size);
    pop();
  }

  // un-targetable, immune to damage/heal, ...
  // TODO: implement targetable status instead of this
  addBuff() {}
  takeDamage() {}
  takeHeal() {}
  drawHealthBar() {}
}
