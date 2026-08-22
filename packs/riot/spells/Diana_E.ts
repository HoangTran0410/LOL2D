import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeMoonlightOn } from './Diana_Q';
import { MOON_CORE, MOON_PALE, drawCrescent } from './Diana_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Diana_E = InstanceType<ReturnType<typeof makeDiana_E>>;
type Diana_E_Collapse = InstanceType<ReturnType<typeof makeDiana_E_Collapse>>;
type Diana_E_Footfall = InstanceType<ReturnType<typeof makeDiana_E_Footfall>>;
type Diana_E_Shatter = InstanceType<ReturnType<typeof makeDiana_E_Shatter>>;



export const E_RANGE = 380;

export const E_DAMAGE = 20;

export const E_DASH_MS = 620;

/** How much room she leaves between herself and the body she lands on. */
export const E_GAP = 52;

export const E_COLLAPSE_RADIUS = 48;

export const E_SHATTER_RADIUS = 54;


const E_WINDUP_MS = 100;

const E_DASH_SPEED = 15;

const E_FOOTFALL_MS = 80;

const E_FOOTFALL_RADIUS = 22;


function __buildDiana_E(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const TrailSystem = api.helpers.TrailSystem;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const moonlightOn = makeMoonlightOn(api);
  const Diana_E_Footfall = makeDiana_E_Footfall(api);
  const Diana_E_Collapse = makeDiana_E_Collapse(api);
  const Diana_E_Shatter = makeDiana_E_Shatter(api);
  class Diana_E extends Spell {
    image = api.asset('spell_diana_e');
    name = 'Trăng Non (Diana_E)';
    description = `Lao tới mục tiêu, gây <span class="damage">${E_DAMAGE} sát thương</span> khi tới.
      Nếu mục tiêu đang mang dấu Ánh Trăng, dấu bị phá và Trăng Non hồi lại ngay lập tức.`;
    coolDown = 10_000;
    manaCost = 25;
    range = E_RANGE;

    /** Written on every arrival: true when that dive ate a mark and reset the cooldown. */
    lastDiveConsumedMoonlight = false;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        castTimeMs: E_WINDUP_MS,
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
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
        withinRange(this.range, this.owner, target)
      );
    }

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner) && this.isValidTarget(this.castContext?.target);
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) {
        if (!this.isValidTarget(context.target as AttackableUnit)) return false;
        return super.press(context);
      }

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onSpellCast(context?: CastContext): void {
      const target = context?.target as AttackableUnit | undefined;
      if (!this.isValidTarget(target)) return;

      const from = this.owner.position;
      const dx = target.position.x - from.x;
      const dy = target.position.y - from.y;
      const span = Math.hypot(dx, dy);
      const travel = Math.max(span - E_GAP, 0);
      const landing =
        span === 0
          ? createVector(from.x, from.y)
          : createVector(from.x + (dx / span) * travel, from.y + (dy / span) * travel);

      const dash = new Dash(E_DASH_MS, this.owner, this.owner);
      dash.dashDestination = landing;
      dash.dashSpeed = E_DASH_SPEED;
      dash.image = this.image;
      dash.trailSystem = new TrailSystem({
        owner: this.owner,
        maxLength: 20,
        trailColor: '#9fd0ffaa',
        trailSize: 12,
        trailLifeTime: 300,
      });

      let sinceFootfall = E_FOOTFALL_MS;
      dash.onDashUpdate = () => {
        sinceFootfall += deltaTime;
        if (sinceFootfall < E_FOOTFALL_MS) return;
        sinceFootfall = 0;
        this.game.objectManager.addObject(
          new Diana_E_Footfall(this.owner, this.owner.position.copy())
        );
      };

      let landed = false;
      dash.onReachedDestination = () => {
        if (landed) return;
        landed = true;
        this.strike(target);
      };

      this.owner.addBuff(dash);
    }

    /**
     * Arrival. The mark is read before the damage lands, because a killing blow clears buffs
     * and a reset that depends on the corpse is not a reset.
     */
    private strike(target: AttackableUnit): void {
      const mark = moonlightOn(target);
      this.lastDiveConsumedMoonlight = mark !== null;

      this.game.objectManager.addObject(new Diana_E_Collapse(this.owner, target.position.copy()));

      if (mark) {
        mark.deactivateBuff();
        this.game.objectManager.addObject(new Diana_E_Shatter(this.owner, target.position.copy()));
        this.resetCoolDown();
      }

      if (!target.isDead) target.takeDamage(E_DAMAGE, this.owner);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Diana_E;
}
const __cacheDiana_E = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_E>>();
export default function makeDiana_E(api: ContentApi) {
  const cached = __cacheDiana_E.get(api);
  if (cached) return cached;
  const built = __buildDiana_E(api);
  __cacheDiana_E.set(api, built);
  return built;
}


