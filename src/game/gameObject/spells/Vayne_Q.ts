import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import type { BasicAttackHit } from '@/game/combat/BasicAttack';
import { effectiveRange } from '@/game/combat/Reach';
import BuffAddType from '@/game/enums/BuffAddType';
import EventType from '@/game/enums/EventType';
import type { CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Buff from '@/game/gameObject/Buff';
import Dash from '@/game/gameObject/buffs/Dash';
import Invisible from '@/game/gameObject/buffs/Invisible';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import { VAYNE_R_Q_CDR, VAYNE_R_STEALTH_MS, Vayne_R_Buff } from './Vayne_R';

/** How far the roll carries her. Repositioning, not travel. */
export const VAYNE_Q_DISTANCE = 200;
/** How long the loaded bolt keeps. */
export const VAYNE_Q_EMPOWER_MS = 4_000;
/** What the loaded bolt adds to the one basic attack that spends it. */
export const VAYNE_Q_BONUS = 12;

/** Roll time. The dash speed is derived from it so retuning one number is enough. */
const ROLL_MS = 260;
/** One frame at 60fps, for turning a duration into a per-frame step. */
const FRAME_MS = 16.67;
/** How far past her body the loaded tip paints. */
const TIP_REACH = 40;
/** How far past its centre the on-victim bolt flash paints. */
const FLASH_REACH = 48;

/**
 * Tumble — a short roll that loads her next bolt.
 *
 * The bonus is not a reimplemented swing: it subscribes to
 * `EventType.ON_ATTACK_HIT`, which `combat/BasicAttack` is the sole emitter of,
 * so it lands on whatever the basic attack actually was and nothing else.
 */
export default class Vayne_Q extends Spell {
  image = AssetManager.get('spell_vayne_q');
  name = 'Nhào Lộn (Vayne_Q)';
  description = `Lăn một đoạn ngắn. Đòn đánh thường kế tiếp trong
    ${VAYNE_Q_EMPOWER_MS / 1000} giây gây thêm
    <span class="damage">${VAYNE_Q_BONUS} sát thương</span>.`;
  coolDown = 4_000;
  manaCost = 20;
  range = VAYNE_Q_DISTANCE;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown * this.cooldownScale },
    };
  }

  /**
   * Final Hour's cooldown reduction, expressed where the runtime already reads
   * it: `Spell.effectiveCoolDownMs` runs `castSpec.cooldown.durationMs` through
   * `reducedCooldown`, so writing it here keeps the match-wide CDR rule stacked
   * on top of it and leaves `coolDown` as the tuning number it is.
   */
  private get cooldownScale(): number {
    return this.owner?.hasBuff?.(Vayne_R_Buff) ? VAYNE_R_Q_CDR : 1;
  }

  checkCastCondition(): boolean {
    return Dash.CanDash(this.owner);
  }

  onSpellCast(): void {
    // getVectorWithRange randomises a zero-length aim, which is the (0,0) guard.
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      VAYNE_Q_DISTANCE
    );

    const roll = new Dash(ROLL_MS + 140, this.owner, this.owner);
    roll.dashDestination = to;
    roll.dashSpeed = Math.max(6, VAYNE_Q_DISTANCE / Math.max(1, ROLL_MS / FRAME_MS));
    roll.trailSystem = new TrailSystem({
      owner: this.owner,
      maxLength: 20,
      trailColor: '#ecf0f1aa',
      trailLifeTime: 300,
    });
    this.owner.addBuff(roll);

    const loaded = new Vayne_Q_Empower(VAYNE_Q_EMPOWER_MS, this.owner, this.owner);
    this.owner.addBuff(loaded);

    // The loaded state is one layer, and it is an object rather than caster VFX
    // so it keeps drawing on frames the champion draw is skipped.
    const tip = new Vayne_Q_Loaded(this.owner, loaded);
    this.game.objectManager.addObject(tip);

    if (this.owner.hasBuff(Vayne_R_Buff)) {
      this.owner.addBuff(new Invisible(VAYNE_R_STEALTH_MS, this.owner, this.owner));
    }
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The loaded bolt, as a listener rather than a swing of its own.
 *
 * It stays subscribed for its whole life and gates on `spent`, then ends itself
 * on the next `onUpdate`. Unsubscribing from inside the callback would splice
 * the subscriber array while `EventManager.emit` is iterating it, which silently
 * skips whichever listener sat next — Silver Bolts, if W is up at the same time.
 */
export class Vayne_Q_Empower extends Buff {
  name = 'Mũi Bạc Đã Lên Dây';
  description = 'Đòn đánh thường kế tiếp gây thêm sát thương.';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  private spent = false;
  private unsubscribe: (() => void) | null = null;

  onActivate(): void {
    this.unsubscribe = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) =>
      this.onBoltLanded(hit)
    );
  }

  onUpdate(): void {
    if (this.spent) this.deactivateBuff();
  }

  onDeactivate(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onBoltLanded(hit: BasicAttackHit): void {
    if (this.spent || !hit) return;
    // Every event is global, so the owner filter is the whole subscription.
    if (hit.attacker !== this.targetUnit) return;

    const victim = hit.victim;
    if (!victim || victim.isDead) return;

    this.spent = true;
    victim.takeDamage(VAYNE_Q_BONUS, this.sourceUnit);
    this.game.objectManager.addObject(
      new Vayne_Q_Bolt_Flash(this.sourceUnit, victim.position.copy())
    );
  }
}

/**
 * A single bolt tip glowing at her hands while the empower is live — the one
 * layer that says "loaded", riding the buff so it cannot outlive it.
 */
export class Vayne_Q_Loaded extends SpellObject {
  age = 0;
  private host: AttackableUnit;

  constructor(owner: AttackableUnit, loaded: Buff) {
    super(owner);
    this.host = owner;
    this.attachTo(owner, loaded);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.host.position.x, this.host.position.y);
    this.age += deltaTime;
  }

  draw(): void {
    const bodySize = this.host.animatedValues.displaySize || this.host.stats.size.value;
    const heading = Math.atan2(
      this.host.destination.y - this.host.position.y,
      this.host.destination.x - this.host.position.x
    );
    const breath = 0.7 + 0.3 * sin(this.age / 170);
    const offset = bodySize * 0.55;

    push();
    translate(this.position.x, this.position.y);
    rotate(heading);
    noStroke();
    // A bolt tip: a thin silver wedge, brightest at the point.
    fill(236, 240, 241, 200 * breath);
    triangle(offset + 13, 0, offset - 4, -4, offset - 4, 4);
    fill(255, 255, 255, 230 * breath);
    circle(offset + 13, 0, 5 * breath + 3);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(TIP_REACH * 2);
  }
}

/**
 * The bonus landing, drawn on the body that took it: a silver bolt cut across
 * the victim rather than grit at the missile's centre.
 */
export class Vayne_Q_Bolt_Flash extends SpellObject {
  lifeTime = 260;
  age = 0;

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    const swept = 14 + 30 * opened;

    push();
    translate(this.position.x, this.position.y);
    stroke(236, 240, 241, 235 * fade);
    strokeWeight(3 * fade + 1);
    // Two crossing cuts, not a burst: her whole kit is lines.
    line(-swept, -swept * 0.35, swept, swept * 0.35);
    line(-swept * 0.35, swept, swept * 0.35, -swept);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(FLASH_REACH * 2);
  }
}
