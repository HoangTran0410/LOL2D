import AssetManager from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import StatusFlags from '../../enums/StatusFlags';
import VectorUtils from '../../../utils/vector.utils';
import Champion from '../attackableUnits/Champion';
import Dash from '../buffs/Dash';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import Spell from '../Spell';

export default class Zed_W extends Spell {
  image = AssetManager.getAsset('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân <span class="buff">Lướt</span> tới trước, sau đó đứng im và sẽ <span>bắt chước</span> các kỹ năng bạn tung ra trong <span class="time">3 giây</span>. Có thể tái kích hoạt kỹ năng để <span class="buff">Đổi chỗ</span> với phân thân <i>(Phân thân không thể bị chọn làm mục tiêu)</i>';
  coolDown = 7500;

  zedWClone: Zed_W_Clone | null = null;

  onSpellCast() {
    if (!this.zedWClone) {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.game.worldMouse,
        350
      );

      this.zedWClone = new Zed_W_Clone({
        game: this.game,
        position: from,
        teamId: this.owner.teamId,
        avatar: this.owner.avatar,
      } as any);
      this.zedWClone.owner = this.owner;
      this.zedWClone.spellSource = this;
      this.zedWClone.destination = to;
      this.game.objectManager.addObject(this.zedWClone);

      this.currentCooldown = 500;
      this.image = AssetManager.getAsset('spell_zed_w2');
    } else {
      const curPos = this.owner.position.copy();
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
  owner!: any;
  destination = createVector();
  _mapSpells: {
    [spellId: string]: {
      clone: any;
      source: any;
    };
  } = {};
  _pendingSpellIds: { id: string; mouse: any }[] = [];
  _reachedDestination = false;
  swapable = true;
  spellSource: Zed_W | null = null;

  smokeEffect = PredefinedParticleSystems.smoke([150], 2, 10);

  onSomeOnePreCastSpell = (sourceSpell: any) => {
    if (sourceSpell.owner.id !== this.owner.id) return;
    if (sourceSpell.id === this.spellSource?.id) return;
    if (sourceSpell instanceof Zed_W) return;

    let spell: any = null;
    if (sourceSpell.id in this._mapSpells) {
      spell = this._mapSpells[sourceSpell.id].clone;
    } else {
      spell = new sourceSpell.constructor(this);
      this._mapSpells[sourceSpell.id] = {
        clone: spell,
        source: sourceSpell,
      };
    }

    if (this._reachedDestination) {
      spell.cast();
    } else {
      this._pendingSpellIds.push({
        id: sourceSpell.id,
        mouse: this.game.worldMouse.copy(),
      });
    }
  };

  onAdded() {
    this.game.eventManager.on(EventType.ON_PRE_CAST_SPELL, this.onSomeOnePreCastSpell);

    this.setStatus(StatusFlags.Targetable, false);

    const originVisionRadius = this.stats.visionRadius.baseValue;
    this.stats.visionRadius.baseValue = 0;

    const dashBuff = new Dash(5000, this.owner, this);
    dashBuff.dashSpeed = 10;
    dashBuff.cancelable = false;
    dashBuff.dashDestination = this.destination;
    dashBuff.onReachedDestination = () => {
      this._reachedDestination = true;

      this._pendingSpellIds.forEach(({ id, mouse }: { id: string; mouse: any }) => {
        this.game.worldMouse = mouse;
        this._mapSpells[id].clone.cast();
      });

      this.stats.visionRadius.baseValue = originVisionRadius / 3;

      const size = this.stats.size.value;
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
    this.game.eventManager.unsub(EventType.ON_PRE_CAST_SPELL, this.onSomeOnePreCastSpell);
  }

  update() {
    super.update();

    this.smokeEffect.update();
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;

    for (const spellId in this._mapSpells) {
      const { clone } = this._mapSpells[spellId];
      clone.update();
    }
  }

  draw() {
    super.draw();

    const arrowSize = 20;
    const { to, distance } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.position,
      this.owner.animatedValues.size / 2 + 10 + arrowSize,
      false
    );
    if (distance > 0) {
      const angle = VectorUtils.getAngle(this.owner.position, this.position);
      push();
      translate(to.x, to.y);
      rotate(angle);
      fill(this.swapable ? [255, 150] : [255, 100, 100, 150]);
      noStroke();
      triangle(0, 0, -arrowSize, -arrowSize / 2, -arrowSize, arrowSize / 2);
      pop();
    }

    this.smokeEffect.draw();
  }

  drawHealthBar() {} // no health bar
  override move = (): boolean => true; // no movement
}
