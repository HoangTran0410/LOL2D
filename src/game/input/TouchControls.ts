/**
 * Wild Rift controls: a stick under the left thumb, spell buttons under the
 * right, press-drag-release to aim.
 *
 * This is the glue. The maths it needs lives in three pure neighbours —
 * `TouchLayout` (where things are), `VirtualJoystick` (what the stick reads)
 * and `SpellAim` (what a drag means) — and everything it needs from the game
 * arrives through `TouchControlsHost`, so the gesture machine below can be
 * driven in a plain node test with no canvas and no Game. Only `draw()` touches
 * p5, and no test calls it.
 *
 * The controls are drawn on the canvas rather than built out of DOM. Three
 * reasons, in order of how much they mattered:
 *
 *   1. Multi-touch. Both thumbs are down at once, constantly. p5 hands the
 *      whole `touches` array to one place; splitting the buttons into DOM
 *      elements would mean reconciling pointer capture across two event
 *      systems for the sake of a rounded rectangle.
 *   2. The aim telegraph is in *world* space — it has to line up with the
 *      champion, the terrain and the spell's real range. That is canvas work
 *      whatever the buttons are made of, and having half the control in one
 *      technology and half in another is how they drift apart.
 *   3. Cost. A phone is several times slower than the desktop these systems
 *      were measured on. Seven buttons redrawn by Vue at 60Hz is layout and
 *      style recalculation every frame; seven arcs is not.
 */
import {
  buttonAt,
  computeTouchLayout,
  hitRecall,
  insideJoystickZone,
  type TouchButton,
  type TouchLayout,
  type TouchViewport,
} from './TouchLayout';
import { VirtualJoystick, type JoystickVector } from './VirtualJoystick';
import { resolveSpellAim, type AimCandidate, type SpellAimResult } from './SpellAim';
import type { ActivationPattern, TargetingMode, Vec2 } from '@/game/spell/runtime/types';
import type { AttackTargetPriority } from '@/game/combat/AttackTargeting';

