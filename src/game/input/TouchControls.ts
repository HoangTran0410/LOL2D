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
  insideJoystickZone,
  type TouchButton,
  type TouchLayout,
  type TouchViewport,
} from './TouchLayout';
import { VirtualJoystick, type JoystickVector } from './VirtualJoystick';
import { resolveSpellAim, type AimCandidate, type SpellAimResult } from './SpellAim';
import type { ActivationPattern, TargetingMode, Vec2 } from '../spell/runtime/types';

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
  readonly onCooldown: boolean;
  readonly affordable: boolean;
  readonly castable: boolean;
  readonly charging: boolean;
}

export interface TouchControlsHost {
  viewport(): TouchViewport;
  slotCount(): number;
  spellView(slot: number): TouchSpellView | null;
  playerPosition(): Vec2;
  /** Unit vector the champion is pointed along. Never (0,0). */
  playerFacing(): Vec2;
  /** The tap's victim: nearest visible hostile body within `range`. */
  autoTargetWithin(range: number): AimCandidate | null;
  pickUnitNear(point: Vec2, radius: number): AimCandidate | null;
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

const STORAGE_KEY = 'lol2d.touchControls';

/**
 * Whether the controls start on.
 *
 * Three sources, most explicit first. The query parameter is what makes the
 * whole thing verifiable: Playwright drives a desktop Chrome, and without an
 * override there would be no way to reach these controls from a test at all.
 * The stored preference is what makes the on-screen toggle stick across a
 * reload. Capability detection is the default for a real phone.
 */
export function touchControlsPreference(): boolean {
  try {
    const query = new URLSearchParams(window.location.search).get('touch');
    if (query === '1' || query === 'true' || query === 'on') return true;
    if (query === '0' || query === 'false' || query === 'off') return false;
  } catch {
    /* no location: fall through to the stored preference */
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* storage blocked: fall through to detection */
  }
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
  return typeof window !== 'undefined' && 'ontouchstart' in window;
}

export function rememberTouchControlsPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* storage blocked: the toggle still works for this session */
  }
}

export class TouchControls {
  private _enabled: boolean;
  private layout: TouchLayout;
  private readonly joystick = new VirtualJoystick();
  private readonly gestures = new Map<number, SlotGesture>();
  /** Set while the stick is driving, so `steer(null)` fires exactly once. */
  private steering = false;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(private readonly host: TouchControlsHost, enabled = false) {
    this._enabled = enabled;
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
  gestureFor(slot: number): { readonly phase: GesturePhase; readonly aim: SpellAimResult | null } | null {
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
      } else if (this.joystick.pointerId === point.id) {
        this.joystick.moveTo(point.x, point.y);
      } else {
        this.beginPointer(point);
      }
    }

    for (const [id, gesture] of [...this.gestures]) {
      if (!seen.has(id)) this.endGesture(gesture);
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
      // landed yet, Varus Q starts charging at whatever the mouse last touched.
      gesture.aim = this.aimFor(gesture);
      this.host.setSlotAim(button.slot, gesture.aim ? gesture.aim.cursorWorld : null);
      this.host.beginSlot(button.slot);
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
      autoTarget: this.host.autoTargetWithin(view.range),
      pickUnitNear: (point, radius) => this.host.pickUnitNear(point, radius),
    });
  }

  // ----------------------------------------------------------------- drawing

  /** Screen space. Called after the fog, so the controls sit on top of it. */
  draw(): void {
    if (!this._enabled) return;

    this.drawAimTelegraph();
    this.drawJoystick();
    this.drawButtons();
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
      line(endX, endY, endX - aim.direction.x * back + nx * side, endY - aim.direction.y * back + ny * side);
      line(endX, endY, endX - aim.direction.x * back - nx * side, endY - aim.direction.y * back - ny * side);
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
      const dim = view.onCooldown || !view.affordable || !view.castable;
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
        fill(230, 230, 230, dim ? 120 : 230);
        textSize(button.radius * 0.8);
        text(view.label, button.x, button.y);
      }

      if (dim) {
        noStroke();
        fill(8, 12, 20, 130);
        circle(button.x, button.y, diameter);
      }

      // The cooldown wedge: a dark cap sweeping round what is left to run.
      if (view.cooldownRatio > 0) {
        noStroke();
        fill(6, 10, 18, 170);
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

      noFill();
      strokeWeight(button.primary ? 5 : 3);
      if (cancelling) stroke(235, 70, 70, 240);
      else if (view.charging) stroke(255, 208, 120, 240);
      else if (gesture) stroke(120, 220, 255, 240);
      else stroke(210, 210, 210, dim ? 90 : 160);
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
