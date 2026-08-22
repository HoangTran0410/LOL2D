import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Chilled = InstanceType<ContentApi['buffs']['Chilled']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Anivia_E = InstanceType<ReturnType<typeof makeAnivia_E>>;
type Anivia_E_Bolt = InstanceType<ReturnType<typeof makeAnivia_E_Bolt>>;
type Anivia_E_Impact = InstanceType<ReturnType<typeof makeAnivia_E_Impact>>;



type FrostbiteTarget = AttackableUnit;


function __buildisFrostbiteTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isFrostbiteTarget = (target: unknown): target is FrostbiteTarget =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isFrostbiteTarget;
}
const __cacheisFrostbiteTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisFrostbiteTarget>>();
export function makeIsFrostbiteTarget(api: ContentApi) {
  const cached = __cacheisFrostbiteTarget.get(api);
  if (cached) return cached;
  const built = __buildisFrostbiteTarget(api);
  __cacheisFrostbiteTarget.set(api, built);
  return built;
}


/**
 * Frostbite. A single-target bolt whose damage doubles against a target
 * already Chilled by Flash Frost (Q) or a fully-formed Glacial Storm (R) —
 * see `Chilled.ts`, shared across the whole kit. Built the way `Malphite_Q`
 * is: a targeted `HomingMissileSpellObject` resolved through
 * `TargetResolver` at press time.
 */
// Exported so the suite asserts the bolt's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const COOLDOWN_MS = 4_000;

export const MANA_COST = 40;

export const CAST_TIME_MS = 0;

export const RANGE = 450;

export const MISSILE_SPEED = 1_600 / 60;

export const SIZE = 22;

export const BASE_DAMAGE = 20;

export const CHILLED_DAMAGE = 40;

export const SPAWN_OFFSET_DISTANCE = 60;


function __buildAnivia_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isFrostbiteTarget = makeIsFrostbiteTarget(api);
  const Anivia_E_Bolt = makeAnivia_E_Bolt(api);
  class Anivia_E extends Spell {
    image = api.asset('spell_anivia_e');
    name = 'Tê Cóng (Anivia_E)';
    description = `Anivia bắn một mũi băng vào mục tiêu, gây <span class="damage">${BASE_DAMAGE} sát thương</span>, tăng gấp đôi thành <span class="damage">${CHILLED_DAMAGE}</span> nếu mục tiêu đang <span class="buff">Nhiễm Lạnh</span> (bị Sương Băng hoặc Bão Tuyết đã hình thành đầy đủ đánh trúng gần đây).`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;
    baseDamage = BASE_DAMAGE;
    chilledDamage = CHILLED_DAMAGE;

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
        isTargetable: candidate => isFrostbiteTarget(candidate),
        getTargetInfo: candidate =>
          isFrostbiteTarget(candidate)
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
      if (!isFrostbiteTarget(context.target)) return;

      const bolt = new Anivia_E_Bolt(this.owner, context.target);
      bolt.position = VectorUtils.getVectorWithRange(
        this.owner.position,
        context.target.position,
        SPAWN_OFFSET_DISTANCE,
        false
      ).to;
      bolt.baseDamage = this.baseDamage;
      bolt.chilledDamage = this.chilledDamage;

      this.game.objectManager.addObject(bolt);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is FrostbiteTarget {
      return (
        isFrostbiteTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Anivia_E;
}
const __cacheAnivia_E = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_E>>();
export default function makeAnivia_E(api: ContentApi) {
  const cached = __cacheAnivia_E.get(api);
  if (cached) return cached;
  const built = __buildAnivia_E(api);
  __cacheAnivia_E.set(api, built);
  return built;
}


function __buildAnivia_E_Bolt(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const Chilled = api.buffs.Chilled;
  const TrailSystem = api.helpers.TrailSystem;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const Anivia_E_Impact = makeAnivia_E_Impact(api);
  class Anivia_E_Bolt extends HomingMissileSpellObject {
    speed = MISSILE_SPEED;
    size = SIZE;
    baseDamage = BASE_DAMAGE;
    chilledDamage = CHILLED_DAMAGE;

    trailSystem = new TrailSystem({
      trailColor: '#BFEBFF80',
      trailSize: this.size * 0.5,
      trailLifeTime: 260,
    });

    onTargetArrive(target: FrostbiteTarget): void {
      const chilled = target.hasBuff(Chilled);
      const damage = chilled ? this.chilledDamage : this.baseDamage;
      target.takeDamage(damage, this.owner);

      const impact = new Anivia_E_Impact(this.owner);
      impact.position = target.position.copy();
      impact.targetSize = target.animatedValues?.displaySize ?? 40;
      impact.empowered = chilled;
      this.game.objectManager.addObject(impact);
    }

    draw(): void {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const s = this.size;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // frost trail bleeding off the shaft
      blendMode(ADD);
      strokeCap(SQUARE);
      stroke(160, 220, 255, 70);
      strokeWeight(5);
      line(-s * 0.9, 0, s * 0.1, 0);
      blendMode(BLEND);
      strokeCap(ROUND);

      // a narrow icicle rather than a ball, faceted so it reads as ice in flight
      stroke(35, 95, 135, 235);
      strokeWeight(2);
      fill(150, 210, 245, 235);
      beginShape();
      vertex(s * 0.65, 0);
      vertex(s * 0.05, -s * 0.32);
      vertex(-s * 0.6, -s * 0.16);
      vertex(-s * 0.6, s * 0.16);
      vertex(s * 0.05, s * 0.32);
      endShape(CLOSE);

      noStroke();
      fill(255, 255, 255, 220);
      triangle(s * 0.55, 0, s * 0.05, -s * 0.14, s * 0.1, 0);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = this.size * 1.5;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Anivia_E_Bolt;
}
const __cacheAnivia_E_Bolt = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_E_Bolt>>();
export function makeAnivia_E_Bolt(api: ContentApi) {
  const cached = __cacheAnivia_E_Bolt.get(api);
  if (cached) return cached;
  const built = __buildAnivia_E_Bolt(api);
  __cacheAnivia_E_Bolt.set(api, built);
  return built;
}


/** The strike landing: a small frost burst, brighter and wider on a doubled hit. */
function __buildAnivia_E_Impact(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Anivia_E_Impact extends SpellObject {
    position = this.owner.position.copy();
    targetSize = 40;
    empowered = false;
    age = 0;
    lifeTime = 320;

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const scale = this.empowered ? 1.5 : 1;
      const burstRadius = (this.targetSize * 0.6 + 24) * scale;

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noStroke();
      fill(190, 230, 255, 150 * fade);
      circle(0, 0, burstRadius * (0.4 + t * 0.9));
      blendMode(BLEND);

      noFill();
      stroke(230, 248, 255, 220 * fade);
      strokeWeight(2.5 * scale);
      for (let i = 0; i < (this.empowered ? 8 : 5); i++) {
        const a = (i / (this.empowered ? 8 : 5)) * TWO_PI;
        const reach = burstRadius * (0.3 + t * 0.7);
        line(cos(a) * reach * 0.25, sin(a) * reach * 0.25, cos(a) * reach, sin(a) * reach);
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = (this.targetSize + 60) * (this.empowered ? 1.5 : 1);
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Anivia_E_Impact;
}
const __cacheAnivia_E_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildAnivia_E_Impact>>();
export function makeAnivia_E_Impact(api: ContentApi) {
  const cached = __cacheAnivia_E_Impact.get(api);
  if (cached) return cached;
  const built = __buildAnivia_E_Impact(api);
  __cacheAnivia_E_Impact.set(api, built);
  return built;
}