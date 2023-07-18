import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import EventType from '../../enums/EventType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Spell from '../Spell.js';
import Champion from '../attackableUnits/Champion.js';
import Dash from '../buffs/Dash.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';

export default class Zed_W extends Spell {
  image = AssetManager.getAsset('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân lướt tới trước. Đứng im và sẽ bắt chước các kỹ năng bạn tung ra trong 3s. Có thể tái kích hoạt kỹ năng để đổi chỗ với phân thân (Phân thân không thể bị chọn làm mục tiêu)';
  coolDown = 7500;

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
      this.zedWClone.spellSource = this;
      this.zedWClone.destination = to;
      this.game.addPlayer(this.zedWClone);

      this.currentCooldown = 500;
      this.image = AssetManager.getAsset('spell_zed_w2');
    }

    // swap position with zedWObj
    else {
      let curPos = this.owner.position.copy();
      this.owner.teleportTo(this.zedWClone.position.x, this.zedWClone.position.y);
      this.currentCooldown = this.coolDown;

      this.zedWClone.teleportTo(curPos.x, curPos.y);
      this.zedWClone.swapable = false;
      this.zedWClone = null;
      this.image = AssetManager.getAsset('spell_zed_w');
    }
  }

  onUpdate() {
    if (this.zedWClone?.toRemove) {
      this.zedWClone = null;
      this.currentCooldown = this.coolDown;
      this.image = AssetManager.getAsset('spell_zed_w');
    }
  }
}

export class Zed_W_Clone extends Champion {
  lifeTime = 3000;
  age = 0;
  _mapSpells = {
    // sourceSpellId: {
    //   clone: cloneSpellInstance,
    //   source: sourceSpellInstance,
    // },
  };
  _pendingSpellIds = [];
  _reachedDestination = false;
  swapable = true;

  smokeEffect = PredefinedParticleSystems.smoke([150], 2, 10);

  onSomeOneCastSpell = sourceSpell => {
    // check if spell is casted by owner
    if (sourceSpell.owner.id !== this.owner.id) return;
    // check if spell is source spell (spell that created this clone)
    if (sourceSpell.id === this.spellSource?.id) return;
    // TODO verify this, could we enable multiple clone zedW?
    if (sourceSpell instanceof Zed_W) return;

    // get or create new clone spell to cast
    let spell = null;
    if (sourceSpell.id in this._mapSpells) {
      spell = this._mapSpells[sourceSpell.id].clone;
    } else {
      spell = new sourceSpell.constructor(this);
      this._mapSpells[sourceSpell.id] = {
        clone: spell,
        source: sourceSpell,
      };
    }

    // cast spell if clone reached destination. Otherwise, queue it
    if (this._reachedDestination) {
      spell.cast();
    } else {
      this._pendingSpellIds.push({
        id: sourceSpell.id,
        mouse: this.game.worldMouse.copy(), // cache mouse position when spell is casted
      });
    }
  };

  onAdded() {
    // listen to spell cast event
    this.game.eventManager.on(EventType.ON_PRE_CAST_SPELL, this.onSomeOneCastSpell);

    // untargetable
    this.setStatus(StatusFlags.Targetable, false);

    // dash to destination
    let originVisionRadius = this.stats.visionRadius.baseValue;
    this.stats.visionRadius.baseValue = 0;

    let dashBuff = new Dash(5000, this.owner, this);
    dashBuff.dashSpeed = 10;
    dashBuff.cancelable = false;
    dashBuff.dashDestination = this.destination;
    dashBuff.onReachedDestination = () => {
      this._reachedDestination = true;

      // cast pending spells
      this._pendingSpellIds.forEach(({ id, mouse }) => {
        this.game.worldMouse = mouse; // restore mouse position
        this._mapSpells[id].clone.cast();
      });

      // restore visionRadius
      this.stats.visionRadius.baseValue = originVisionRadius / 3;

      // add smoke effect
      let size = this.stats.size.value;
      for (let i = 0; i < 5; i++) {
        this.smokeEffect.addParticle({
          x: this.position.x + random(-size / 2, size / 2),
          y: this.position.y + random(-size / 2, size / 2),
          size: random(30, 50),
          opacity: random(200, 255),
        });
      }
    };
    this.addBuff(dashBuff);
  }

  onRemoved() {
    this.game.eventManager.unsub(EventType.ON_PRE_CAST_SPELL, this.onSomeOneCastSpell);
  }

  update() {
    super.update();

    this.smokeEffect.update();
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;

    // manually update clone spells
    for (let spellId in this._mapSpells) {
      let { clone, source } = this._mapSpells[spellId];
      clone.update();

      if (source.currentCooldown <= 0) {
        clone.currentCooldown = 0;
      }
    }
  }

  draw() {
    super.draw();

    //gray overlay
    push();
    fill(50, 150);
    noStroke();
    circle(this.position.x, this.position.y, this.animatedValues.size);
    pop();

    // draw arrow on owner to this
    let arrowSize = 20;
    let { from, to, distance } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.position,
      this.owner.animatedValues.size / 2 + 10 + arrowSize,
      false
    );
    if (distance > 0) {
      let angle = VectorUtils.getAngle(this.owner.position, this.position);
      push();
      translate(to.x, to.y);
      rotate(angle);
      fill(this.swapable ? [255, 150] : [255, 100, 100, 150]);
      noStroke();
      triangle(0, 0, -arrowSize, -arrowSize / 2, -arrowSize, arrowSize / 2);
      pop();
    }

    // draw smoke effect
    this.smokeEffect.draw();
  }

  drawHealthBar() {} // no health bar
  move() {} // no movement
}
