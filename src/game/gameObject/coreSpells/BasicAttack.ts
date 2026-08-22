import AssetManager from '@/managers/AssetManager';
import Spell from '@/game/gameObject/Spell';
import {
  CURSOR_ACQUISITION_RADIUS,
  FALLBACK_CHASE_MARGIN,
  findAttackTargetNearPoint,
} from '@/game/combat/AttackTargeting';
import { DEFAULT_CHAMPION_ATTACK } from '@/game/gameObject/attackableUnits/Champion';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type BasicAttackController from '@/game/combat/BasicAttackController';
import type { CastContext, CastSpec, Vec2 } from '@/game/spell/runtime/types';

/**
 * The basic attack, as an ability.
 *
 * "Đánh thường cũng là 1 dạng spell" — the champion's own attack is a spell like
 * every other, so it lives in a spell slot instead of in a private key binding.
 * `SpellHotKeys[0]` is already `A` and slot 0 is already the internal slot, so
 * putting this class there is what makes `A` order an attack: the press travels
 * the same SpellInputController path as Q/W/E/R, and the HUD gives the slot an
 * icon, a tooltip and a timer for free.
 *
 * It owns none of the fighting. Acquisition is `findAttackTargetNearPoint`, the
 * standing order and the chase and the swing timer are BasicAttackController,
 * the delivery is combat/BasicAttack.ts, and an on-hit passive hangs off
 * `EventType.ON_ATTACK_HIT` (see an on-hit passive ability). All this class does is turn a key
 * press into an order.
 *
 * Made to be subclassed. A champion with an attack of its own overrides
 * `acquisitionRadius` or `acquire`, or `order` for something stranger, and puts
 * the subclass in its preset — the machinery underneath is unchanged, which is
 * the whole point of the attack being a spell.
 */
export default class BasicAttack extends Spell {
  name = 'Đánh Thường (Basic Attack)';
  image = AssetManager.get('spell_basic_attack');
  description =
    `Ra lệnh <span class="buff">đánh thường</span> mục tiêu địch <span>gần con trỏ chuột nhất</span> ` +
    `(trong vòng <span>${CURSOR_ACQUISITION_RADIUS}</span> đơn vị quanh con trỏ, và phải nhìn thấy được). ` +
    `Nếu <span class="buff">quanh con trỏ không có ai</span>, tự động đánh <span>kẻ địch gần bản thân nhất</span> ` +
    `trong <span class="buff">tầm với</span> — để vừa chạy vừa quay lại bắn (con trỏ vẫn dùng để chỉ hướng chạy). ` +
    `Tướng sẽ <span class="buff">tự đuổi theo và đánh liên tục</span> cho tới khi mục tiêu chết, ` +
    `chạy khỏi tầm nhìn, hoặc lệnh bị huỷ — bởi <span class="debuff">hiệu ứng khống chế</span>, ` +
    `bởi lệnh di chuyển (chuột phải xuống đất), hoặc khi bạn dùng một chiêu thức khác. ` +
    `Nhịp đánh và sát thương lấy từ chỉ số của tướng, không phải từ chiêu thức này.`;

  /**
   * Display only, and refreshed from the live swing timer every frame by
   * `onUpdate`. The starting value is the default champion profile so the
   * picker — which builds one ownerless instance of every spell just to read its
   * name, icon and tooltip — shows a real interval instead of `0s`.
   */
  coolDown = 1_000 / DEFAULT_CHAMPION_ATTACK.attacksPerSecond;
  manaCost = 0;

  /** How far from the cursor a press reaches. Override for a per-champion feel. */
  get acquisitionRadius(): number {
    return CURSOR_ACQUISITION_RADIUS;
  }

