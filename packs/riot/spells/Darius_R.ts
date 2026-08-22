import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ExecuteFallback, ExecuteSpell } from '@moba2d/core/content/types';
import { HEMORRHAGE_MAX_STACKS, hemorrhageStacks } from './Darius_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Fear = InstanceType<ContentApi['buffs']['Fear']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Darius_R = InstanceType<ReturnType<typeof makeDarius_R>>;
type Darius_R_Object = InstanceType<ReturnType<typeof makeDarius_R_Object>>;



export const RANGE = 200;

export const BASE_DAMAGE = 35;

/** What each stack of Hemorrhage on the victim is worth to the blade. */
export const DAMAGE_PER_STACK = 5;

/** 35 + 5 × 5 = 60, the top of the ultimate band. */
export const MAX_DAMAGE = BASE_DAMAGE + DAMAGE_PER_STACK * HEMORRHAGE_MAX_STACKS;

export const LEAP_SPEED = 26;

/** He has to actually arrive; a leap stopped short is a reposition. */
export const STRIKE_RADIUS = 120;

export const FEAR_RADIUS = 320;

export const FEAR_MS = 2_500;


/**
 * Noxian Guillotine: the kill button, and it says so before you press it.
 *
 * Darius picks his own target through `combat/ExecuteTargeting`, which means
 * two things come free and cannot drift apart: the cast takes whoever actually
 * dies to it rather than whoever is nearest, and `ExecuteMarks` paints the ring
 * on that same body a frame before the key is pressed. `executeDamageAgainst`
 * is therefore the real formula, bleed stacks and all — an estimate here is a
 * promise the cast would not keep.
 */
function __buildDarius_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Champion = api.units.Champion;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Fear = api.buffs.Fear;
  const Darius_R_Object = makeDarius_R_Object(api);
  class Darius_R extends Spell implements ExecuteSpell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_darius_r');
    name = 'Máy Chém Noxus (Darius_R)';
    description =
      `Nhảy tới kẻ địch trong <span>${RANGE}px</span> — <span class="buff">ưu tiên kẻ sẽ chết vì nhát này</span> —` +
      ` và bổ rìu xuống: <span class="damage">${BASE_DAMAGE} sát thương</span>,` +
      ` cộng thêm <span class="damage">${DAMAGE_PER_STACK}</span> cho mỗi cấp <span class="damage">Chảy Máu</span>` +
      ` (tối đa <span class="damage">${MAX_DAMAGE}</span>).` +
      ` Nếu chém chết mục tiêu, chiêu cuối <span class="buff">hồi ngay lập tức</span>` +
      ` và lính quanh đó <span class="buff">Khiếp Sợ</span> trong <span class="time">${FEAR_MS / 1000} giây</span>`;
    coolDown = 10_000;
    manaCost = 60;

    range = RANGE;

    /** Nothing killable in range still means "jump on the healthiest-looking one"
     *  is wrong; the lowest bar is the one worth committing an ultimate to. */
    readonly executeFallback: ExecuteFallback = 'weakest';

    checkCastCondition(): boolean {
      return !!pickExecuteTarget(this) && Dash.CanDash(this.owner);
    }

    executeCandidates(): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
    }

    executeDamageAgainst(target: AttackableUnit): number {
      return BASE_DAMAGE + DAMAGE_PER_STACK * hemorrhageStacks(target);
    }

    onSpellCast(): void {
      const target = pickExecuteTarget(this);
      if (!target) return;

      // Stops just short of the body; the collision system would shove him back
      // out of it anyway, and the axe needs somewhere to fall.
      const restingPoint = () =>
        target.position
          .copy()
          .sub(this.owner.position)
          .setMag(Math.max(0, this.owner.position.dist(target.position) - 45))
          .add(this.owner.position);

      const leap = new Dash(1_200, this.owner, this.owner);
      leap.image = this.image;
      leap.dashDestination = restingPoint();
      leap.dashSpeed = LEAP_SPEED;
      leap.cancelable = false;
      // `onDashUpdate`, never `onUpdate`: the step lives on Dash's prototype and
      // an instance assignment would delete the leap.
      leap.onDashUpdate = () => {
        if (target.isDead || target.toRemove) return;
        leap.dashDestination = restingPoint();
      };

      // Both ends wired before `addBuff`, because a grounded Darius has his dash
      // deactivated inside that very call.
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        this.chop(target);
      };
      leap.onReachedDestination = land;
      leap.addDeactivateListener(land);

      this.owner.addBuff(leap);
    }

    /** The blade comes down. Everything about this ability happens here. */
    private chop(target: AttackableUnit): void {
      const damage = this.executeDamageAgainst(target);

      const blade = new Darius_R_Object(this.owner);
      blade.landingPoint = target.position.copy();
      blade.damage = damage;
      this.game.objectManager.addObject(blade);

      // He can be stopped short — grounded on the way, or the target simply ran.
      if (target.isDead || target.toRemove) return;
      if (this.owner.position.dist(target.position) > STRIKE_RADIUS) return;

      // Alive one line above, so `isDead` below is this hit and nothing else.
      // `takeDamage` is synchronous, which is what makes that readable at all.
      target.takeDamage(damage, this.owner);
      if (!target.isDead) return;

      blade.executed = true;
      // A head taken resets the axe — the whole reason to hold it for a kill.
      this.resetCoolDown();
      this.terrify();
    }

    /** Everything nearby that is not a champion breaks and runs. */
    private terrify(): void {
      const witnesses = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: FEAR_RADIUS,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const witness of witnesses) {
        // Champions do not rout; this is a wave-clearing and jungle effect.
        if (witness instanceof Champion) continue;
        const panic = new Fear(FEAR_MS, this.owner, witness);
        panic.image = this.image;
        panic.sourcePosition = this.owner.position.copy();
        witness.addBuff(panic);
      }
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Darius_R;
}
const __cacheDarius_R = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_R>>();
export default function makeDarius_R(api: ContentApi) {
  const cached = __cacheDarius_R.get(api);
  if (cached) return cached;
  const built = __buildDarius_R(api);
  __cacheDarius_R.set(api, built);
  return built;
}