/** One finger, in canvas coordinates. */
export interface TouchPoint {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Everything the buttons need to know about a slot, flattened. */
export interface TouchSpellView {
  readonly targeting: TargetingMode;
  readonly activation: ActivationPattern;
  /** World units this spell reaches, used for both the aim and the telegraph. */
  readonly range: number;
  /** A single letter for the button face when the icon has not loaded. */
  readonly label: string;
  /** p5.Image once loaded, null while it is still a placeholder. */
  readonly icon: unknown;
  /** Fraction of the cooldown still to run, 0 when ready. */
  readonly cooldownRatio: number;
  /**
   * A real lockout — currentCooldown > 0 *and* it actually blocks casting.
   * False for the basic attack's swing timer, which counts down the same way
   * but never stops the player from swinging again: see `Spell.cooldownLocksOut`.
   */
  readonly onCooldown: boolean;
  /** Whole seconds left, only meaningful (and only drawn) while `onCooldown`. */
  readonly remainingSeconds: number;
  readonly manaCost: number;
  readonly affordable: boolean;
  readonly castable: boolean;
  readonly charging: boolean;
  /**
   * Mid-channel. Only the recall button draws anything from it today — no kit
   * slot's button has a channel long enough to be worth a clock — but it is
   * filled in for every view, because it is a fact about a spell's state and
   * not a fact about which button is asking.
   */
  readonly channeling?: boolean;
  /** 0..1 through that channel. Meaningless, and 0, while `channeling` is false. */
  readonly channelProgress?: number;
}

/**
 * What a button should look like, computed once as data so it can be tested
 * without a canvas — `drawButtons` below turns this into three or four p5
 * calls and nothing else.
 *
 * This is the thing the owner actually asked for: cooldown belongs on the
 * button a thumb is already resting on, not a panel in the corner the eye has
 * to travel to. It mirrors the three states the desktop HUD already drew for
 * that same reason (`InGameHUD`'s `.cooldown`, `.cooldown-overlay.rhythm` and
 * `.mana-cost.short`) so a player reads the same picture in both layouts:
 *
 *   - a real lockout: dark wedge, greyed icon, seconds counting down;
 *   - the basic attack's swing timer: a translucent warm sweep and nothing
 *     else — it is not a wait, and greying it out for the whole game (its
 *     "cooldown" runs constantly) would make the slot unreadable;
 *   - not enough mana: the icon dims the same as a lockout, and the mana
 *     badge — normally a quiet blue pill — turns red so *why* is legible at a
 *     glance, the way the corner HUD's short-mana badge already does.
 */
export interface ButtonVisual {
  /** Icon gets the dark disc: on a real cooldown, unaffordable, or uncastable. */
  readonly dim: boolean;
  readonly wedgeColor: readonly [number, number, number, number];
  /** Seconds-left stamp: only for a real lockout, never for the swing rhythm. */
  readonly showSeconds: boolean;
  readonly manaBadge: { readonly color: readonly [number, number, number, number] } | null;
}

/** A real lockout's wedge: dark and near-opaque, same weight as the desktop's `.cooldown`. */
export const LOCKOUT_WEDGE_COLOR = [6, 10, 18, 170] as const;
/** The swing timer's wedge: translucent warm, matching the desktop's `.cooldown-overlay.rhythm`. */
export const RHYTHM_WEDGE_COLOR = [255, 208, 132, 56] as const;
/** Mana badge, affordable: a quiet blue pill, matching the desktop's `.mana-cost`. */
export const MANA_BADGE_COLOR = [11, 30, 55, 225] as const;
/** Mana badge, short: red, matching the desktop's `.mana-cost.short`. */
export const MANA_BADGE_SHORT_COLOR = [70, 16, 16, 225] as const;

export function describeButtonVisual(view: TouchSpellView): ButtonVisual {
  return {
    dim: view.onCooldown || !view.affordable || !view.castable,
    wedgeColor: view.onCooldown ? LOCKOUT_WEDGE_COLOR : RHYTHM_WEDGE_COLOR,
    showSeconds: view.onCooldown && view.remainingSeconds > 0,
    manaBadge:
      view.manaCost > 0
        ? { color: view.affordable ? MANA_BADGE_COLOR : MANA_BADGE_SHORT_COLOR }
        : null,
  };
}

export interface TouchControlsHost {
  viewport(): TouchViewport;
  slotCount(): number;
  spellView(slot: number): TouchSpellView | null;
  /** Hồi Thành, built through the same shape as a kit slot. Null if there is none. */
  recallView(): TouchSpellView | null;
  /**
   * Start the trip home, or call off the one already running.
   *
   * Both halves are `Game.recall()`'s, not this file's: `B` and this button are
   * two ways into one action, and a second copy of "is it already channelling?"
   * here is how they would drift.
   */
  recall(): void;
  playerPosition(): Vec2;
  /** Unit vector the champion is pointed along. Never (0,0). */
  playerFacing(): Vec2;
  /** The tap's victim: nearest visible hostile body within `range`. */
  autoTargetWithin(range: number, priority: AttackTargetPriority): AimCandidate | null;
  pickUnitNear(point: Vec2, radius: number, preferred: AimCandidate | null): AimCandidate | null;
  /** Held stick direction, or null the frame the thumb lifts. */
  steer(direction: JoystickVector | null): void;
  /** Where slot `slot` is currently aimed, or null once the gesture is over. */
  setSlotAim(slot: number, world: Vec2 | null): void;
  beginSlot(slot: number): void;
  commitSlot(slot: number): void;
  cancelSlot(slot: number): void;
  /** Runs `draw` inside the camera transform, for the world-space telegraph. */
  withWorldTransform(draw: () => void): void;
}

type GesturePhase = 'AIMING' | 'CANCEL';

interface SlotGesture {
  readonly pointerId: number;
  readonly slot: number;
  readonly button: TouchButton;
  readonly downX: number;
  readonly downY: number;
  x: number;
  y: number;
  /** Travelled further than the tap slop at some point. */
  moved: boolean;
  /** Left the cancel circle at least once, which arms the abort. */
  armed: boolean;
  phase: GesturePhase;
  aim: SpellAimResult | null;
}
const TOUCH_HAPTIC_MS = 10;

/**
 * The three settings the pregame Settings tab reads and writes now live in
 * `touchPreferences.ts`, which imports nothing that draws — a settings panel
 * asking "is touch mode on?" used to pull this whole file, and with it the
 * joystick, the ability ring and `SpellAim`, into the pregame chunk.
 *
 * Re-exported so every existing `from '@/game/input/TouchControls'` still
 * resolves; new callers on a non-match screen should import the other file
 * directly, and `tests/scenes/pregameBootPath.test.ts` requires it.
 */
export {
  rememberTouchControlsPreference,
  setTouchModePreference,
  setTouchTargetPriorityPreference,
  touchControlsPreference,
  touchModePreference,
  touchTargetPriorityPreference,
  type TouchModePreference,
  type TouchTargetPriority,
} from './touchPreferences';

import {
  touchControlsPreference,
  touchTargetPriorityPreference,
  type TouchTargetPriority,
} from './touchPreferences';

const pulseTouchHaptic = (): void => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(TOUCH_HAPTIC_MS);
    }
  } catch {
    // Vibration is optional and may be denied by the browser or device policy.
  }
};

