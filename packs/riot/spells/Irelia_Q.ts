import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type {
  CastContext,
  CastSpec,
  ExecuteSpell,
  TargetingRequest,
} from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type IreliaMarkBuff = InstanceType<ReturnType<typeof makeIreliaMarkBuff>>;
type Irelia_Mark_Sigil = InstanceType<ReturnType<typeof makeIrelia_Mark_Sigil>>;
type Irelia_Q = InstanceType<ReturnType<typeof makeIrelia_Q>>;
type Irelia_Q_Blades = InstanceType<ReturnType<typeof makeIrelia_Q_Blades>>;
type Irelia_Q_Strike = InstanceType<ReturnType<typeof makeIrelia_Q_Strike>>;
type Irelia_Q_Surge = InstanceType<ReturnType<typeof makeIrelia_Q_Surge>>;



/**
 * Irelia's palette, declared once here and imported by the rest of the kit.
 *
 * Ionian steel over a dark rim: a pale blade body so it reads over grass, water
 * and stone alike, a teal edge glow that says *this part cuts*, and the rose
 * crest only on the pieces the player has to find (a planted blade, the wall).
 * Keeping all four abilities on one palette is what makes a fan of blades and a
 * pair of blades legible as the same champion's work.
 */
export const IRELIA_STEEL: [number, number, number] = [214, 240, 244];

export const IRELIA_EDGE: [number, number, number] = [52, 214, 206];

export const IRELIA_CREST: [number, number, number] = [238, 104, 152];

export const IRELIA_RIM: [number, number, number] = [14, 42, 52];


/**
 * One blade, drawn along the local +X axis and centred on the origin — the
 * caller owns `translate`/`rotate`.
 *
 * Shared rather than copied because every piece of this kit that is *a blade* —
 * the ones orbiting her, the one she throws, the one standing in the ground
 * waiting, the cluster of her ultimate and the wall it leaves behind — has to
 * read as the same object at five different sizes.
 *
 * It is a **silhouette**, not a stack of strokes. The first version was three
 * lines of different weights with a dot at one end, and at the sizes this kit
 * actually uses that is a dash with a bead on it: no point, no taper, nothing
 * that says which end cuts. A blade needs an outline to be a blade. So: a soft
 * halo underneath, a closed tapered body over a dark rim, a bright core down
 * the middle, and a guard — five layers, each of which the shape stops reading
 * without.
 */
export function drawIreliaBlade(length: number, alpha = 1): void {
  const half = length / 2;
  const wide = length * 0.115;

  // The halo. Underneath everything and wider than the body, so the blade sits
  // in its own light instead of being outlined by it.
  noFill();
  stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 55 * alpha);
  strokeWeight(wide * 3.4);
  line(-half * 0.4, 0, half * 0.75, 0);
  stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 80 * alpha);
  strokeWeight(wide * 2);
  line(-half * 0.4, 0, half * 0.8, 0);

  // The body: widest a third of the way forward, tapering to a real point.
  stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 235 * alpha);
  strokeWeight(Math.max(1.5, length * 0.045));
  fill(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250 * alpha);
  beginShape();
  vertex(half, 0);
  vertex(half * 0.12, -wide);
  vertex(-half * 0.5, -wide * 0.5);
  vertex(-half * 0.58, 0);
  vertex(-half * 0.5, wide * 0.5);
  vertex(half * 0.12, wide);
  endShape(CLOSE);

  // The core: the part that is actually glowing, and the only white in it.
  stroke(255, 255, 255, 225 * alpha);
  strokeWeight(Math.max(1, length * 0.04));
  line(-half * 0.4, 0, half * 0.78, 0);

  // Guard and grip. Small, but they are what makes the hilt end read as a hilt
  // rather than as the blunt end of a stick.
  stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 235 * alpha);
  strokeWeight(Math.max(2, length * 0.075));
  line(-half * 0.58, -wide * 1.1, -half * 0.58, wide * 1.1);
  strokeWeight(Math.max(1.5, length * 0.055));
  line(-half * 0.58, 0, -half * 0.92, 0);

  // The crest at the pommel: whose blade this is, at rest and in flight.
  noStroke();
  fill(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 245 * alpha);
  circle(-half * 0.92, 0, Math.max(3.5, length * 0.14));
}


