/**
 * Where the on-screen controls sit, for a given viewport.
 *
 * Pure geometry — no p5, no game. It is the one place that knows a thumb is
 * about 45 CSS pixels wide and that a phone is held in landscape, so both the
 * hit testing and the drawing read the same numbers and can never disagree
 * about where a button is.
 *
 * The shape is Wild Rift's: the stick under the left thumb, the attack button
 * in the bottom-right corner with the abilities arced up and to its left, and
 * the middle of the screen left empty so neither thumb covers the fight.
 */

import { clamp } from '@/utils/math.utils';

export interface TouchViewport {
  readonly width: number;
  readonly height: number;
}

export interface TouchCircle {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface TouchButton extends TouchCircle {
  readonly slot: number;
  /** Slot 0. Drawn larger and labelled differently — it is the attack button. */
  readonly primary: boolean;
}

export interface TouchLayout {
  /** Anywhere in here, a finger landing grabs the stick. */
  readonly joystickZone: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  /** Where the ring rests when nobody is touching it. */
  readonly joystickHome: TouchCircle;
  readonly knobRadius: number;
  readonly buttons: readonly TouchButton[];
  /**
   * Hồi Thành, top-right and deliberately far from everything else. Its own
   * field rather than an eighth entry in `buttons`: that array is indexed by
   * kit slot and drives `SpellInputController`, which has never heard of a
   * spell outside `spells[]`. See `RECALL_SLOT`.
   */
  readonly recall: TouchButton;
  /** Screen pixels of drag that map to a spell's full range. */
  readonly dragToRange: number;
  /** Below this much movement a gesture is a tap, not an aim. */
  readonly tapSlop: number;
  /** Multiple of a button's radius inside which a returning thumb means cancel. */
  readonly cancelRadiusScale: number;
}

/**
 * A gesture that never travels this far is a tap. 18 CSS pixels is wider than
 * the jitter a thumb produces holding still on glass and far narrower than a
 * deliberate flick, which on a 400px-tall landscape phone has 150+ pixels of
 * room to work in.
 */
export const TAP_SLOP = 18;

/**
 * Returning inside 1.35 button radii, after having aimed, is the abort. It has
 * to be wider than the button so the gesture is reachable without hitting the
 * exact centre, and narrower than the gap to the next button so cancelling one
 * spell can never read as aiming another.
 */
export const CANCEL_RADIUS_SCALE = 1.35;

/** Screen coordinates: x right, y *down*, so a 270 degree offset points up. */
const onArc = (
  centreX: number,
  centreY: number,
  radius: number,
  degrees: number
): { x: number; y: number } => {
  const radians = (degrees * Math.PI) / 180;
  return { x: centreX + Math.cos(radians) * radius, y: centreY + Math.sin(radians) * radius };
};

/**
 * Abilities sweep from level with the attack button round to just past
 * vertical, which is the arc a right thumb travels without the hand leaving
 * the phone. Summoners take a second ring outside it.
 */
const ABILITY_ARC_START = 160;
const ABILITY_ARC_END = 290;
const SUMMONER_ARC = [184, 266];

/**
 * Clear space between neighbouring buttons, as a fraction of an ability's
 * radius. It is what the arc's radius is *solved for* below rather than a
 * number chosen alongside it: pick the radius by eye and four buttons over a
 * hundred degrees overlap each other by 25 pixels, which is both ugly and
 * ambiguous to hit-test. 0.42 is about 13 pixels on a landscape phone — a
 * visible gap between two circles a thumb is 45 pixels wide.
 */
const BUTTON_GAP_SCALE = 0.42;

/**
 * The recall button's slot number.
 *
 * Negative because it is not a slot: `Recall` lives on `Champion.recall` and
 * never enters `spells[]` (see the class comment there), so there is no index
 * to press and nothing downstream may treat this as one. It exists only so a
 * `TouchButton` can carry an identity at all.
 */
export const RECALL_SLOT = -1;

/**
 * Room kept clear at the top-right for `InGameHUD.vue`'s practice-panel
 * button: a DOM control at `top: 6px; right: 6px`, 46px square under
 * `body.touch-ui`. It is drawn by the browser over the canvas, so nothing here
 * can see it — this number is how the two stay out of each other's way.
 */
const CORNER_BUTTON_BOX = 52;

export function computeTouchLayout(viewport: TouchViewport, slotCount: number): TouchLayout {
  const unit = Math.min(viewport.width, viewport.height);
  const margin = clamp(unit * 0.05, 14, 34);

  const attackRadius = clamp(unit * 0.105, 34, 58);
  const abilityRadius = attackRadius * 0.76;
  const summonerRadius = attackRadius * 0.56;
  const joystickRadius = clamp(unit * 0.17, 54, 92);

  const attackX = viewport.width - margin - attackRadius - abilityRadius * 0.35;
  // Lift the whole fan enough that the bottom ability is not clamped into its
  // neighbour on short landscape phones.
  const attackY = viewport.height - margin - attackRadius - abilityRadius * 0.35;

  const abilityCount = Math.max(0, Math.min(4, slotCount - 1));
  // The arc's radius is derived from how many buttons have to fit on it, not
  // chosen and then hoped over: the chord between two neighbours is
  // 2 * R * sin(step / 2), and it has to clear a whole button plus a gap.
  const stepDegrees =
    abilityCount > 1 ? (ABILITY_ARC_END - ABILITY_ARC_START) / (abilityCount - 1) : 0;
  const chordRing =
    abilityCount > 1
      ? (abilityRadius * (2 + BUTTON_GAP_SCALE)) /
        (2 * Math.sin(((stepDegrees / 2) * Math.PI) / 180))
      : 0;
  const abilityRing = Math.max(attackRadius + abilityRadius + attackRadius * 0.35, chordRing);
  // Radial clearance, which is the worst case: a summoner sitting between two
  // abilities is further from both than this.
  const summonerRing = abilityRing + abilityRadius + summonerRadius + attackRadius * 0.3;

  const buttons: TouchButton[] = [];
  const push = (slot: number, x: number, y: number, radius: number, primary: boolean): void => {
    buttons.push({
      slot,
      // A ring pushed off the edge is unreachable, so every centre is pulled
      // back inside the viewport before anyone draws or hit-tests it.
      x: clamp(x, radius + 2, viewport.width - radius - 2),
      y: clamp(y, radius + 2, viewport.height - radius - 2),
      radius,
      primary,
    });
  };

  if (slotCount > 0) push(0, attackX, attackY, attackRadius, true);

  for (let i = 0; i < abilityCount; i++) {
    const degrees = ABILITY_ARC_START + i * stepDegrees;
    const point = onArc(attackX, attackY, abilityRing, degrees);
    push(i + 1, point.x, point.y, abilityRadius, false);
  }

  for (let i = 0; i + 5 < slotCount && i < SUMMONER_ARC.length; i++) {
    const point = onArc(attackX, attackY, summonerRing, SUMMONER_ARC[i]);
    push(i + 5, point.x, point.y, summonerRadius, false);
  }

  /**
   * Hồi Thành sits on the top edge, one gap left of the practice-panel corner
   * button — the only part of the screen no thumb visits during a fight. The
   * stick's band stops well short of it, the ability fan reaches nowhere near
   * it, and the expanded minimap (which `Game.syncTouches` gives first refusal
   * on every new finger) is centred, so it never covers this corner either.
   *
   * Reaching it means moving a hand off the controls, which is the point: a
   * recall pressed in the middle of a teamfight is a death.
   */
  const recallRadius = clamp(unit * 0.062, 22, 30);
  const recall: TouchButton = {
    slot: RECALL_SLOT,
    x: clamp(
      viewport.width - CORNER_BUTTON_BOX - margin - recallRadius,
      recallRadius + 2,
      viewport.width - recallRadius - 2
    ),
    y: clamp(margin + recallRadius, recallRadius + 2, viewport.height - recallRadius - 2),
    radius: recallRadius,
    primary: false,
  };

  return {
    // The stick floats: it re-centres wherever the left thumb lands inside this
    // band, which is what makes it usable without looking. The band stops short
    // of the right half so it can never swallow a spell gesture, and short of
    // the top so it does not eat taps on the HUD strip.
    joystickZone: {
      x: 0,
      y: viewport.height * 0.22,
      w: viewport.width * 0.45,
      h: viewport.height * 0.78,
    },
    joystickHome: {
      x: margin + joystickRadius,
      y: viewport.height - margin - joystickRadius,
      radius: joystickRadius,
    },
    knobRadius: joystickRadius * 0.44,
    buttons,
    recall,
    // Full range at 70% of the joystick's reach: a right thumb has less room
    // than a left one, because it starts in a corner.
    dragToRange: joystickRadius * 0.7,
    tapSlop: TAP_SLOP,
    cancelRadiusScale: CANCEL_RADIUS_SCALE,
  };
}

/** The button under a screen point, or null. Nearest centre wins on overlap. */
export function buttonAt(layout: TouchLayout, x: number, y: number): TouchButton | null {
  let best: TouchButton | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const button of layout.buttons) {
    const distance = Math.hypot(x - button.x, y - button.y);
    // A little slack round every button: fingers are round and imprecise, and
    // the arc leaves enough room between centres that this cannot make two
    // buttons ambiguous.
    if (distance > button.radius * 1.15 || distance >= bestDistance) continue;
    bestDistance = distance;
    best = button;
  }
  return best;
}

/**
 * Is a finger on the recall button?
 *
 * Exactly the drawn circle, with none of the 1.15-radius slack `buttonAt`
 * gives every other button. Forgiveness is right for an ability — the cost of
 * a mis-hit is the wrong spell — and wrong here, where the cost is walking out
 * of a fight.
 */
export function hitRecall(layout: TouchLayout, x: number, y: number): boolean {
  const button = layout.recall;
  return Math.hypot(x - button.x, y - button.y) <= button.radius;
}

export function insideJoystickZone(layout: TouchLayout, x: number, y: number): boolean {
  const zone = layout.joystickZone;
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}
