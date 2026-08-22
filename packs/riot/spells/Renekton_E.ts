import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { isEnraged } from './Renekton_R';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Renekton_E = InstanceType<ReturnType<typeof makeRenekton_E>>;
type Renekton_E_Object = InstanceType<ReturnType<typeof makeRenekton_E_Object>>;



export const DASH_DISTANCE = 250;

export const DASH_SPEED = 18;

export const DAMAGE = 24;

/** Reign of Anger only pays out on Dice, the recast — the reward for landing Slice. */
export const ENRAGED_BONUS_DAMAGE = 12;

/** How wide a body has to be to the line to be caught by the pass. */
export const HIT_RADIUS = 72;

/** How long he has to press E again after a pass that connected. */
export const RECAST_WINDOW_MS = 4_000;

export const SHRED_PERCENT = 0.25;

export const SHRED_MS = 4_000;

export const SHRED_STACK_ID = 'renekton_e_shred';


/**
 * Slice and Dice: one dash, and a second one only if the first hit something.
 *
 * The recast window is the whole ability, so it is modelled as the runtime's
 * `ACTIVE` state rather than as a timer the spell keeps for itself: the HUD, the
 * interrupt rules and the cooldown then all agree about when E is "half cast".
 * The form is `INDEPENDENT` because the dash *is* the effect and it already has
 * its momentum — being stunned mid-flight is the `Dash` buff's business (it
 * carries its own interrupt list), not a reason to delete the recast.
 *
 * A pass that hit nothing closes the window immediately, so the player is never
 * left holding a key that does nothing.
 */
function __buildRenekton_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const StatAmp = api.buffs.StatAmp;
  const Renekton_E_Object = makeRenekton_E_Object(api);
  class Renekton_E extends Spell {
    image = api.asset('spell_renekton_e');
    name = 'Cắt và Xắt (Renekton_E)';
    description =
      `Lướt <span>${DASH_DISTANCE}px</span> theo hướng chỉ định, gây` +
      ` <span class="damage">${DAMAGE} sát thương</span> cho mọi kẻ địch trên đường (mỗi mục tiêu chỉ trúng một lần).` +
      ` Nếu trúng ít nhất một kẻ địch, có thể <span class="buff">lướt lần hai</span> trong` +
      ` <span class="time">${RECAST_WINDOW_MS / 1000} giây</span>.` +
      ` <span class="buff">Cuồng Nộ</span>: lần lướt thứ hai gây thêm` +
      ` <span class="damage">${ENRAGED_BONUS_DAMAGE} sát thương</span> và` +
      ` <span class="damage">giảm ${SHRED_PERCENT * 100}% Sát thương</span> của mục tiêu` +
      ` trong <span class="time">${SHRED_MS / 1000} giây</span>`;
    coolDown = 9_000;
    manaCost = 30;

    range = DASH_DISTANCE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'RECAST',
        targeting: 'DIRECTION',
        active: { maxDurationMs: RECAST_WINDOW_MS },
        resource: { commitAt: 'start', refundOn: [] },
        // Starts on the first cast, not when the recast window closes: holding
        // Dice must not also hold the cooldown.
        cooldown: { startAt: 'release', durationMs: this.coolDown },
        interrupts: SpellForm.INDEPENDENT,
      };
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner);
    }

    onActivate(context: CastContext): void {
      this.pass(context, false);
    }

    onRecast(context: CastContext): void {
      // Aimed by the second press, not the first — otherwise Dice goes back along
      // the direction Slice was aimed. This used to reach past the argument to
      // `this.castContext` because the runtime handed every recast the context it
      // had snapshotted at activation; `SpellRuntime.recast` replaces that with
      // the press that triggered it now, so the argument is already the right
      // one. Renekton was the only recast in the game that aimed correctly, by
      // carrying that workaround.
      this.pass(context, true);
    }

    /** One dash through everything in front of him. */
    private pass(context: CastContext, isDice: boolean): void {
      const aim = this.firingDirection(context);
      const destination = createVector(
        this.owner.position.x + aim.x * DASH_DISTANCE,
        this.owner.position.y + aim.y * DASH_DISTANCE
      );

      const enraged = isEnraged(this.owner);
      const damage = DAMAGE + (isDice && enraged ? ENRAGED_BONUS_DAMAGE : 0);
      // Multi-hit protection: one pass touches each body once, however many
      // frames it spends overlapping it.
      const hitTargets = new Set<AttackableUnit>();

      const gash = new Renekton_E_Object(this.owner);
      gash.origin = this.owner.position.copy();
      gash.enraged = isDice && enraged;
      this.game.objectManager.addObject(gash);

      const dash = new Dash(1_500, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = destination;
      dash.dashSpeed = DASH_SPEED;
      dash.showTrail = true;

      // `onDashUpdate`, never `onUpdate`: `Dash` implements the step itself on
      // its prototype, so an instance assignment would delete the dash and leave
      // him cutting the air where he stands.
      dash.onDashUpdate = () => {
        const swept = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.owner.position.x,
            y: this.owner.position.y,
            r: HIT_RADIUS,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        }) as AttackableUnit[];

        for (const victim of swept) {
          if (hitTargets.has(victim)) continue;
          hitTargets.add(victim);
          victim.takeDamage(damage, this.owner);
          gash.struck.push(victim.position.copy());
          if (isDice && enraged) this.shred(victim);
        }
      };

      // Both ends of the pass are wired before `addBuff`, because a grounded
      // Renekton has his dash deactivated inside that very call — and the latch
      // is here because arriving fires both of them.
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        gash.finish();
        // Dice is the last pass; the runtime closed the window when it recast.
        if (isDice) return;
        // Slice hit nothing, so there is no Dice to hold the window open for and
        // the player should not be left holding a key that does nothing.
        if (hitTargets.size === 0) this.cancel('EFFECT_ENDED');
      };
      dash.onReachedDestination = finish;
      dash.addDeactivateListener(finish);

      this.owner.addBuff(dash);
    }

    /** Enraged Dice leaves them hitting softer for a while. */
    private shred(victim: AttackableUnit): void {
      const shred = new StatAmp(SHRED_MS, this.owner, victim);
      shred.stackId = SHRED_STACK_ID;
      shred.image = this.image;
      shred.name = 'Rách Giáp';
      shred.bonuses = { attackDamage: { percentBaseBonus: -SHRED_PERCENT } };
      victim.addBuff(shred);
    }

    drawPreview() {
      super.drawPreview(DASH_DISTANCE);
    }
  }
  return Renekton_E;
}
const __cacheRenekton_E = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_E>>();
export default function makeRenekton_E(api: ContentApi) {
  const cached = __cacheRenekton_E.get(api);
  if (cached) return cached;
  const built = __buildRenekton_E(api);
  __cacheRenekton_E.set(api, built);
  return built;
}


