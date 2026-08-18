import AssetManager from '@/managers/AssetManager';
import EventType from '@/game/enums/EventType';
import StatusFlags from '@/game/enums/StatusFlags';
import VectorUtils from '@/utils/vector.utils';
import { uuidv4 } from '@/utils';
import { isChargeActivation, type CastContext } from '@/game/spell/runtime/types';
import Champion from '@/game/gameObject/attackableUnits/Champion';
import Dash from '@/game/gameObject/buffs/Dash';
import { PredefinedParticleSystems } from '@/game/gameObject/helpers/ParticleSystem';
import Spell from '@/game/gameObject/Spell';

export default class Zed_W extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân <span class="buff">Lướt</span> tới trước, sau đó đứng im và sẽ <span>bắt chước</span> các kỹ năng bạn tung ra trong <span class="time">3 giây</span>. Có thể tái kích hoạt kỹ năng để <span class="buff">Đổi chỗ</span> với phân thân <i>(Phân thân không thể bị chọn làm mục tiêu)</i>';
  coolDown = 7500;
  manaCost = 30;
  /** Matches the 350 passed to `getVectorWithMaxRange` below, so the touch
   * telegraph's reach ring shows the shadow's real range instead of guessing
   * `DEFAULT_TOUCH_AIM_RANGE`. */
  range = 350;

  zedWClone: Zed_W_Clone | null = null;

  onSpellCast() {
    if (!this.zedWClone) {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
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

      // recast window, not a cooldown — deliberately not reduced
      this.currentCooldown = 500;
      this.image = AssetManager.get('spell_zed_w2');
    } else {
      const curPos = this.owner.position.copy();
      // Grounded refuses the swap. The shadow stays put and stays swappable, so
      // the recast is held rather than wasted.
      if (!this.blinkOwnerTo(this.zedWClone.position.x, this.zedWClone.position.y)) return;
      this.currentCooldown = this.reducedCooldown(this.coolDown);

      this.zedWClone.teleportTo(curPos.x, curPos.y);
      this.zedWClone.swapable = false;
      this.zedWClone = null;
      this.image = AssetManager.get('spell_zed_w');
    }
  }

  onUpdate() {
    if (this.zedWClone?.toRemove) {
      this.zedWClone = null;
      this.currentCooldown = this.reducedCooldown(this.coolDown);
      this.image = AssetManager.get('spell_zed_w');
    }
  }
}

/** One player spell the shadow mimics, plus the state needed to mirror a charge. */
interface MimickedSpell {
  clone: Spell;
  source: Spell;
  /** Set while the clone is charging; the context its release must be fed. */
  chargeContext?: CastContext;
  /** True once the source spell actually fired, so a fizzle is not mirrored as a cast. */
  sourceReleased: boolean;
}

export class Zed_W_Clone extends Champion {
  lifeTime = 3000;
  age = 0;
  owner!: any;
  destination = createVector();
  _mapSpells: { [spellId: string]: MimickedSpell } = {};
  _pendingSpellIds: { id: string; context: CastContext }[] = [];
  _reachedDestination = false;
  swapable = true;
  spellSource: Zed_W | null = null;

  smokeEffect = PredefinedParticleSystems.smoke([150], 2, 10);

  onSomeOnePreCastSpell = (sourceSpell: any) => {
    if (sourceSpell.owner.id !== this.owner.id) return;
    if (sourceSpell.id === this.spellSource?.id) return;
    if (sourceSpell instanceof Zed_W) return;
    const sourceContext = sourceSpell.castContext as CastContext | undefined;
    if (!sourceContext) return;

    let entry = this._mapSpells[sourceSpell.id];
    if (!entry) {
      entry = {
        clone: new sourceSpell.constructor(this),
        source: sourceSpell,
        sourceReleased: false,
      };
      this._mapSpells[sourceSpell.id] = entry;
    }
    entry.sourceReleased = false;
    entry.chargeContext = undefined;

    if (this._reachedDestination) {
      this.pressClone(entry, sourceContext);
    } else {
      this._pendingSpellIds.push({
        id: sourceSpell.id,
        context: sourceContext,
      });
    }
  };

  onSomeOnePostCastSpell = (sourceSpell: any) => {
    const entry = this._mapSpells[sourceSpell?.id];
    if (entry) entry.sourceReleased = true;
  };

  pressClone(entry: MimickedSpell, sourceContext: CastContext) {
    const spell = entry.clone;
    const origin = Object.freeze({ x: this.position.x, y: this.position.y });
    const cursorWorld = Object.freeze({ ...sourceContext.cursorWorld });
    const dx = cursorWorld.x - origin.x;
    const dy = cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy);

    const context = Object.freeze({
      ...sourceContext,
      spellId: spell.id,
      activationId: uuidv4(),
      caster: this,
      origin,
      cursorWorld,
      direction: Object.freeze({
        x: length === 0 ? 0 : dx / length,
        y: length === 0 ? 0 : dy / length,
      }),
    });

    if (!spell.press(context)) return;
    // Charge spells only spawn anything in onRelease, so the shadow has to keep
    // driving hold/release itself the way the player's input controller does.
    if (isChargeActivation(spell.castSpec.activation)) entry.chargeContext = context;
  }

  /** Keeps a charging clone in sync with the spell the player is charging. */
  mirrorCharge(entry: MimickedSpell) {
    const context = entry.chargeContext;
    if (!context) return;

    if (entry.clone.state !== 'CHARGING') {
      entry.chargeContext = undefined;
      return;
    }
    if (entry.source.state === 'CHARGING') {
      entry.clone.hold(context);
      return;
    }

    entry.chargeContext = undefined;
    if (entry.sourceReleased) entry.clone.release(context);
    else entry.clone.cancel('MAX_DURATION');
  }

  onAdded() {
    this.game.eventManager.on(EventType.ON_PRE_CAST_SPELL, this.onSomeOnePreCastSpell);
    this.game.eventManager.on(EventType.ON_POST_CAST_SPELL, this.onSomeOnePostCastSpell);

    this.setStatus(StatusFlags.Targetable, false);

    const originVisionRadius = this.stats.visionRadius.baseValue;
    this.stats.visionRadius.baseValue = 0;

    const dashBuff = new Dash(5000, this.owner, this);
    dashBuff.dashSpeed = 10;
    dashBuff.cancelable = false;
    dashBuff.dashDestination = this.destination;
    dashBuff.onReachedDestination = () => {
      this._reachedDestination = true;

      this._pendingSpellIds.forEach(({ id, context }) => {
        this.pressClone(this._mapSpells[id], context);
      });
      this._pendingSpellIds = [];

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
    this.game.eventManager.unsub(EventType.ON_POST_CAST_SPELL, this.onSomeOnePostCastSpell);
  }

  update() {
    super.update();

    this.smokeEffect.update();
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;

    for (const spellId in this._mapSpells) {
      const entry = this._mapSpells[spellId];
      entry.clone.update();
      this.mirrorCharge(entry);
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
