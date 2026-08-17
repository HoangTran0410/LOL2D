/**
 * The left thumb's stick.
 *
 * Pure maths over screen coordinates — it knows nothing about the game, so the
 * dead zone and the clamping are unit-testable without a canvas.
 *
 * It floats: the base re-centres on wherever the thumb lands inside the stick's
 * band rather than sitting at a fixed spot. On a phone you put your thumb down
 * without looking, and a fixed base turns every re-grip into a stumble in a
 * random direction.
 */

export interface JoystickVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Fraction of the ring inside which the stick reads as centred.
 *
 * 0.18 is about 12 pixels on a 68px ring. Below that a resting thumb's own
 * tremor would walk the champion; much above it and the first quarter of the
 * throw does nothing, which reads as lag.
 */
export const JOYSTICK_DEAD_ZONE = 0.18;

const ZERO: JoystickVector = { x: 0, y: 0 };

export class VirtualJoystick {
  private _pointerId: number | null = null;
  private _baseX = 0;
  private _baseY = 0;
  private _x = 0;
  private _y = 0;
  private _radius = 1;

  constructor(private readonly deadZone: number = JOYSTICK_DEAD_ZONE) {}

  get active(): boolean {
    return this._pointerId !== null;
  }

  get pointerId(): number | null {
    return this._pointerId;
  }

  get base(): JoystickVector {
    return { x: this._baseX, y: this._baseY };
  }

  get radius(): number {
    return this._radius;
  }

  /** The knob, clamped to the ring — where it is drawn. */
  get knob(): JoystickVector {
    const dx = this._x - this._baseX;
    const dy = this._y - this._baseY;
    const length = Math.hypot(dx, dy);
    if (length <= this._radius || length === 0) return { x: this._x, y: this._y };
    const scale = this._radius / length;
    return { x: this._baseX + dx * scale, y: this._baseY + dy * scale };
  }

  /**
   * How far out of the dead zone the thumb is, 0 to 1, remapped so the throw
   * starts at 0 the moment it leaves the dead zone rather than jumping to 0.18.
   */
  get magnitude(): number {
    if (this._pointerId === null) return 0;
    const raw = Math.min(
      1,
      Math.hypot(this._x - this._baseX, this._y - this._baseY) / this._radius
    );
    if (raw <= this.deadZone) return 0;
    return (raw - this.deadZone) / (1 - this.deadZone);
  }

  /** Unit direction, or (0,0) while inside the dead zone. */
  get vector(): JoystickVector {
    if (this.magnitude === 0) return ZERO;
    const dx = this._x - this._baseX;
    const dy = this._y - this._baseY;
    const length = Math.hypot(dx, dy);
    if (length === 0) return ZERO;
    return { x: dx / length, y: dy / length };
  }

  /**
   * Grab the stick. `home` is where the ring sits at rest and only supplies the
   * radius; the base itself lands under the thumb, clamped so the whole ring
   * stays on screen.
   */
  begin(
    pointerId: number,
    x: number,
    y: number,
    radius: number,
    viewport: { readonly width: number; readonly height: number }
  ): void {
    this._pointerId = pointerId;
    this._radius = Math.max(1, radius);
    this._baseX = Math.min(
      Math.max(x, this._radius),
      Math.max(this._radius, viewport.width - this._radius)
    );
    this._baseY = Math.min(
      Math.max(y, this._radius),
      Math.max(this._radius, viewport.height - this._radius)
    );
    this._x = x;
    this._y = y;
  }

  moveTo(x: number, y: number): void {
    if (this._pointerId === null) return;
    this._x = x;
    this._y = y;
  }

  end(): void {
    this._pointerId = null;
    this._x = this._baseX;
    this._y = this._baseY;
  }
}

export default VirtualJoystick;