  /**
   * How far from the *champion* a press reaches once the cursor came up empty.
   *
   * Derived rather than tuned, from the two numbers that already bound an
   * attack order:
   *
   *   - the champion's own reach, so the fallback is "someone I can shoot",
   *     which is what makes this a kiting key and not a charge key. It is the
   *     live stat, so a champion's own range-boosting passive lengthens the fallback the same
   *     frame it lengthens the swing;
   *   - `visionRadius`, because `BasicAttackController.leashTo` gives the order
   *     up past exactly that. Acquiring beyond it would hand the controller a
   *     target it drops on the next frame — an order that visibly does nothing.
   */
  get fallbackRadius(): number {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner) return 0;
    const reach = owner.stats.attackRange.value + owner.stats.size.value / 2;
    return Math.min(reach + FALLBACK_CHASE_MARGIN, owner.stats.visionRadius.value);
  }

  /**
   * Instant, and never on cooldown of its own: the real gate is the swing timer
   * inside BasicAttackController, which is already running whether or not
   * anybody pressed anything. A press with nobody near the cursor has to stay
   * free, otherwise a miss would lock the key.
   */
  get castSpec(): Readonly<CastSpec> {
    return BASIC_ATTACK_CAST_SPEC;
  }

  /**
   * Deliberately not `super.castCancelCheck()`: that gate is `canCast`, and a
   * silence stops abilities without stopping swings. The gate for a swing is
   * `canAttack`, which is what a disarm and every controlling crowd control
   * clear. There is no resource to check — an attack costs nothing.
   */
  castCancelCheck(): boolean {
    const owner = this.owner as AttackableUnit | undefined;
    return this.disabled || !owner || owner.isDead || !owner.canAttack;
  }

  /**
   * The swing timer, live, so the HUD shows the real thing. `coolDown` is the
   * interval derived from `stats.attackSpeed` and `currentCooldown` is the
   * countdown the controller is actually running, which means an attack speed
   * buff shortens the wedge on the icon the same frame it shortens the swing.
   * Faking a static number here would have drifted from the timer immediately.
   */
  onUpdate(): void {
    const controller = this.controller;
    if (controller) this.coolDown = controller.intervalMs;
  }

  get currentCooldown(): number {
    return this.controller?.cooldownMs ?? 0;
  }

  /**
   * Ignored on purpose. The swing timer belongs to the controller, and a spell
   * level reset (`Spell.resetCoolDown`, which every refused cast runs) must not
   * hand back a swing.
   */
  set currentCooldown(_remainingMs: number) {}

  /** A swing rhythm, not a wait. See `Spell.cooldownLocksOut`. */
  get cooldownLocksOut(): boolean {
    return false;
  }

  onSpellCast(context: CastContext): void {
    const target = this.acquire(context.cursorWorld);
    if (target) this.order(target);
  }

  /**
   * The enemy this press picked, or null for "nothing there" — a no-op.
   *
   * Two passes, in this order, and the order is the whole design: whatever the
   * player is pointing at wins, and only when they are pointing at empty ground
   * does the champion pick for itself. Aim is never overruled — it is only
   * answered when there was none.
   */
  protected acquire(cursor: Vec2): AttackableUnit | null {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner) return null;
    const aimed = findAttackTargetNearPoint(owner, cursor, this.acquisitionRadius);
    if (aimed) return aimed;
    return findAttackTargetNearPoint(owner, owner.position, this.fallbackRadius);
  }

  /** Hands the target to the champion, which owns the standing order. */
  protected order(target: AttackableUnit): void {
    this.controller?.order(target);
  }

  /** Undefined for the ownerless instances the spell picker builds. */
  protected get controller(): BasicAttackController | undefined {
    return (this.owner as { basicAttack?: BasicAttackController } | undefined)?.basicAttack;
  }

  /** Hovering the slot shows the champion's reach, not a fixed number. */
  drawPreview(): void {
    const owner = this.owner as AttackableUnit | undefined;
    if (!owner?.position) return;
    push();
    noFill();
    stroke(255, 220, 160, 120);
    strokeWeight(2);
    circle(
      owner.position.x,
      owner.position.y,
      (owner.stats.attackRange.value + owner.stats.size.value / 2) * 2
    );
    pop();
  }
}

const BASIC_ATTACK_CAST_SPEC: Readonly<CastSpec> = Object.freeze({
  activation: 'PRESS',
  // POINT rather than UNIT: the target is picked by proximity to the cursor
  // inside a radius, which is not the "cursor is touching the body" test
  // TargetResolver applies, and it has to respect the fog of war on top.
  targeting: 'POINT',
  castTimeMs: 0,
  resource: Object.freeze({ commitAt: 'start', refundOn: [] }),
  cooldown: Object.freeze({ startAt: 'start', durationMs: 0 }),
  // The one spell that must not clear the standing attack order when it is
  // cast, because casting it *is* the order. Everything else drops it — see
  // `Spell.press` and the table in docs/ADDING_SPELLS.md.
  attackOrder: 'keep',
} as CastSpec);