export const CHOP_LIFETIME_MS = 520;

/** The blade falls out of the sky over this fraction of the effect's life. */
const FALL_RATIO = 0.35;

const SPATTER_COUNT = 16;


/**
 * The guillotine: one enormous axe dropping vertically onto the body.
 *
 * Deliberately a fall, not a sweep — Q is the sweep, and the two must not read
 * as the same ability. The blade starts high above the victim and lands on the
 * frame the damage was already applied, so the drop is the read on "did it
 * connect", and the executed flag turns the impact from red to white.
 */
function __buildDarius_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Darius_R_Object extends SpellObject {
    landingPoint: p5.Vector = this.owner.position.copy();
    damage = BASE_DAMAGE;
    executed = false;
    age = 0;

    /** How far above the body the blade starts. */
    fallHeight = 260;

    spatter: { angle: number; speed: number; size: number }[] = [];

    onAdded(): void {
      for (let i = 0; i < SPATTER_COUNT; i++) {
        this.spatter.push({
          angle: random(0, TWO_PI),
          speed: random(0.6, 2.4),
          size: random(3, 10),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= CHOP_LIFETIME_MS) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / CHOP_LIFETIME_MS, 0, 1);
      const falling = t < FALL_RATIO;
      // wind-in on the way down: it accelerates into the body
      const drop = falling ? (t / FALL_RATIO) * (t / FALL_RATIO) : 1;
      const after = falling ? 0 : (t - FALL_RATIO) / (1 - FALL_RATIO);
      const fade = 1 - after;

      push();
      translate(this.landingPoint.x, this.landingPoint.y);

      // the shadow the blade casts, tightening as it comes down
      noStroke();
      fill(20, 5, 8, 90 + 90 * drop);
      ellipse(0, 6, 90 - 40 * drop, 26 - 12 * drop);

      if (falling) {
        // the axe, hanging point-down and dropping
        push();
        translate(0, -this.fallHeight * (1 - drop));
        // haft
        stroke(96, 62, 40);
        strokeWeight(9);
        line(0, -96, 0, -18);
        // the head — a broad crescent, edge downward
        noStroke();
        fill(214, 220, 232);
        arc(0, -14, 108, 74, 0, PI, PIE);
        fill(168, 26, 28);
        arc(0, -14, 62, 40, 0, PI, PIE);
        // a hard white line on the edge itself, so the moment of contact reads
        stroke(255, 255, 255, 230);
        strokeWeight(3);
        noFill();
        arc(0, -14, 108, 74, 0.15, PI - 0.15);
        pop();
        pop();
        return;
      }

      // the landing: a ring of blood thrown out, white when the head came off
      const [r, g, b] = this.executed ? [255, 245, 235] : [190, 30, 32];
      noFill();
      stroke(r, g, b, 240 * fade);
      strokeWeight(6 * fade + 1);
      circle(0, 0, 40 + 160 * after);
      stroke(r, g, b, 150 * fade);
      strokeWeight(2);
      circle(0, 0, 20 + 110 * after);

      noStroke();
      for (const fleck of this.spatter) {
        const d = fleck.speed * 90 * after;
        fill(r, g, b, 230 * fade);
        circle(cos(fleck.angle) * d, sin(fleck.angle) * d, fleck.size * fade + 1);
      }

      // an execution leaves a vertical column of light where the body was
      if (!this.executed) {
        pop();
        return;
      }
      stroke(255, 250, 240, 200 * fade);
      strokeWeight(10 * fade + 2);
      line(0, 0, 0, -220 * (0.4 + after));
      pop();
    }

    getDisplayBoundingBox() {
      // covers the blade's whole fall, which starts well above the landing point
      const r = this.fallHeight + 120;
      return new Rectangle({
        x: this.landingPoint.x - r,
        y: this.landingPoint.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return Darius_R_Object;
}
const __cacheDarius_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_R_Object>>();
export function makeDarius_R_Object(api: ContentApi) {
  const cached = __cacheDarius_R_Object.get(api);
  if (cached) return cached;
  const built = __buildDarius_R_Object(api);
  __cacheDarius_R_Object.set(api, built);
  return built;
}