/** Moonlight left in the dust behind her. */
function __buildDiana_E_Footfall(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Diana_E_Footfall extends SpellObject {
    lifeTime = 320;
    age = 0;
    private lean = 0;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      this.lean = random(0, TWO_PI);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      push();
      noFill();
      drawCrescent(
        this.position.x,
        this.position.y,
        E_FOOTFALL_RADIUS * (0.4 + 0.6 * t),
        this.lean,
        1.5,
        4 * (1 - t) + 0.8,
        MOON_PALE,
        180 * (1 - t)
      );
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((E_FOOTFALL_RADIUS + 16) * 2);
    }
  }
  return Diana_E_Footfall;
}
const __cacheDiana_E_Footfall = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_E_Footfall>>();
export function makeDiana_E_Footfall(api: ContentApi) {
  const cached = __cacheDiana_E_Footfall.get(api);
  if (cached) return cached;
  const built = __buildDiana_E_Footfall(api);
  __cacheDiana_E_Footfall.set(api, built);
  return built;
}


/** The landing: crescents collapsing inward onto the body she chose. */
function __buildDiana_E_Collapse(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Diana_E_Collapse extends SpellObject {
    lifeTime = 320;
    age = 0;
    private blades: number[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < 4; i++) this.blades.push(random(0, TWO_PI));
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // Inward: the reach shrinks, because the dive ended here.
      const closing = 1 - (1 - t) * (1 - t);
      push();
      noFill();
      stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 215 * (1 - t));
      strokeWeight(3 * (1 - t) + 1);
      circle(this.position.x, this.position.y, E_COLLAPSE_RADIUS * 2 * (1 - 0.75 * closing));
      for (const blade of this.blades) {
        const away = E_COLLAPSE_RADIUS * (1 - 0.8 * closing) + 6;
        drawCrescent(
          this.position.x + cos(blade) * away * 0.35,
          this.position.y + sin(blade) * away * 0.35,
          away * 0.6,
          blade + PI,
          1.5,
          6 * (1 - t) + 1,
          MOON_CORE,
          230 * (1 - t)
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((E_COLLAPSE_RADIUS + 28) * 2);
    }
  }
  return Diana_E_Collapse;
}
const __cacheDiana_E_Collapse = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_E_Collapse>>();
export function makeDiana_E_Collapse(api: ContentApi) {
  const cached = __cacheDiana_E_Collapse.get(api);
  if (cached) return cached;
  const built = __buildDiana_E_Collapse(api);
  __cacheDiana_E_Collapse.set(api, built);
  return built;
}


/**
 * The consumed mark, breaking. Only ever drawn on a reset dive, so a player can tell a reset
 * from a wasted dive without watching the cooldown.
 */
function __buildDiana_E_Shatter(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Diana_E_Shatter extends SpellObject {
    lifeTime = 420;
    age = 0;
    private shards: { angle: number; spin: number; span: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < 7; i++) {
        this.shards.push({
          angle: (i / 7) * TWO_PI + random(-0.2, 0.2),
          spin: random(-1.4, 1.4),
          span: random(0.5, 1.1),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const thrown = 1 - (1 - t) * (1 - t);
      push();
      noFill();
      for (const shard of this.shards) {
        const away = E_SHATTER_RADIUS * thrown;
        drawCrescent(
          this.position.x + cos(shard.angle) * away,
          this.position.y + sin(shard.angle) * away,
          9,
          shard.angle + shard.spin * thrown * PI,
          shard.span,
          5 * (1 - t) + 0.8,
          MOON_PALE,
          245 * (1 - t)
        );
      }
      stroke(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 200 * (1 - t));
      strokeWeight(2 * (1 - t) + 0.6);
      circle(this.position.x, this.position.y, 12 + 26 * thrown);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((E_SHATTER_RADIUS + 26) * 2);
    }
  }
  return Diana_E_Shatter;
}
const __cacheDiana_E_Shatter = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_E_Shatter>>();
export function makeDiana_E_Shatter(api: ContentApi) {
  const cached = __cacheDiana_E_Shatter.get(api);
  if (cached) return cached;
  const built = __buildDiana_E_Shatter(api);
  __cacheDiana_E_Shatter.set(api, built);
  return built;
}