export class TouchControls {
  private _enabled: boolean;
  private layout: TouchLayout;
  private readonly joystick = new VirtualJoystick();
  private readonly gestures = new Map<number, SlotGesture>();
  /**
   * The finger on the recall button, if any, and whether it is still on it.
   *
   * A press, not a gesture: it aims nothing, charges nothing and has no slot to
   * hand `SpellInputController`. It fires on *release inside*, so a thumb that
   * lands on it by accident can slide off and nothing happens.
   */
  private recallPress: { readonly pointerId: number; inside: boolean } | null = null;
  /** Set while the stick is driving, so `steer(null)` fires exactly once. */
  private steering = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private readonly targetPriority: TouchTargetPriority;

  constructor(
    private readonly host: TouchControlsHost,
    enabled = false
  ) {
    this._enabled = enabled;
    this.targetPriority = touchTargetPriorityPreference();
    const viewport = host.viewport();
    this.viewportWidth = viewport.width;
    this.viewportHeight = viewport.height;
    this.layout = computeTouchLayout(viewport, host.slotCount());
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this._enabled) return;
    this._enabled = enabled;
    // Leaving touch mode mid-gesture must not strand a charge or a half-aimed
    // spell, and must not leave the champion walking at a stick nobody holds.
    if (!enabled) this.releaseEverything();
  }

  /** The current layout — the drawing code and the tests both read it. */
  get currentLayout(): TouchLayout {
    return this.layout;
  }

  /** True while a thumb is on this slot's button, for the button's own look. */
  gestureFor(
    slot: number
  ): { readonly phase: GesturePhase; readonly aim: SpellAimResult | null } | null {
    for (const gesture of this.gestures.values()) {
      if (gesture.slot === slot) return gesture;
    }
    return null;
  }

  resize(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.layout = computeTouchLayout({ width, height }, this.host.slotCount());
    // Buttons have moved under the fingers holding them; the gestures they
    // belong to no longer mean anything.
    this.releaseEverything();
  }

  /**
   * Reconcile against the full list of fingers currently on the glass.
   *
   * Driven from the raw list rather than from touchstart/touchmove/touchend
   * bookkeeping because p5 rebuilds `touches` before every one of those
   * callbacks anyway: a finger that vanished from the list has lifted, and that
   * is true no matter which event delivered the news. One code path handles a
   * lift, a cancel, an interrupting phone call and a browser that drops a
   * touchend.
   */
  syncPointers(points: readonly TouchPoint[]): void {
    if (!this._enabled) return;

    const seen = new Set<number>();
    for (const point of points) {
      seen.add(point.id);
      const gesture = this.gestures.get(point.id);
      if (gesture) {
        this.moveGesture(gesture, point.x, point.y);
      } else if (this.recallPress?.pointerId === point.id) {
        this.recallPress.inside = hitRecall(this.layout, point.x, point.y);
      } else if (this.joystick.pointerId === point.id) {
        this.joystick.moveTo(point.x, point.y);
      } else {
        this.beginPointer(point);
      }
    }

    for (const [id, gesture] of [...this.gestures]) {
      if (!seen.has(id)) this.endGesture(gesture);
    }

    if (this.recallPress && !seen.has(this.recallPress.pointerId)) {
      const onTarget = this.recallPress.inside;
      this.recallPress = null;
      if (onTarget) this.host.recall();
    }
    const stickId = this.joystick.pointerId;
    if (stickId !== null && !seen.has(stickId)) {
      this.joystick.end();
      if (this.steering) {
        this.steering = false;
        this.host.steer(null);
      }
    }
  }

  /** Called once per fixed update, before the spell input controller ticks. */
  update(): void {
    if (!this._enabled) return;

    if (this.joystick.active && this.joystick.magnitude > 0) {
      this.steering = true;
      this.host.steer(this.joystick.vector);
    } else if (this.steering && !this.joystick.active) {
      this.steering = false;
      this.host.steer(null);
    }

    for (const gesture of this.gestures.values()) {
      const aim = this.aimFor(gesture);
      gesture.aim = aim;
      this.host.setSlotAim(gesture.slot, aim ? aim.cursorWorld : null);
    }
  }

  /** Drop every gesture without casting anything. */
  releaseEverything(): void {
    // The recall press goes first and silently: leaving touch mode, or a resize
    // that moves the button out from under the thumb holding it, must not send
    // the champion home.
    this.recallPress = null;
    for (const gesture of [...this.gestures.values()]) {
      this.gestures.delete(gesture.pointerId);
      this.host.setSlotAim(gesture.slot, null);
      this.host.cancelSlot(gesture.slot);
    }
    this.joystick.end();
    if (this.steering) {
      this.steering = false;
      this.host.steer(null);
    }
  }

  // ---------------------------------------------------------------- gestures

  private beginPointer(point: TouchPoint): void {
    // Recall first, and it is the only claim tested before `buttonAt`: its
    // circle is nowhere near the fan, so the order costs nothing and says
    // plainly that a finger on it is never also a finger on a spell.
    if (!this.recallPress && this.host.recallView() && hitRecall(this.layout, point.x, point.y)) {
      this.recallPress = { pointerId: point.id, inside: true };
      pulseTouchHaptic();
      return;
    }

    const button = buttonAt(this.layout, point.x, point.y);
    if (button) {
      // One thumb per slot. A second finger arriving on a button already held
      // is a fumble, not a second cast.
      for (const existing of this.gestures.values()) {
        if (existing.slot === button.slot) return;
      }
      const gesture: SlotGesture = {
        pointerId: point.id,
        slot: button.slot,
        button,
        downX: point.x,
        downY: point.y,
        x: point.x,
        y: point.y,
        moved: false,
        armed: false,
        phase: 'AIMING',
        aim: null,
      };
      this.gestures.set(point.id, gesture);
      // Aim before pressing, not after. A charged spell is pressed *inside*
      // beginSlot, and it builds its cast context there — if the aim has not
      // landed yet, a charge spell starts charging at whatever the mouse last touched.
      gesture.aim = this.aimFor(gesture);
      this.host.setSlotAim(button.slot, gesture.aim ? gesture.aim.cursorWorld : null);
      this.host.beginSlot(button.slot);
      pulseTouchHaptic();
      return;
    }

    if (!this.joystick.active && insideJoystickZone(this.layout, point.x, point.y)) {
      this.joystick.begin(point.id, point.x, point.y, this.layout.joystickHome.radius, {
        width: this.viewportWidth,
        height: this.viewportHeight,
      });
    }
  }

  private moveGesture(gesture: SlotGesture, x: number, y: number): void {
    gesture.x = x;
    gesture.y = y;

    if (!gesture.moved) {
      gesture.moved = Math.hypot(x - gesture.downX, y - gesture.downY) > this.layout.tapSlop;
    }

    const cancelRadius = gesture.button.radius * this.layout.cancelRadiusScale;
    const fromCentre = Math.hypot(x - gesture.button.x, y - gesture.button.y);
    // The abort only arms once the thumb has genuinely left the button. Without
    // that, a thumb that lands near the rim and drags a little would read as
    // "came back" before it had ever gone.
    if (!gesture.armed && fromCentre > cancelRadius) gesture.armed = true;
    gesture.phase = gesture.armed && fromCentre <= cancelRadius ? 'CANCEL' : 'AIMING';
  }

  private endGesture(gesture: SlotGesture): void {
    this.gestures.delete(gesture.pointerId);
    if (gesture.phase === 'CANCEL') {
      this.host.setSlotAim(gesture.slot, null);
      this.host.cancelSlot(gesture.slot);
      return;
    }
    // The aim is recomputed here rather than reused from the last update, so a
    // flick that lands and lifts inside one frame still casts where it pointed.
    const aim = this.aimFor(gesture);
    this.host.setSlotAim(gesture.slot, aim ? aim.cursorWorld : null);
    this.host.commitSlot(gesture.slot);
    this.host.setSlotAim(gesture.slot, null);
  }

  private aimFor(gesture: SlotGesture): SpellAimResult | null {
    const view = this.host.spellView(gesture.slot);
    if (!view) return null;

    const drag = gesture.moved
      ? { x: gesture.x - gesture.downX, y: gesture.y - gesture.downY }
      : null;

    return resolveSpellAim({
      mode: view.targeting,
      origin: this.host.playerPosition(),
      range: view.range,
      // A cancelling thumb is still on screen, but it is no longer aiming: it
      // holds the tap aim so the telegraph stops chasing the abort gesture.
      drag: gesture.phase === 'CANCEL' ? null : drag,
      dragToRange: this.layout.dragToRange,
      facing: this.host.playerFacing(),
      autoTarget: gesture.moved
        ? null
        : this.host.autoTargetWithin(view.range, this.targetPriority),
      lockedTarget: gesture.aim?.target ?? null,
      pickUnitNear: (point, radius, preferred) => this.host.pickUnitNear(point, radius, preferred),
    });
  }

  // ----------------------------------------------------------------- drawing

  /** Screen space. Called after the fog, so the controls sit on top of it. */
  draw(): void {
    if (!this._enabled) return;

    this.drawAimTelegraph();
    this.drawJoystick();
    this.drawButtons();
    this.drawRecallButton();
  }

  /**
   * Hồi Thành, top-right.
   *
   * A house rather than a letter: the desktop button can label itself `B`
   * because there is a key to press, and on the surface this one lives on
   * there is not. The filling arc is the same clock `RecallPad` draws under the
   * champion's feet, so the button and the ground never disagree about how far
   * along the trip is, and it is the only lit thing on the button while the
   * trip runs — which is also how the button says it is a cancel now.
   */
  private drawRecallButton(): void {
    const view = this.host.recallView();
    if (!view) return;

    const button = this.layout.recall;
    const diameter = button.radius * 2;
    const held = this.recallPress?.inside === true;
    const running = view.channeling === true;
    const filled = Math.min(1, Math.max(0, view.channelProgress ?? 0));
    const lit = view.castable ? 255 : 130;

    push();
    rectMode(CENTER);

    noStroke();
    fill(12, 16, 24, running ? 225 : 190);
    circle(button.x, button.y, diameter);

    // The house. Two shapes, drawn from the button's own radius so it scales
    // with the viewport the same way the ability icons do.
    const span = button.radius * 0.86;
    const eaves = button.y - span * 0.06;
    noFill();
    stroke(235, 226, 205, held ? lit : lit * 0.85);
    strokeWeight(Math.max(2, button.radius * 0.11));
    triangle(
      button.x - span * 0.5,
      eaves,
      button.x + span * 0.5,
      eaves,
      button.x,
      button.y - span * 0.52
    );
    rect(button.x, eaves + span * 0.24, span * 0.62, span * 0.48);

    // The channel's clock: an unlit rim and the arc that eats it, the same
    // pair `RecallPad` paints on the ground. It is the only bright thing on
    // the button while the trip runs — the outer ring goes *down* to a dim
    // gold rather than up, because a bright full circle around a partial arc
    // is what makes the partial arc unreadable.
    if (running) {
      noFill();
      stroke(120, 95, 45, 170);
      strokeWeight(5);
      circle(button.x, button.y, diameter - 10);
      stroke(255, 224, 158, 245);
      strokeWeight(5);
      arc(button.x, button.y, diameter - 10, diameter - 10, -HALF_PI, -HALF_PI + filled * TWO_PI);
    }

    noFill();
    strokeWeight(running ? 2 : 3);
    if (running) stroke(150, 118, 62, 170);
    else if (held) stroke(120, 220, 255, 240);
    else stroke(210, 210, 210, view.castable ? 150 : 80);
    circle(button.x, button.y, diameter);
    pop();
  }

  private drawAimTelegraph(): void {
    let gesture: SlotGesture | null = null;
    for (const candidate of this.gestures.values()) {
      if (candidate.aim) gesture = candidate;
    }
    if (!gesture || !gesture.aim) return;

    const view = this.host.spellView(gesture.slot);
    if (!view) return;

    const aim = gesture.aim;
    const origin = this.host.playerPosition();
    const cancelling = gesture.phase === 'CANCEL';

    this.host.withWorldTransform(() => {
      push();
      noFill();

      if (cancelling) {
        stroke(220, 70, 70, 150);
        strokeWeight(3);
        circle(origin.x, origin.y, view.range * 2);
        pop();
        return;
      }

      // The reach ring first, under everything: it is the honest statement of
      // where this spell can and cannot go.
      stroke(120, 200, 255, 70);
      strokeWeight(2);
      circle(origin.x, origin.y, view.range * 2);

      if (view.targeting === 'SELF') {
        stroke(120, 220, 255, 190);
        strokeWeight(4);
        circle(origin.x, origin.y, view.range * 2 - 6);
        pop();
        return;
      }

      if (view.targeting === 'UNIT') {
        const target = aim.target;
        if (target) {
          stroke(255, 210, 90, 230);
          strokeWeight(4);
          circle(target.position.x, target.position.y, 92);
          stroke(255, 210, 90, 120);
          strokeWeight(3);
          line(origin.x, origin.y, target.position.x, target.position.y);
        } else {
          stroke(220, 80, 80, 170);
          strokeWeight(3);
          line(origin.x, origin.y, aim.cursorWorld.x, aim.cursorWorld.y);
        }
        pop();
        return;
      }

      if (view.targeting === 'POINT') {
        stroke(120, 220, 255, 220);
        strokeWeight(3);
        circle(aim.cursorWorld.x, aim.cursorWorld.y, 120);
        stroke(120, 220, 255, 110);
        strokeWeight(2);
        line(origin.x, origin.y, aim.cursorWorld.x, aim.cursorWorld.y);
        pop();
        return;
      }

      // DIRECTION: the skillshot lane, drawn at the spell's real length so the
      // player is reading the actual reach and not a decorative arrow.
      const endX = origin.x + aim.direction.x * view.range;
      const endY = origin.y + aim.direction.y * view.range;
      stroke(120, 220, 255, 200);
      strokeWeight(6);
      line(origin.x, origin.y, endX, endY);
      stroke(255, 255, 255, 210);
      strokeWeight(3);
      const back = 46;
      const side = 26;
      const nx = -aim.direction.y;
      const ny = aim.direction.x;
      line(
        endX,
        endY,
        endX - aim.direction.x * back + nx * side,
        endY - aim.direction.y * back + ny * side
      );
      line(
        endX,
        endY,
        endX - aim.direction.x * back - nx * side,
        endY - aim.direction.y * back - ny * side
      );
      pop();
    });
  }

  private drawJoystick(): void {
    const home = this.layout.joystickHome;
    const base = this.joystick.active ? this.joystick.base : home;
    const radius = this.joystick.active ? this.joystick.radius : home.radius;
    const knob = this.joystick.active ? this.joystick.knob : base;

    push();
    noFill();
    stroke(230, 230, 230, this.joystick.active ? 140 : 70);
    strokeWeight(3);
    circle(base.x, base.y, radius * 2);

    noStroke();
    fill(255, 255, 255, this.joystick.active ? 60 : 26);
    circle(base.x, base.y, radius * 2 - 8);

    fill(240, 240, 240, this.joystick.active ? 220 : 130);
    circle(knob.x, knob.y, this.layout.knobRadius * 2);
    pop();
  }

  private drawButtons(): void {
    push();
    // Never tint. p5's tint() does not set a canvas property — it re-runs the
    // whole image through a per-pixel loop on a scratch canvas on *every*
    // image() call, uncached. Seven icons a frame made it the single most
    // expensive thing this layer did, by a wide margin. A greyed-out button is
    // drawn as the icon plus a dark disc over it instead, which is one fill.
    noTint();
    textAlign(CENTER, CENTER);

    for (const button of this.layout.buttons) {
      const view = this.host.spellView(button.slot);
      if (!view) continue;
      const gesture = this.gestureFor(button.slot);
      const cancelling = gesture?.phase === 'CANCEL';
      const visual = describeButtonVisual(view);
      const diameter = button.radius * 2;

      noStroke();
      fill(12, 16, 24, 200);
      circle(button.x, button.y, diameter);

      if (view.icon) {
        // imageMode(CENTER) is set once in GameScene.enter and never changed.
        // 1.36 rather than something larger because the icon is square and the
        // button is round: a square of side s only fits a circle of diameter d
        // while s <= d/sqrt(2), and anything above that hangs its corners out
        // past the ring.
        const size = button.radius * 1.36;
        image(view.icon as p5.Image, button.x, button.y, size, size);
      } else {
        fill(230, 230, 230, visual.dim ? 120 : 230);
        textSize(button.radius * 0.8);
        text(view.label, button.x, button.y);
      }

      if (visual.dim) {
        noStroke();
        fill(8, 12, 20, 130);
        circle(button.x, button.y, diameter);
      }

      // The cooldown wedge: a cap sweeping round what is left to run. Dark and
      // near-opaque for a real lockout; a translucent warm sweep for the basic
      // attack's swing rhythm, which never stops the player from swinging.
      if (view.cooldownRatio > 0) {
        noStroke();
        fill(...visual.wedgeColor);
        arc(
          button.x,
          button.y,
          diameter,
          diameter,
          -HALF_PI,
          -HALF_PI + TWO_PI * view.cooldownRatio,
          PIE
        );
      }

      // Seconds left: only for a real lockout. The swing rhythm has no number
      // for the same reason the desktop HUD never stamps one on it — it would
      // be counting down for the whole game.
      if (visual.showSeconds) {
        noStroke();
        fill(240, 240, 240, 235);
        textSize(button.radius * 0.62);
        text(String(view.remainingSeconds), button.x, button.y);
      }

      // Mana badge, bottom-left of the ring — the one corner the seconds
      // stamp (centre) and the cancel cross (also centre) never reach. Blue
      // normally, red when the pool cannot afford it, same convention as the
      // corner HUD's `.mana-cost` / `.mana-cost.short`.
      if (visual.manaBadge) {
        const badgeX = button.x - button.radius * 0.62;
        const badgeY = button.y + button.radius * 0.62;
        const badgeR = Math.max(9, button.radius * 0.34);
        noStroke();
        fill(...visual.manaBadge.color);
        circle(badgeX, badgeY, badgeR * 2);
        fill(200, 226, 255, 255);
        textSize(badgeR * 0.95);
        text(String(view.manaCost), badgeX, badgeY);
      }

      noFill();
      strokeWeight(button.primary ? 5 : 3);
      if (cancelling) stroke(235, 70, 70, 240);
      else if (view.charging) stroke(255, 208, 120, 240);
      else if (gesture) stroke(120, 220, 255, 240);
      else stroke(210, 210, 210, visual.dim ? 90 : 160);
      circle(button.x, button.y, diameter);

      if (cancelling) {
        stroke(235, 70, 70, 245);
        strokeWeight(5);
        const arm = button.radius * 0.45;
        line(button.x - arm, button.y - arm, button.x + arm, button.y + arm);
        line(button.x + arm, button.y - arm, button.x - arm, button.y + arm);
      }
    }
    pop();
  }
}

export default TouchControls;
