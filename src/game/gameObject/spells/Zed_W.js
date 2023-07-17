import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import EventType from '../../enums/EventType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Champion from '../attackableUnits/Champion.js';
import Dash from '../buffs/Dash.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';

export default class Zed_W extends Spell {
  image = AssetManager.getAsset('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân lướt tới trước và đứng yên trong 5s, nó có thể bắt chước các kỹ năng bạn tung ra. Có thể tái kích hoạt kỹ năng để đổi chỗ với phân thân.';
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
  castedSpells = [
    // {
    //   ownerSpell: null,
    //   cloneSpell: null,
    // }
  ];

  smokeEffect = PredefinedParticleSystems.smoke([150], 2, 10);

  onSomeoneCastSpell = spellInstance => {
    if (spellInstance.owner.id != this.owner.id) return;
    if (spellInstance instanceof Zed_W) return;

    // recast spell (if already casted)
    let exitsSpell = this.castedSpells.find(s => s.ownerSpell === spellInstance);
    if (exitsSpell) {
      exitsSpell.cloneSpell.cast();
    }

    // clone new spell
    else {
      let spellClone = new spellInstance.constructor(this);
      spellClone.cast();
      this.castedSpells.push({
        ownerSpell: spellInstance,
        cloneSpell: spellClone,
      });
    }
  };

  onAdded() {
    // listen to spell cast event
    this.game.eventManager.on(EventType.ON_CAST_SPELL, this.onSomeoneCastSpell);

    // dash to destination
    let originSize = this.stats.size.baseValue;
    this.stats.size.baseValue = 15;

    let originVisionRadius = this.stats.visionRadius.baseValue;
    this.stats.visionRadius.baseValue = 0;

    let dashBuff = new Dash(1000, this, this);
    dashBuff.dashSpeed = 20;
    dashBuff.cancelable = false;
    dashBuff.dashDestination = this.destination;
    dashBuff.onReachedDestination = () => {
      // restore size/visionRadius
      this.stats.size.baseValue = originSize;
      this.stats.visionRadius.baseValue = originVisionRadius / 3;

      // add smoke effect
      for (let i = 0; i < 10; i++) {
        this.smokeEffect.addParticle({
          x: this.position.x + random(-originSize / 2, originSize / 2),
          y: this.position.y + random(-originSize / 2, originSize / 2),
          size: random(30, 50),
          opacity: random(200, 255),
        });
      }

      this.onReachedDestination?.();
    };
    this.buffs.push(dashBuff);
  }

  onRemoved() {
    this.game.eventManager.unsub(EventType.ON_CAST_SPELL, this.onSomeoneCastSpell);

    // add smoke effect
    let size = this.stats.size.baseValue;
    for (let i = 0; i < 10; i++) {
      this.smokeEffect.addParticle({
        x: this.position.x + random(-size / 2, size / 2),
        y: this.position.y + random(-size / 2, size / 2),
        size: random(20, 40),
        opacity: random(200, 255),
      });
    }
    console.log('add smoke');

    // update and draw will be handled by game from now on
    this.game.addObject(this.smokeEffect);
  }

  update() {
    super.update();

    this.smokeEffect.update();
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

    // draw smoke effect
    this.smokeEffect.draw();
    pop();
  }

  // un-targetable, immune to damage/heal, ...
  // TODO: implement targetable status instead of this
  // addBuff() {}
  takeDamage() {}
  takeHeal() {}
  drawHealthBar() {}
}