export const IRELIA_MARK_MS = 4_000;


/**
 * The mark E and R leave on a body, and Q spends.
 *
 * A dedicated class rather than a generic buff, because Q asks "is this one
 * marked?" by type and takes it by hand rather than letting it expire.
 *
 * It lives in Q, which *spends* it, rather than in E, which applies it: E and R
 * already import this file for the palette, so the dependency runs one way and
 * the other direction would be an import cycle. Q is also the piece that cannot
 * work without knowing the type at all.
 *
 * **Under mix-and-match this is deliberately one-sided.** A kit that takes E
 * without Q leaves marks nobody spends, and a kit that takes Q without E never
 * sees one. That is the same bargain `JhinMarkBuff` already makes, and the
 * alternative — a champion-wide passive — has nowhere to live when a loadout is
 * five spells picked off different champions.
 */
function __buildIreliaMarkBuff(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class IreliaMarkBuff extends Buff {
    name = 'Dấu Kiếm';
    description = 'Bị Irelia đánh dấu: Đâm Kiếm được hoàn lại ngay khi chém trúng mục tiêu này.';
    stackId = 'irelia_mark';
  }
  return IreliaMarkBuff;
}
const __cacheIreliaMarkBuff = new WeakMap<ContentApi, ReturnType<typeof __buildIreliaMarkBuff>>();
export function makeIreliaMarkBuff(api: ContentApi) {
  const cached = __cacheIreliaMarkBuff.get(api);
  if (cached) return cached;
  const built = __buildIreliaMarkBuff(api);
  __cacheIreliaMarkBuff.set(api, built);
  return built;
}


function __buildfindIreliaMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const IreliaMarkBuff = makeIreliaMarkBuff(api);
  function findIreliaMark(unit: AttackableUnit): IreliaMarkBuff | null {
    for (const buff of unit.buffs) {
      if (buff instanceof IreliaMarkBuff && !buff.toRemove) return buff;
    }
    return null;
  }
  return findIreliaMark;
}
const __cachefindIreliaMark = new WeakMap<ContentApi, ReturnType<typeof __buildfindIreliaMark>>();
export function makeFindIreliaMark(api: ContentApi) {
  const cached = __cachefindIreliaMark.get(api);
  if (cached) return cached;
  const built = __buildfindIreliaMark(api);
  __cachefindIreliaMark.set(api, built);
  return built;
}


/** Returns whether there was a mark to take — Q's reset hangs off this boolean. */
function __buildconsumeIreliaMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const findIreliaMark = makeFindIreliaMark(api);
  function consumeIreliaMark(unit: AttackableUnit): boolean {
    const mark = findIreliaMark(unit);
    if (!mark) return false;
    mark.deactivateBuff();
    return true;
  }
  return consumeIreliaMark;
}
const __cacheconsumeIreliaMark = new WeakMap<ContentApi, ReturnType<typeof __buildconsumeIreliaMark>>();
export function makeConsumeIreliaMark(api: ContentApi) {
  const cached = __cacheconsumeIreliaMark.get(api);
  if (cached) return cached;
  const built = __buildconsumeIreliaMark(api);
  __cacheconsumeIreliaMark.set(api, built);
  return built;
}


/** Renews rather than stacks: a second blade re-arms the mark, it does not bank one. */
function __buildapplyIreliaMark(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const IreliaMarkBuff = makeIreliaMarkBuff(api);
  const findIreliaMark = makeFindIreliaMark(api);
  const Irelia_Mark_Sigil = makeIrelia_Mark_Sigil(api);
  function applyIreliaMark(source: AttackableUnit, target: AttackableUnit): void {
    const standing = findIreliaMark(target);
    if (standing) {
      standing.renewBuff();
      return;
    }
    const mark = new IreliaMarkBuff(IRELIA_MARK_MS, source, target);
    target.addBuff(mark);

    const sigil = new Irelia_Mark_Sigil(source, target);
    sigil.attachTo(target, mark);
    source.game.objectManager.addObject(sigil);
  }
  return applyIreliaMark;
}
const __cacheapplyIreliaMark = new WeakMap<ContentApi, ReturnType<typeof __buildapplyIreliaMark>>();
export function makeApplyIreliaMark(api: ContentApi) {
  const cached = __cacheapplyIreliaMark.get(api);
  if (cached) return cached;
  const built = __buildapplyIreliaMark(api);
  __cacheapplyIreliaMark.set(api, built);
  return built;
}


