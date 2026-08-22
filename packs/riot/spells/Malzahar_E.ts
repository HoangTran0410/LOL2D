import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Malzahar_E = InstanceType<ReturnType<typeof makeMalzahar_E>>;
type Malzahar_E_Object = InstanceType<ReturnType<typeof makeMalzahar_E_Object>>;



// Exported so the suite asserts the infection's wiring rather than a copy of
// the numbers — retuning a value must not mean editing a test.
export const RANGE = 500;

export const CAST_TIME_MS = 0;

export const DURATION_MS = 3_000;

export const DAMAGE_PER_TICK = 4;

export const TICK_INTERVAL_MS = 500;

/** How far the vision jumps when its host dies. */
export const SPREAD_RANGE = 300;

/** Mana Malzahar gets back for a host that dies infected. */
export const MANA_ON_KILL = 20;

/**
 * How many further hosts one cast may reach. Uncapped, a single E into a wave
 * chains through the whole thing for free — the permanent-stack mistake in a
 * different shape.
 */
export const MAX_SPREADS = 2;

export const COOLDOWN_MS = 7_000;

export const MANA_COST = 60;

/** Its own slot, or this and Ignite fight over one `DamageOverTime`. */
export const VISIONS_STACK_ID = 'malzahar_e';


function __buildisVisionsTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isVisionsTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isVisionsTarget;
}
const __cacheisVisionsTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisVisionsTarget>>();
export function makeIsVisionsTarget(api: ContentApi) {
  const cached = __cacheisVisionsTarget.get(api);
  if (cached) return cached;
  const built = __buildisVisionsTarget(api);
  __cacheisVisionsTarget.set(api, built);
  return built;
}


/**
 * Ám Ảnh Kinh Hoàng. A rot in the target's head that jumps to the next body
 * when the first one dies.
 *
 * A real `UNIT` cast — `targetingRequest` plus the `press()` override — so the
 * touch layer can highlight who is about to be infected and a drag can choose
 * between two candidates, rather than the cursor-radius guess an auto-locking
 * spell would make.
 */
