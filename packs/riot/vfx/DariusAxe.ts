/**
 * Darius's axe, drawn once and shared by Q, W and E.
 *
 * Moved out of `src/game/vfx/` (Task 2 of the content-pack extraction): it
 * draws no `@/`-scoped core symbol at all — no imports, only the p5 globals
 * every draw call in this codebase reaches for ambiently — so the move is a
 * pure relocation. `Darius_Q.ts`, `Darius_W.ts` and `Darius_E.ts` (still core,
 * pending their own later move) reach it by a relative path now instead of
 * `@/game/vfx/DariusAxe`.
 *
 * Each of the three used to draw its own idea of the weapon: Q built the head
 * from two stacked `arc(..., PIE)` half-discs (a lollipop on a stick — a PIE
 * arc is a *disc*, and no amount of colour makes a disc read as a blade), W cut
 * a five-vertex blob, and E drew no weapon at all, just raking barbs. Three
 * different shapes for one weapon is why the kit did not look like Darius: the
 * silhouette is the recognition, and there wasn't one.
 *
 * So this is the silhouette, in one place. It is a Noxian executioner's axe and
 * the two things that make it his rather than a woodcutter's are both in
 * `HEAD`: the **spike** swept up off the top horn, and the **beard** — the
 * lower horn, which hangs further than the spike reaches and curls back into a
 * hook. The beard is also what E catches people with, so Apprehend pulls with
 * the same shape Decimate swings.
 *
 * Everything scales from `length` (grip to the far tip of the edge), so one
 * call draws the 174px weapon Q hauls overhead and the 52px one on his hip in
 * W. Nothing here calls `random()`: it is a fixed object, and an outline that
 * reshuffles every frame is the flicker the VFX standard bans.
 */

/**
 * The head, in fractions of `length`, as one shared table.
 *
 * Both the filled outline and the bright honed line are built from these exact
 * points. The first version of this file had them as two independent sets of
 * bezier controls and they drifted: the highlight floated off the blade,
 * because nothing forced the curve the eye reads as "edge" to be the curve the
 * silhouette actually has.
 */
const HEAD = {
  socketTop: [0.46, -0.06],
  /** The back dips in here before flaring out — an axe has a neck, a shield does not. */
  neckTop: [0.56, -0.1],
  /** Upper horn. Reached by straight segments, because a bezier rounds a corner
   * off and a rounded corner is exactly what made earlier versions read as a "D". */
  spike: [0.8, -0.46],
  edgeC1: [0.95, -0.3],
  edgeC2: [1.02, -0.06],
  /** Widest point of the cutting edge. */
  edgeMid: [0.99, 0.14],
  edgeC3: [0.96, 0.36],
  edgeC4: [0.84, 0.5],
  /** The beard: hangs past what the spike reaches up to. */
  beardTip: [0.68, 0.56],
  /** ...and hooks back toward the haft. This is the barb E catches people on. */
  beardHook: [0.5, 0.46],
  neckBot: [0.56, 0.14],
  socketBot: [0.46, 0.06],
} as const;

/** Roughly the centroid of the head; inner curves are lerped toward it. */
const HEAD_CENTRE = [0.66, 0.03] as const;

export interface AxeStyle {
  /** 0-255, multiplied into every layer so a whole axe can fade as one. */
  alpha?: number;
  /** 0-1. Adds a hot bloom outside the cutting edge — Q's swing, E's hook. */
  heat?: number;
  /** Blood running off the beard. W is always wet; Q only after it healed. */
  bloodied?: boolean;
}

/**
 * Draws the axe with the grip at the origin and the haft running along +X, so a
 * caller only has to `rotate()` to the angle the swing is at.
 *
 * Call inside a `push()`/`pop()`: this sets fill and stroke and deliberately
 * does not restore them, because at 60fps that restore is a canvas
 * save/restore pair the caller is normally already inside.
 */