/** How high above the head the sigil rides, clear of the health bar. */
const MARK_FLOAT = 44;


/**
 * The mark, on the body wearing it.
 *
 * Deliberately the smallest thing in the kit. It has to be findable in a fight
 * — hence the dark rim, which is what holds a pale shape over grass, water and
 * stone — but it must never compete with the ability that put it there: it is
 * an *invitation to press Q*, not an effect. A rose diamond with her blade
 * hanging under it, and nothing else.
 *
 * A `SpellObject` rather than the buff's own `draw()`, because
 * `AttackableUnit.drawBuffs` skips every non-crowd-control buff once the camera
 * pulls out far enough to draw units compactly — which is exactly when a player
 * most needs to see who is worth surging onto.
 */
function __buildIrelia_Mark_Sigil(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Irelia_Mark_Sigil extends SpellObject {
    markTarget: AttackableUnit;
    age = 0;

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.markTarget = target;
      this.position = target.position.copy();
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.markTarget.position.x, this.markTarget.position.y);
    }

    draw(): void {
      // Arrives rather than pops, then breathes so it stays legible while still.
      const landed = constrain(this.age / 220, 0, 1);
      const settled = 1 - (1 - landed) * (1 - landed);
      const bob = sin(this.age / 260) * 3;
      const lift = MARK_FLOAT * settled + bob;
      const size = 11 * settled;

      push();
      translate(this.position.x, this.position.y - lift);

      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 225);
      strokeWeight(5);
      fill(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 240);
      quad(0, -size, size * 0.72, 0, 0, size, -size * 0.72, 0);

      // Her blade hanging beneath it: the sigil says whose mark this is.
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 215);
      strokeWeight(5);
      line(0, size + 2, 0, size + 13 * settled);
      stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 245);
      strokeWeight(2);
      line(0, size + 2, 0, size + 13 * settled);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((MARK_FLOAT + 34) * 2);
    }
  }
  return Irelia_Mark_Sigil;
}
const __cacheIrelia_Mark_Sigil = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_Mark_Sigil>>();
export function makeIrelia_Mark_Sigil(api: ContentApi) {
  const cached = __cacheIrelia_Mark_Sigil.get(api);
  if (cached) return cached;
  const built = __buildIrelia_Mark_Sigil(api);
  __cacheIrelia_Mark_Sigil.set(api, built);
  return built;
}


export const Q_RANGE = 320;

export const Q_DAMAGE = 22;

export const Q_DASH_SPEED = 17;

/** A ceiling, not a duration: the surge ends the frame it arrives. */
export const Q_DASH_MAX_MS = 900;

/** She finishes beside the body rather than standing inside it. */
export const Q_ARRIVAL_GAP = 36;

/** How many blades ride around her. Three reads as a dance; five reads as soup. */
export const Q_ORBIT_BLADES = 3;

/** Where they ride, measured out from the edge of her body. */
export const Q_ORBIT_GAP = 16;


/**
 * Bladesurge.
 *
 * The whole ability is the reset. A surge that kills its target hands the key
 * straight back, so Irelia's damage is not one number but however many bodies
 * are lined up for her — and the counterplay is not letting a low target be the
 * one she picks.
 *
 * The kill test is `takeDamage` being synchronous: latch `wasAlive` before,
 * read `isDead` after. Asking the target afterwards alone would credit a reset
 * to a corpse somebody else made.
 */