function __buildMalzahar_E(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const TargetResolver = api.combat.TargetResolver;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const canSee = api.combat.Vision.canSee;
  const isVisionsTarget = makeIsVisionsTarget(api);
  const infectWithVisions = makeInfectWithVisions(api);
  class Malzahar_E extends Spell {
    image = api.asset('spell_malzahar_e');
    name = 'Ám Ảnh Kinh Hoàng (Malzahar_E)';
    description =
      `Gieo ảo ảnh vào tâm trí mục tiêu, gây <span class="damage">${DAMAGE_PER_TICK} sát thương</span>` +
      ` mỗi <span class="time">${TICK_INTERVAL_MS / 1000} giây</span> trong` +
      ` <span class="time">${DURATION_MS / 1000} giây</span>. Nếu vật chủ chết khi còn nhiễm, ảo ảnh` +
      ` <span class="buff">lây sang kẻ địch gần nhất</span> và Malzahar hồi` +
      ` <span class="buff">${MANA_ON_KILL} năng lượng</span>`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        targetTeam: 'ENEMY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isVisionsTarget(candidate),
        getTargetInfo: candidate =>
          isVisionsTarget(candidate)
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

    checkCastCondition(): boolean {
      return this.isValidTarget(this.castContext?.target);
    }

    press(context: CastContext): boolean {
      if (context.target !== undefined) return super.press(context);
      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    onUpdate(): void {
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
      }
    }

    onSpellCast(context: CastContext): void {
      if (!isVisionsTarget(context.target)) return;
      infectWithVisions(this.owner, context.target, MAX_SPREADS);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isVisionsTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Malzahar_E;
}
const __cacheMalzahar_E = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_E>>();
export default function makeMalzahar_E(api: ContentApi) {
  const cached = __cacheMalzahar_E.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_E(api);
  __cacheMalzahar_E.set(api, built);
  return built;
}
// infectWithVisions / Malzahar_E_Object reference each other as real values both ways —
// see this file's own header comment on the codemod's cycle handling.
function __group0_Malzahar_E_ObjectBuild(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const DamageOverTime = api.buffs.DamageOverTime;


/**
 * Put the rot on one body. Shared by the cast and by the spread, so a jumped
 * infection is the same infection with one fewer jump left in it.
 */
  function infectWithVisions(
    caster: AttackableUnit,
    victim: AttackableUnit,
    spreadsLeft: number
  ): Malzahar_E_Object {
    const rot = new DamageOverTime(DURATION_MS, caster, victim);
    // A bare DamageOverTime would fight Ignite and Teemo's poison over one slot.
    rot.stackId = VISIONS_STACK_ID;
    rot.damagePerTick = DAMAGE_PER_TICK;
    rot.tickInterval = TICK_INTERVAL_MS;
    rot.flameColor = [206, 255, 140];
    rot.emberColor = [96, 30, 150];
    victim.addBuff(rot);

    const watcher = new Malzahar_E_Object(caster);
    watcher.victim = victim;
    watcher.spreadsLeft = spreadsLeft;
    watcher.attachTo(victim);
    caster.game.objectManager.addObject(watcher);
    return watcher;
  }


/**
 * The eyes circling an infected head — and the thing that notices when that
 * head comes off.
 *
 * Death is caught here rather than in the buff because the buff's own end is
 * ambiguous: expiry and death both deactivate it, and by the time a corpse
 * stops ticking there is nothing left to ask. Latching `victim.isDead` on the
 * frame it flips is the same synchronous read the execute-stack rule uses.
 */
  class Malzahar_E_Object extends SpellObject {
    victim: AttackableUnit | null = null;
    spreadsLeft = 0;
    age = 0;
    /** Latched so a corpse that revives elsewhere cannot pay out twice. */
    _settled = false;

    update(): void {
      const victim = this.victim;
      if (!victim) {
        this.toRemove = true;
        return;
      }

      // Death first: `dropIfAttachmentLost` would drop the effect on exactly the
      // frame the payout is owed, and the payout is the whole ability.
      if (!this._settled && (victim.isDead || victim.toRemove)) {
        this._settled = true;
        if (victim.isDead) this.payOut(victim);
        this.toRemove = true;
        return;
      }
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(victim.position.x, victim.position.y);
      if (this.age >= DURATION_MS) this.toRemove = true;
    }

    /** The host died infected: Malzahar is paid, and the rot looks for a new head. */
    payOut(corpse: AttackableUnit): void {
      // Not `stats.mana`: granting a resource is not billing for one, so it goes
      // through the unit's own `restoreMana` where URF's manaFree has no say.
      this.owner.restoreMana(MANA_ON_KILL);
      if (this.spreadsLeft <= 0) return;

      const next = this.nearestHost(corpse);
      if (!next) return;
      infectWithVisions(this.owner, next, this.spreadsLeft - 1);
    }

    /** The nearest enemy that is not already carrying the rot. */
    nearestHost(corpse: AttackableUnit): AttackableUnit | null {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: corpse.position.x, y: corpse.position.y, r: SPREAD_RANGE }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          // The jump picks a body, so it is acquisition and the fog has a say.
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      let nearest: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const candidate of candidates) {
        if (candidate === corpse || candidate.isDead) continue;
        // Already carrying *this* rot, not merely any burn: a target on fire from
        // Ignite is still a perfectly good head for the visions to jump into.
        if (candidate.buffs.some(buff => !buff.toRemove && buff.stackId === VISIONS_STACK_ID)) {
          continue;
        }
        const distance = candidate.position.dist(corpse.position);
        if (distance >= nearestDistance) continue;
        nearestDistance = distance;
        nearest = candidate;
      }
      return nearest;
    }

    draw(): void {
      const victim = this.victim;
      if (!victim) return;
      const size = victim.animatedValues?.displaySize ?? 40;
      const left = constrain(1 - this.age / DURATION_MS, 0, 1);
      // Grows in over the first fifth of a second rather than appearing whole.
      const entry = constrain(this.age / 200, 0, 1);
      const grown = 1 - (1 - entry) * (1 - entry);

      push();
      translate(victim.position.x, victim.position.y);

      // three eyes orbiting the head, blinking out of phase with each other
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TWO_PI + this.age / 420;
        const r = (size * 0.55 + 12) * grown;
        const blink = 0.4 + 0.6 * Math.abs(sin(this.age / 260 + i * 1.7));
        const x = cos(a) * r;
        const y = sin(a) * r * 0.6;
        noStroke();
        fill(60, 20, 96, 190 * left);
        ellipse(x, y, 15 * grown, 10 * grown);
        fill(206, 255, 140, 235 * left * blink);
        circle(x, y, 6 * grown * blink + 2);
      }

      // the rot itself, a haze tightening on the head as the timer runs down
      noFill();
      stroke(150, 90, 210, 110 * left);
      strokeWeight(2);
      circle(0, 0, (size + 20) * grown * (0.85 + 0.15 * left));

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const at = this.victim?.position ?? this.position;
      const r = 70;
      return new Rectangle({
        x: at.x - r,
        y: at.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return { infectWithVisions, Malzahar_E_Object };
}
const __group0_Malzahar_E_ObjectCache = new WeakMap<ContentApi, ReturnType<typeof __group0_Malzahar_E_ObjectBuild>>();
function __group0_Malzahar_E_ObjectBuilder(api: ContentApi) {
  const cached = __group0_Malzahar_E_ObjectCache.get(api);
  if (cached) return cached;
  const built = __group0_Malzahar_E_ObjectBuild(api);
  __group0_Malzahar_E_ObjectCache.set(api, built);
  return built;
}
export function makeInfectWithVisions(api: ContentApi) {
  return __group0_Malzahar_E_ObjectBuilder(api).infectWithVisions;
}
export function makeMalzahar_E_Object(api: ContentApi) {
  return __group0_Malzahar_E_ObjectBuilder(api).Malzahar_E_Object;
}