export const GASH_LIFETIME_MS = 620;


/**
 * The furrow the pass tears in the ground, from where he started to where he is.
 *
 * Ground art (`zIndex = GROUND_Z_INDEX`), so it lies under the feet crossing it, and a
 * `SpellObject` rather than caster VFX because it stretches most of a screen
 * away from his body — drawn off `Champion.draw` it would blink out whenever the
 * camera lost him and the damage would land invisibly.
 */
function __buildRenekton_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Renekton_E_Object extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    origin: p5.Vector = this.owner.position.copy();
    /** Where along the furrow a body was caught; each gets a splash. */
    struck: p5.Vector[] = [];
    enraged = false;
    /** Follows him until the pass ends, then fades from wherever it stopped. */
    travelling = true;
    head: p5.Vector = this.owner.position.copy();
    age = 0;
    fadeAge = 0;

    finish(): void {
      this.travelling = false;
    }

    update(): void {
      this.age += deltaTime;
      if (this.travelling) {
        this.head.set(this.owner.position.x, this.owner.position.y);
        // A pass that somehow never ends must not leave a furrow on the map.
        if (this.age > 3_000) this.travelling = false;
        return;
      }
      this.fadeAge += deltaTime;
      if (this.fadeAge >= GASH_LIFETIME_MS) this.toRemove = true;
    }

    draw(): void {
      const fade = this.travelling ? 1 : 1 - constrain(this.fadeAge / GASH_LIFETIME_MS, 0, 1);
      const [r, g, b] = this.enraged ? [255, 130, 60] : [190, 60, 50];
      const dx = this.head.x - this.origin.x;
      const dy = this.head.y - this.origin.y;

      push();
      translate(this.origin.x, this.origin.y);

      // three parallel claw furrows rather than one line: the blade drags, it
      // does not cut cleanly, and three grooves are unmistakably his
      const length = Math.hypot(dx, dy);
      if (length > 1) {
        const nx = -dy / length;
        const ny = dx / length;
        for (let i = -1; i <= 1; i++) {
          const spread = i * 13;
          // narrower at the start, widest at the head — the drag opens up
          stroke(r, g, b, (90 + 90 * Math.abs(1 - Math.abs(i))) * fade);
          strokeWeight(7 - Math.abs(i) * 2);
          line(nx * spread * 0.35, ny * spread * 0.35, dx + nx * spread, dy + ny * spread);
        }

        // a bright leading edge right at the head of the furrow
        stroke(255, 235, 220, 220 * fade);
        strokeWeight(4);
        line(dx - (dx / length) * 26, dy - (dy / length) * 26, dx, dy);
      }
      pop();

      // a splash wherever a body was caught, so the hits are readable afterwards
      noStroke();
      for (const spot of this.struck) {
        fill(r, g, b, 150 * fade);
        circle(spot.x, spot.y, 34);
        fill(255, 230, 215, 190 * fade);
        circle(spot.x, spot.y, 14);
      }
    }

    getDisplayBoundingBox() {
      const margin = 60;
      const minX = Math.min(this.origin.x, this.head.x) - margin;
      const minY = Math.min(this.origin.y, this.head.y) - margin;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.head.x - this.origin.x) + margin * 2,
        h: Math.abs(this.head.y - this.origin.y) + margin * 2,
        data: this,
      });
    }
  }
  return Renekton_E_Object;
}
const __cacheRenekton_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_E_Object>>();
export function makeRenekton_E_Object(api: ContentApi) {
  const cached = __cacheRenekton_E_Object.get(api);
  if (cached) return cached;
  const built = __buildRenekton_E_Object(api);
  __cacheRenekton_E_Object.set(api, built);
  return built;
}