function __buildIrelia_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const canSee = api.combat.Vision.canSee;
  const effectiveHealth = api.combat.ExecuteTargeting.effectiveHealth;
  const isLethal = api.combat.ExecuteTargeting.isLethal;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const TargetResolver = api.combat.TargetResolver;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Spell = api.Spell;
  const findIreliaMark = makeFindIreliaMark(api);
  const consumeIreliaMark = makeConsumeIreliaMark(api);
  const Irelia_Q_Surge = makeIrelia_Q_Surge(api);
  const Irelia_Q_Strike = makeIrelia_Q_Strike(api);
  const Irelia_Q_Blades = makeIrelia_Q_Blades(api);
  class Irelia_Q extends Spell implements ExecuteSpell {
    image = api.asset('spell_irelia_q');
    name = 'Đâm Kiếm (Irelia_Q)';
    description = `Lướt tới một kẻ địch và chém <span class="damage">${Q_DAMAGE} sát thương</span>.
      Nếu cú chém <span class="buff">hạ gục</span> mục tiêu, hoặc mục tiêu đang
      <span class="buff">bị đánh dấu</span> (bởi Bước Nhảy Hoàn Vũ hay Thanh Kiếm Tiên Phong),
      Đâm Kiếm được hoàn lại ngay lập tức và dấu bị tiêu thụ.`;
    coolDown = 6_000;
    manaCost = 20;
    range = Q_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: Q_RANGE,
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => this.isValidTarget(candidate),
        getTargetInfo: candidate =>
          this.isValidTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    private isValidTarget(target?: unknown): target is AttackableUnit {
      return (
        target instanceof AttackableUnit &&
        !target.isDead &&
        !target.toRemove &&
        target !== this.owner &&
        target.teamId !== this.owner.teamId &&
        withinRange(Q_RANGE, this.owner, target)
      );
    }

    /** The orbit that rides on her for as long as this spell is in the kit. */
    private blades: Irelia_Q_Blades | null = null;

    /**
     * The blades belong to the spell, not to the champion.
     *
     * There is no passive slot to hang them off: a loadout is five spells picked
     * off any champions, so "Irelia's passive" has nowhere to live and a kit
     * without Q would carry art for an ability it does not have. Spawning them
     * from here means the orbit arrives and leaves with the spell that earns it.
     *
     * Rebuilt rather than kept: `dropIfAttachmentLost` latches on death and never
     * re-attaches, by design, so the check below is also what puts her blades
     * back after she respawns.
     */
    onUpdate(): void {
      if (this.owner.isDead || this.owner.toRemove) return;
      if (this.blades && !this.blades.toRemove) return;
      this.blades = new Irelia_Q_Blades(this, this.owner);
      this.game.objectManager.addObject(this.blades);
    }

    onRemoved(): void {
      super.onRemoved();
      if (this.blades) this.blades.toRemove = true;
      this.blades = null;
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
    }

    /**
     * Everyone the surge could take right now. One query, as the interface asks:
     * this runs every frame while Q is ready, because it also feeds the ring
     * `ExecuteMarks` paints on the enemies she can finish.
     */
    executeCandidates(): AttackableUnit[] {
      const found = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(Q_RANGE, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const candidates: AttackableUnit[] = [];
      for (const unit of found) if (this.isValidTarget(unit)) candidates.push(unit);
      return candidates;
    }

    executeDamageAgainst(_target: AttackableUnit): number {
      return Q_DAMAGE;
    }

    /**
     * The two picks this spell makes for itself, in one pass over one query.
     *
     *   a finisher   the surge kills it, so the key comes back and the corpse
     *                pays for it
     *   a marked one  the surge does not kill it, but the mark hands the key back
     *                just the same
     *
     * Both tiers are "this cast resets", which is the only reason either
     * overrules the cursor — Q's reach is 320 and flying past the enemy in front
     * of you is a real cost, so it has to buy something, and a reset is the one
     * thing that is worth it every time.
     *
     * Sorted by the lowest bar within each tier, which is `pickExecuteTarget`'s
     * own rule: a pick is a promise until the blow lands, and the candidate with
     * least left survives the fewest heals on the way there.
     *
     * `canSee` is applied here rather than left to the module because this walks
     * `executeCandidates` directly — `visibleCandidates` is `ExecuteTargeting`'s
     * own and not exported, and a pick made through a wall is the exact bug that
     * module exists for.
     *
     * No `executeFallback`, on purpose: that is what `pickExecuteTarget` uses
     * when nobody dies, and this spell never asks it that question. With no reset
     * in reach the cursor decides, through `TargetResolver`. Declaring a fallback
     * would state a rule that never runs.
     */
    private preferredTarget(): AttackableUnit | null {
      let finisher: AttackableUnit | null = null;
      let finisherLeft = Infinity;
      let marked: AttackableUnit | null = null;
      let markedLeft = Infinity;

      for (const candidate of this.executeCandidates()) {
        if (!canSee(this.owner, candidate)) continue;
        const left = effectiveHealth(candidate);

        // A marked candidate the surge also kills counts once, in the higher
        // tier: killing it resets anyway and leaves the mark unspent.
        if (isLethal(this.executeDamageAgainst(candidate), candidate)) {
          if (left < finisherLeft) {
            finisher = candidate;
            finisherLeft = left;
          }
          continue;
        }
        if (findIreliaMark(candidate) && left < markedLeft) {
          marked = candidate;
          markedLeft = left;
        }
      }
      return finisher ?? marked;
    }

    /**
     * Aim, in three steps, and the order is the ability.
     *
     *   an explicit target   the player named someone; nothing overrules that
     *   a finisher in reach  the surge that kills hands the key straight back
     *   a marked one         the mark hands it back too, without the kill
     *   the cursor           ordinary aim, through `TargetResolver`
     *
     * The middle two are the ability rather than a convenience, and neither is a
     * surprise to the player: `ExecuteMarks` has been drawing a ring on the
     * finisher for as long as Q has been ready, and `Irelia_Mark_Sigil` has been
     * riding the marked one since E or R put it there. Both picks are already on
     * screen before the key goes down.
     */
    press(context: CastContext): boolean {
      if (context.target !== undefined) {
        if (!this.isValidTarget(context.target)) return false;
        return super.press(context);
      }

      const preferred = this.preferredTarget();
      if (preferred) return super.press({ ...context, target: preferred });

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onSpellCast(context?: CastContext): void {
      const target = context?.target;
      if (!this.isValidTarget(target)) return;

      const launch = this.owner.position.copy();
      let struck = false;
      let interrupted = false;

      const surge = new Dash(Q_DASH_MAX_MS, this.owner, this.owner);
      surge.dashSpeed = Q_DASH_SPEED;
      surge.dashDestination = this.stopShortOf(target.position);
      surge.showTrail = false;

      surge.onDashUpdate = () => {
        if (target.isDead || target.toRemove) return;
        surge.dashDestination = this.stopShortOf(target.position);
      };

      // `Dash` fires this the frame `DASH_INTERRUPT_BUFFS` takes her off her feet,
      // immediately before deactivating — so it is the only place the ending below
      // can tell "someone stunned her out of it" from "she got there".
      surge.onCancelled = () => {
        interrupted = true;
      };

      // Arrival and expiry are the same ending, so the strike lives on the one
      // hook that runs exactly once whichever way the surge finished.
      //
      // The two endings that are *not* an arrival have to be named, because
      // `onDeactivate` fires for them too and the blow is worth 22 either way: a
      // stun mid-flight is the whole counterplay to a dash that damages on
      // landing, and `AttackableUnit.die` clears her buffs, which had a dead
      // Irelia cutting from the air.
      surge.onDeactivate = () => {
        if (struck) return;
        struck = true;
        if (interrupted || this.owner.isDead || this.owner.toRemove) return;
        this.strike(target);
      };

      this.owner.addBuff(surge);
      this.game.objectManager.addObject(new Irelia_Q_Surge(this.owner, launch, surge));
    }

    /** The blow at the end of the surge, and the reset it may buy. */
    private strike(target: AttackableUnit): void {
      if (target.toRemove) return;

      const wasAlive = !target.isDead;
      if (wasAlive) target.takeDamage(Q_DAMAGE, this.owner);
      const killed = wasAlive && target.isDead;
      // Taken, not merely read: a mark buys exactly one surge back, so a target
      // that survives cannot hand the key over twice.
      const marked = consumeIreliaMark(target);

      this.game.objectManager.addObject(
        new Irelia_Q_Strike(this.owner, target.position.copy(), killed || marked)
      );

      // Paid for by the corpse or by the mark, never by the hit alone. The kill
      // half is latched above rather than asked of the target afterwards, which
      // would credit a reset to a corpse somebody else made.
      if (killed || marked) this.currentCooldown = 0;
    }

    /** A blade's length short of the body, so she lands beside it rather than in it. */
    private stopShortOf(at: p5.Vector): p5.Vector {
      const dx = at.x - this.owner.position.x;
      const dy = at.y - this.owner.position.y;
      const span = Math.hypot(dx, dy);
      if (span <= Q_ARRIVAL_GAP) return createVector(this.owner.position.x, this.owner.position.y);
      const keep = (span - Q_ARRIVAL_GAP) / span;
      return createVector(this.owner.position.x + dx * keep, this.owner.position.y + dy * keep);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Irelia_Q;
}
const __cacheIrelia_Q = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_Q>>();
export default function makeIrelia_Q(api: ContentApi) {
  const cached = __cacheIrelia_Q.get(api);
  if (cached) return cached;
  const built = __buildIrelia_Q(api);
  __cacheIrelia_Q.set(api, built);
  return built;
}


/** How often the surge sheds a ghost, and how long one lasts. */
const GHOST_EVERY_MS = 38;

const GHOST_LIFE_MS = 240;


/**
 * DASH: what she turns into on the way.
 *
 * Three layers and no more, each saying something the others do not — the wake
 * says *how far she has come*, the ghosts say *how fast*, and the lens over her
 * body says *she is not a circle right now*. A fourth would start hiding the
 * three.
 *
 * The stretch is driven by the distance she actually covered last frame rather
 * than by a progress curve, so it is honest for free: full stretch at speed,
 * round again the instant `Dash` puts her down. A dash cut short by a stun
 * therefore stops looking fast on the frame it stops being fast.
 */
function __buildIrelia_Q_Surge(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const SpellObject = api.SpellObject;
  class Irelia_Q_Surge extends SpellObject {
    age = 0;
    private readonly launch: p5.Vector;
    private readonly pad = 60;
    private readonly ghosts: { x: number; y: number; age: number }[] = [];
    private sinceGhost = 0;
    private previous: p5.Vector;
    private speedRatio = 0;

    constructor(owner: AttackableUnit, launch: p5.Vector, surge: Dash) {
      super(owner);
      this.launch = launch;
      this.position = owner.position.copy();
      this.previous = owner.position.copy();
      this.attachTo(owner, surge);
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      const stepped = Math.hypot(
        this.position.x - this.previous.x,
        this.position.y - this.previous.y
      );
      this.speedRatio = constrain(stepped / Q_DASH_SPEED, 0, 1);
      this.previous.set(this.position.x, this.position.y);

      for (const ghost of this.ghosts) ghost.age += deltaTime;
      while (this.ghosts.length > 0 && this.ghosts[0].age >= GHOST_LIFE_MS) this.ghosts.shift();

      this.sinceGhost += deltaTime;
      if (this.sinceGhost >= GHOST_EVERY_MS) {
        this.sinceGhost = 0;
        this.ghosts.push({ x: this.position.x, y: this.position.y, age: 0 });
      }
    }

    draw(): void {
      const spanX = this.position.x - this.launch.x;
      const spanY = this.position.y - this.launch.y;
      const flown = Math.hypot(spanX, spanY);
      if (flown < 1) return;

      const heading = Math.atan2(spanY, spanX);
      const body = this.owner.animatedValues.displaySize;

      push();
      translate(this.launch.x, this.launch.y);
      rotate(heading);

      // The wake: where she came from, narrowing toward the tail so it states a
      // direction rather than reading as a rope tied between two points.
      noStroke();
      fill(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 70);
      quad(0, -2, flown, -13, flown, 13, 0, 2);
      pop();

      // The ghosts she shed, oldest and faintest first. Drawn in world space
      // because they are where she *was*, not where the wake is.
      for (const ghost of this.ghosts) {
        const left = 1 - constrain(ghost.age / GHOST_LIFE_MS, 0, 1);
        push();
        translate(ghost.x, ghost.y);
        noStroke();
        fill(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 115 * left);
        circle(0, 0, body * (0.55 + 0.35 * left));
        noFill();
        stroke(IRELIA_EDGE[0], IRELIA_EDGE[1], IRELIA_EDGE[2], 200 * left);
        strokeWeight(2.5);
        circle(0, 0, body * (0.55 + 0.35 * left));
        pop();
      }

      push();
      translate(this.position.x, this.position.y);
      rotate(heading);

      // The lens over her body: the squash-and-stretch, drawn in her own steel
      // rather than in a champion colour this object has no way of knowing.
      //
      // Long, flat and faint on purpose. At the density it started out it stopped
      // reading as speed and started reading as fog over her portrait — the
      // stretch has to happen *past* her silhouette, not on top of it.
      noStroke();
      fill(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 65 * this.speedRatio);
      ellipse(0, 0, body + 52 * this.speedRatio, body - 15 * this.speedRatio);

      // The blade riding at the head of it.
      stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 230);
      strokeWeight(5);
      line(-26, 0, 14, 0);
      stroke(IRELIA_STEEL[0], IRELIA_STEEL[1], IRELIA_STEEL[2], 250);
      strokeWeight(2.5);
      line(-26, 0, 14, 0);
      pop();
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.launch.x, this.position.x) - this.pad;
      const maxX = Math.max(this.launch.x, this.position.x) + this.pad;
      const minY = Math.min(this.launch.y, this.position.y) - this.pad;
      const maxY = Math.max(this.launch.y, this.position.y) + this.pad;
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return Irelia_Q_Surge;
}
const __cacheIrelia_Q_Surge = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_Q_Surge>>();
export function makeIrelia_Q_Surge(api: ContentApi) {
  const cached = __cacheIrelia_Q_Surge.get(api);
  if (cached) return cached;
  const built = __buildIrelia_Q_Surge(api);
  __cacheIrelia_Q_Surge.set(api, built);
  return built;
}


/**
 * The cut, drawn on the victim rather than near her.
 *
 * A reset gets its own colour: the rose crest flares only when the surge
 * actually finished someone, which is the moment the player needs to notice
 * because the key is already back.
 */
function __buildIrelia_Q_Strike(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Irelia_Q_Strike extends SpellObject {
    lifeTime = 340;
    age = 0;
    reset: boolean;
    radius = 46;

    constructor(owner: AttackableUnit, at: p5.Vector, reset: boolean) {
      super(owner);
      this.position = at;
      this.reset = reset;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const opened = 1 - (1 - t) * (1 - t);
      const accent = this.reset ? IRELIA_CREST : IRELIA_EDGE;

      push();
      translate(this.position.x, this.position.y);

      // Two crossed slashes: the shape of a cut, not a puff of light.
      for (let i = 0; i < 2; i++) {
        push();
        rotate(i === 0 ? -0.7 : 0.7);
        stroke(IRELIA_RIM[0], IRELIA_RIM[1], IRELIA_RIM[2], 210 * fade);
        strokeWeight(9 * fade + 3);
        line(-this.radius * opened, 0, this.radius * opened, 0);
        stroke(accent[0], accent[1], accent[2], 250 * fade);
        strokeWeight(5 * fade + 1.5);
        line(-this.radius * opened, 0, this.radius * opened, 0);
        stroke(255, 255, 255, 240 * fade);
        strokeWeight(2);
        line(-this.radius * opened * 0.7, 0, this.radius * opened * 0.7, 0);
        pop();
      }

      // A reset also throws a ring, so it is distinguishable at a glance from a
      // surge that merely hurt.
      if (this.reset) {
        noFill();
        stroke(IRELIA_CREST[0], IRELIA_CREST[1], IRELIA_CREST[2], 230 * fade);
        strokeWeight(4 * fade + 1);
        circle(0, 0, this.radius * 2.4 * opened);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius * 1.6 + 30) * 2);
    }
  }
  return Irelia_Q_Strike;
}
const __cacheIrelia_Q_Strike = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_Q_Strike>>();
export function makeIrelia_Q_Strike(api: ContentApi) {
  const cached = __cacheIrelia_Q_Strike.get(api);
  if (cached) return cached;
  const built = __buildIrelia_Q_Strike(api);
  __cacheIrelia_Q_Strike.set(api, built);
  return built;
}


/**
 * ORBIT: the blades that ride on her.
 *
 * The one piece of the kit that is on screen when nothing is happening, so it
 * is doing a job rather than decorating: **it says whether Q is live, and
 * whether there is a reset waiting.**
 *
 *   drifting, dim    the surge is on cooldown
 *   quick, bright    it is ready
 *   quick, rose      it is ready *and* something in reach is marked — press Q
 *                    on that one and the key comes straight back
 *
 * That is strictly more useful than a stack counter would have been, and it
 * needs no state of its own: all three readings are questions the spell can
 * already answer.
 *
 * The blades are kept in **world** coordinates and eased toward where they
 * ought to be rather than placed there. Nailed to her body they look welded on;
 * a frame behind, they swing out when she turns and stream after her when she
 * surges, which is the whole difference between a dance and a hood ornament.
 */
function __buildIrelia_Q_Blades(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const findIreliaMark = makeFindIreliaMark(api);
  class Irelia_Q_Blades extends SpellObject {
    age = 0;
    private readonly spell: Irelia_Q;
    private readonly blades: { x: number; y: number }[] = [];
    private spin = 0;
    /** Eased toward its target, never switched: a step change reads as a glitch. */
    private heat = 0;
    private prey = false;
    private sinceScan = 0;

    constructor(spell: Irelia_Q, owner: AttackableUnit) {
      super(owner);
      this.spell = spell;
      this.position = owner.position.copy();
      this.attachTo(owner);
      for (let i = 0; i < Q_ORBIT_BLADES; i++) {
        this.blades.push({ x: this.position.x, y: this.position.y });
      }
    }

    private get orbitRadius(): number {
      return this.owner.animatedValues.displaySize / 2 + Q_ORBIT_GAP;
    }

    /** Someone else's charge is the one thing that outranks the orbit on screen. */
    private get charging(): boolean {
      const spells = (this.owner as { spells?: { state?: string }[] }).spells;
      if (!spells) return false;
      for (const spell of spells) if (spell?.state === 'CHARGING') return true;
      return false;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      // Four times a second is far tighter than a player can act on, and it keeps
      // a permanent object off the quadtree on most frames.
      this.sinceScan += deltaTime;
      if (this.sinceScan >= 250) {
        this.sinceScan = 0;
        this.prey = this.markedPreyInReach();
      }

      const ready = this.spell.currentCooldown <= 0 && !this.owner.isDead;
      const wanted = this.charging ? 0.08 : ready ? (this.prey ? 1 : 0.7) : 0.2;
      this.heat += (wanted - this.heat) * 0.1;

      // Spec's orbit curve: 0.8 rad/s at rest, up to 2.4 with a reset waiting.
      this.spin += (0.8 + this.heat * 1.6) * (deltaTime / 1000);

      const radius = this.orbitRadius;
      for (let i = 0; i < this.blades.length; i++) {
        const around = this.spin + (i * TWO_PI) / this.blades.length;
        const blade = this.blades[i];
        blade.x += (this.position.x + cos(around) * radius - blade.x) * 0.22;
        blade.y += (this.position.y + sin(around) * radius - blade.y) * 0.22;
      }
    }

    /**
     * `visibleTo` is not optional here even though nothing is being targeted: the
     * blades turning rose is a *tell*, and without the filter it would announce a
     * marked enemy standing in an unlit bush.
     */
    private markedPreyInReach(): boolean {
      const found = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: effectiveRange(Q_RANGE, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      for (const unit of found) {
        if (unit === this.owner || unit.isDead || unit.toRemove) continue;
        if (findIreliaMark(unit)) return true;
      }
      return false;
    }

    draw(): void {
      if (this.owner.isDead) return;
      const accent = this.prey ? IRELIA_CREST : IRELIA_EDGE;
      const lit = 0.45 + 0.55 * this.heat;

      push();
      for (let i = 0; i < this.blades.length; i++) {
        const blade = this.blades[i];
        const facing = Math.atan2(blade.y - this.position.y, blade.x - this.position.x);

        // The glow rides under the blade and only once it is worth reading, so a
        // cooling orbit is three small blades rather than three small blades with
        // three halos nobody asked for.
        if (this.heat > 0.5) {
          noStroke();
          fill(accent[0], accent[1], accent[2], 90 * (this.heat - 0.5) * 2);
          circle(blade.x, blade.y, 20);
        }

        push();
        translate(blade.x, blade.y);
        rotate(facing + HALF_PI);
        drawIreliaBlade(22, lit);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.orbitRadius + 30) * 2);
    }
  }
  return Irelia_Q_Blades;
}
const __cacheIrelia_Q_Blades = new WeakMap<ContentApi, ReturnType<typeof __buildIrelia_Q_Blades>>();
export function makeIrelia_Q_Blades(api: ContentApi) {
  const cached = __cacheIrelia_Q_Blades.get(api);
  if (cached) return cached;
  const built = __buildIrelia_Q_Blades(api);
  __cacheIrelia_Q_Blades.set(api, built);
  return built;
}