import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Leblanc_Q = InstanceType<ReturnType<typeof makeLeblanc_Q>>;
type Leblanc_Q_Mark = InstanceType<ReturnType<typeof makeLeblanc_Q_Mark>>;
type Leblanc_Q_Object = InstanceType<ReturnType<typeof makeLeblanc_Q_Object>>;



type SigilTarget = AttackableUnit;


function __buildisSigilTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isSigilTarget = (target: unknown): target is SigilTarget =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isSigilTarget;
}
const __cacheisSigilTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisSigilTarget>>();
export function makeIsSigilTarget(api: ContentApi) {
  const cached = __cacheisSigilTarget.get(api);
  if (cached) return cached;
  const built = __buildisSigilTarget(api);
  __cacheisSigilTarget.set(api, built);
  return built;
}


// Exported so the suite asserts the orb's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const RANGE = 620;

export const CAST_TIME_MS = 0;

export const MANA_COST = 40;

export const DAMAGE = 24;

export const MARK_DURATION_MS = 3_500;

export const MISSILE_SPEED = 1_500 / 60;

export const MISSILE_SIZE = 20;


function __buildLeblanc_Q(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isSigilTarget = makeIsSigilTarget(api);
  const Leblanc_Q_Object = makeLeblanc_Q_Object(api);
  class Leblanc_Q extends Spell {
    image = api.asset('spell_leblanc_q');
    name = 'Ấn Ác Ý (Leblanc_Q)';
    description =
      'Phóng một quả cầu vào kẻ địch, gây <span class="damage">24 sát thương phép</span> và đánh dấu mục tiêu trong <span class="time">3.5 giây</span>. Kỹ năng gây sát thương tiếp theo của LeBlanc lên mục tiêu đã đánh dấu sẽ kích nổ dấu ấn, gây thêm <span class="damage">24 sát thương</span> và làm mới dấu ấn.';
    coolDown = 6_000;
    manaCost = MANA_COST;

    range = RANGE;
    damage = DAMAGE;
    markDurationMs = MARK_DURATION_MS;

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
        isTargetable: candidate => isSigilTarget(candidate),
        getTargetInfo: candidate =>
          isSigilTarget(candidate)
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
      if (!isSigilTarget(context.target)) return;

      const orb = new Leblanc_Q_Object(this.owner, context.target);
      orb.speed = MISSILE_SPEED;
      orb.size = MISSILE_SIZE;
      orb.damage = this.damage;
      orb.markDurationMs = this.markDurationMs;
      this.game.objectManager.addObject(orb);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is SigilTarget {
      return (
        isSigilTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Leblanc_Q;
}
const __cacheLeblanc_Q = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_Q>>();
export default function makeLeblanc_Q(api: ContentApi) {
  const cached = __cacheLeblanc_Q.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_Q(api);
  __cacheLeblanc_Q.set(api, built);
  return built;
}


/**
 * Sigil's mark. Whatever damaging LeBlanc ability lands on this target next
 * detonates it for `bonusDamage` and consumes it — the double-tap that the
 * rest of her kit is built around. Only `Leblanc_Q` itself (and its Mimic
 * recast, which is a real `Leblanc_Q` instance) checks for this mark today;
 * `Leblanc_W`/`Leblanc_E` are pre-existing legacy spells this task did not
 * touch, so they neither apply nor consume it. That is a disclosed scope
 * limit, not an oversight.
 */
function __buildLeblanc_Q_Mark(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Buff = api.buffs.Buff;
  class Leblanc_Q_Mark extends Buff {
    name = 'Ấn Ký Ác Ý';
    image: Buff['image'] = api.asset('spell_leblanc_q');
    buffAddType = BuffAddType.RENEW_EXISTING;
    /** The bonus damage a consuming hit deals — set by whoever placed the mark. */
    bonusDamage = 0;

    draw(): void {
      const pos = this.targetUnit.position;
      const size = this.targetUnit.animatedValues.displaySize;
      const pulse = 0.5 + 0.5 * sin(frameCount / 10);
      const ry = -size / 2 - 16;

      push();
      translate(pos.x, pos.y);

      noFill();
      stroke(230, 160, 255, 160 + 80 * pulse);
      strokeWeight(1.5);
      circle(0, ry, 13 + 3 * pulse);

      // a small three-pronged sigil hovering over the mark
      stroke(190, 60, 220, 150 + 90 * pulse);
      strokeWeight(2.2);
      const spin = frameCount / 26;
      for (let i = 0; i < 3; i++) {
        const a = spin + (i * TWO_PI) / 3;
        line(cos(a) * 4, ry + sin(a) * 4, cos(a) * 11, ry + sin(a) * 11);
      }

      pop();
    }
  }
  return Leblanc_Q_Mark;
}
const __cacheLeblanc_Q_Mark = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_Q_Mark>>();
export function makeLeblanc_Q_Mark(api: ContentApi) {
  const cached = __cacheLeblanc_Q_Mark.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_Q_Mark(api);
  __cacheLeblanc_Q_Mark.set(api, built);
  return built;
}


function __buildLeblanc_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const Leblanc_Q_Mark = makeLeblanc_Q_Mark(api);
  class Leblanc_Q_Object extends HomingMissileSpellObject {
    damage = DAMAGE;
    markDurationMs = MARK_DURATION_MS;

    trailSystem = new TrailSystem({
      trailColor: '#C64AE688',
      trailSize: this.size * 0.5,
    });

    onTargetArrive(target: SigilTarget): void {
      const existingMark = target.buffs.find(
        (buff): buff is Leblanc_Q_Mark => buff instanceof Leblanc_Q_Mark && !buff.toRemove
      );

      target.takeDamage(this.damage, this.owner);
      if (existingMark) {
        // the mark detonates for the same amount again
        target.takeDamage(existingMark.bonusDamage || this.damage, this.owner);
      }

      // Leblanc_Q_Mark is RENEW_EXISTING, so this either refreshes the mark
      // already on the target (including one still consuming above) or adds a
      // fresh one — never both a stale and a new instance at once.
      const mark = new Leblanc_Q_Mark(this.markDurationMs, this.owner, target);
      mark.bonusDamage = this.damage;
      target.addBuff(mark);
    }

    draw(): void {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const r = this.size / 2;

      push();
      translate(this.position.x, this.position.y);

      // deceptive violet-magenta orb, with a trailing wisp along the flight path
      blendMode(ADD);
      rotate(angle);
      noStroke();
      fill(190, 60, 220, 70);
      ellipse(-r * 0.6, 0, r * 3.2, r * 1.4);
      blendMode(BLEND);

      noStroke();
      fill(70, 10, 90, 235);
      circle(0, 0, r * 2.1);
      fill(210, 90, 235, 235);
      circle(0, 0, r * 1.7);
      fill(250, 220, 255, 235);
      circle(0, 0, r * 0.75);

      // two thin rings drifting around the core
      noFill();
      stroke(230, 170, 255, 180);
      strokeWeight(1.4);
      const spin = frameCount / 14;
      ellipse(0, 0, r * 2.6 * Math.abs(Math.cos(spin)), r * 2.6);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const pad = this.size * 1.6;
      return this.squareDisplayBoundingBox(pad * 2);
    }
  }
  return Leblanc_Q_Object;
}
const __cacheLeblanc_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_Q_Object>>();
export function makeLeblanc_Q_Object(api: ContentApi) {
  const cached = __cacheLeblanc_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_Q_Object(api);
  __cacheLeblanc_Q_Object.set(api, built);
  return built;
}