export function drawDariusAxe(length: number, style: AxeStyle = {}): void {
  const a = style.alpha ?? 255;
  const heat = style.heat ?? 0;
  const L = length;

  // --- haft ----------------------------------------------------------------
  // Warm enough to read against the dark map. The first version used a near
  // black (46,33,26) and the haft simply vanished, which made the head look
  // like it was floating a body-length from the grip.
  strokeCap(SQUARE);
  stroke(74, 52, 36, a);
  strokeWeight(L * 0.07);
  line(-L * 0.15, 0, L * 0.62, 0);
  stroke(112, 78, 50, a);
  strokeWeight(L * 0.055);
  line(-L * 0.15, 0, L * 0.16, 0);

  // --- head ----------------------------------------------------------------
  noStroke();
  fill(48, 53, 63, a);
  headOutline(L);

  // The painted cheek: the head's own outline shrunk hard toward its centroid,
  // so it can only sit inside the blade and can only follow its shape. Drawn
  // before the metal below, and kept small — at inset 0.34 it covered almost
  // the whole head and the axe read as a red kite with a silver rim.
  fill(118, 24, 28, a * 0.8);
  headOutline(L, 0.52);

  noFill();
  stroke(23, 25, 31, a);
  strokeWeight(Math.max(1, L * 0.018));
  headOutline(L);

  // --- the edge ------------------------------------------------------------
  // Three passes along one curve: a hot bloom outside it, a wide bevel inside
  // it, and the honed line itself. The bevel is what stops the head reading as
  // a flat cut-out, and the bright line is the only white on the weapon — which
  // is what tells the eye which way it is swinging.
  noFill();
  if (heat > 0) {
    // Hugging the edge, not a band beside it: at L * 0.1 the bloom was wide
    // enough to detach from the blade and read as a second, separate arc.
    stroke(255, 150, 70, a * 0.42 * heat);
    strokeWeight(Math.max(2, L * 0.055));
    edgeCurve(L, 0.01);
  }
  stroke(126, 136, 152, a);
  strokeWeight(Math.max(1.5, L * 0.07));
  edgeCurve(L, 0.16);
  stroke(232, 239, 250, a);
  strokeWeight(Math.max(1.2, L * 0.028));
  edgeCurve(L, 0.035);

  // iron collar last, so it reads as clamping the head onto the haft
  stroke(132, 140, 154, a);
  strokeWeight(L * 0.085);
  line(L * 0.36, 0, L * 0.47, 0);
  noStroke();
  fill(150, 26, 30, a);
  circle(L * 0.415, 0, L * 0.05);

  if (!style.bloodied) return;
  // Off the beard, never off the spike: the beard is the low point.
  const [bx, by] = lerpToCentre(HEAD.beardTip, 0.05);
  stroke(178, 24, 26, a);
  strokeWeight(Math.max(1.5, L * 0.035));
  line(bx * L, by * L, bx * L, by * L + L * 0.16);
  noStroke();
  fill(178, 24, 26, a);
  circle(bx * L, by * L + L * 0.2, L * 0.06);
}

/** Moves a head point toward the centroid, so inner curves stay parallel-ish. */
function lerpToCentre(p: readonly [number, number] | readonly number[], inset: number) {
  return [p[0] + (HEAD_CENTRE[0] - p[0]) * inset, p[1] + (HEAD_CENTRE[1] - p[1]) * inset] as const;
}

function point2(p: readonly number[], L: number, inset: number): void {
  const q = lerpToCentre(p, inset);
  vertex(q[0] * L, q[1] * L);
}

function bezierPoint2(
  c1: readonly number[],
  c2: readonly number[],
  to: readonly number[],
  L: number,
  inset: number
): void {
  const a1 = lerpToCentre(c1, inset);
  const a2 = lerpToCentre(c2, inset);
  const t = lerpToCentre(to, inset);
  bezierVertex(a1[0] * L, a1[1] * L, a2[0] * L, a2[1] * L, t[0] * L, t[1] * L);
}

/** The whole head as one closed path, optionally shrunk toward the centroid. */
function headOutline(L: number, inset = 0): void {
  beginShape();
  point2(HEAD.socketTop, L, inset);
  point2(HEAD.neckTop, L, inset);
  point2(HEAD.spike, L, inset);
  bezierPoint2(HEAD.edgeC1, HEAD.edgeC2, HEAD.edgeMid, L, inset);
  bezierPoint2(HEAD.edgeC3, HEAD.edgeC4, HEAD.beardTip, L, inset);
  point2(HEAD.beardHook, L, inset);
  point2(HEAD.neckBot, L, inset);
  point2(HEAD.socketBot, L, inset);
  endShape(CLOSE);
}

/** Just the cutting edge, horn to beard, optionally inset into the head. */
function edgeCurve(L: number, inset: number): void {
  beginShape();
  point2(HEAD.spike, L, inset);
  bezierPoint2(HEAD.edgeC1, HEAD.edgeC2, HEAD.edgeMid, L, inset);
  bezierPoint2(HEAD.edgeC3, HEAD.edgeC4, HEAD.beardTip, L, inset);
  endShape();
}

/**
 * The arc the edge carves, as a trailing wedge behind `angle`.
 *
 * Shared by Q's sweep and E's hook so the two abilities cut with the same
 * stroke; `sweep` is how far back the trail reaches, in radians.
 */
export function drawAxeArc(
  radius: number,
  angle: number,
  sweep: number,
  alpha: number,
  width: number
): void {
  noFill();
  for (let i = 0; i < 3; i++) {
    const back = (i + 1) / 3;
    stroke(255, 120 + 60 * (1 - back), 70 + 40 * (1 - back), alpha * (1 - back * 0.72));
    strokeWeight(width * (1 - back * 0.55));
    arc(0, 0, radius * 2, radius * 2, angle - sweep * back, angle - sweep * back * 0.34);
  }
}
