import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeNotifyJannaControlLanded } from './Janna_E';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type HomingMissileSpellObject = InstanceType<ContentApi['HomingMissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Janna_W = InstanceType<ReturnType<typeof makeJanna_W>>;
type Janna_W_Bolt = InstanceType<ReturnType<typeof makeJanna_W_Bolt>>;
type Janna_W_Passive = InstanceType<ReturnType<typeof makeJanna_W_Passive>>;



type ZephyrTarget = AttackableUnit;


function __buildisZephyrTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isZephyrTarget = (target: unknown): target is ZephyrTarget =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove;
  return isZephyrTarget;
}
const __cacheisZephyrTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisZephyrTarget>>();
export function makeIsZephyrTarget(api: ContentApi) {
  const cached = __cacheisZephyrTarget.get(api);
  if (cached) return cached;
  const built = __buildisZephyrTarget(api);
  __cacheisZephyrTarget.set(api, built);
  return built;
}


/**
 * Zephyr. Its passive — permanently ghosted, with a small movement speed
 * bonus — is not gated by the active's own cooldown in League, so it cannot
 * live inside `onSpellCast`. It is maintained every frame from `onUpdate`
 * instead: cheapest correct way to guarantee it survives death and respawn
 * without touching `this.owner` from the constructor, which runs even for
 * the null-owner instance the HUD builds to list this spell in the picker.
 */
// Exported so the suite asserts the wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const PASSIVE_SPEED_PERCENT = 0.08;

export const COOLDOWN_MS = 8_000;

export const MANA_COST = 50;

export const CAST_TIME_MS = 0;

export const RANGE = 550;

export const MISSILE_SPEED = 1_600 / 60;

export const SIZE = 26;

export const DAMAGE = 20;

export const SLOW_PERCENT = 0.35;

export const SLOW_DURATION_MS = 2_000;

export const SPAWN_OFFSET_DISTANCE = 70;


function __buildJanna_W_Passive(api: ContentApi) {
  const StatusFlags = api.enums.StatusFlags;
  const StatAmp = api.buffs.StatAmp;
  class Janna_W_Passive extends StatAmp {
    name = 'Phù Vân';
    stackId = 'janna_w_passive';
    statusFlagsToEnable = StatusFlags.Ghosted;
    bonuses = { speed: { percentBaseBonus: PASSIVE_SPEED_PERCENT } };
  }
  return Janna_W_Passive;
}
const __cacheJanna_W_Passive = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_W_Passive>>();
export function makeJanna_W_Passive(api: ContentApi) {
  const cached = __cacheJanna_W_Passive.get(api);
  if (cached) return cached;
  const built = __buildJanna_W_Passive(api);
  __cacheJanna_W_Passive.set(api, built);
  return built;
}


function __buildJanna_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const isZephyrTarget = makeIsZephyrTarget(api);
  const Janna_W_Passive = makeJanna_W_Passive(api);
  const Janna_W_Bolt = makeJanna_W_Bolt(api);
  class Janna_W extends Spell {
    image = api.asset('spell_janna_w');
    name = 'Gió Tây (Janna_W)';
    description = `Nội tại: Janna luôn được <span class="buff">Ma Hoá</span> và <span class="buff">+${Math.round(PASSIVE_SPEED_PERCENT * 100)}% Tốc Độ Di Chuyển</span>. Chủ động: gửi một linh hồn gió vào mục tiêu, gây <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Làm Chậm ${Math.round(SLOW_PERCENT * 100)}%</span> trong <span class="time">${SLOW_DURATION_MS / 1000} giây</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = RANGE;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;

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
        isTargetable: candidate => isZephyrTarget(candidate),
        getTargetInfo: candidate =>
          isZephyrTarget(candidate)
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
      this.maintainPassive();
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
      }
    }

    onSpellCast(context: CastContext): void {
      if (!isZephyrTarget(context.target)) return;

      const bolt = new Janna_W_Bolt(this.owner, context.target);
      bolt.position = VectorUtils.getVectorWithRange(
        this.owner.position,
        context.target.position,
        SPAWN_OFFSET_DISTANCE,
        false
      ).to;
      bolt.damage = this.damage;
      bolt.slowPercent = this.slowPercent;
      bolt.slowDuration = this.slowDuration;

      this.game.objectManager.addObject(bolt);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private isValidTarget(target: unknown): target is ZephyrTarget {
      return (
        isZephyrTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId !== this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }

    /** Always-on passive, independent of this spell's own cooldown/state. */
    private maintainPassive(): void {
      if (!this.owner || this.owner.isDead) return;
      if (this.owner.hasBuff(Janna_W_Passive)) return;
      this.owner.addBuff(new Janna_W_Passive(Infinity, this.owner, this.owner));
    }
  }
  return Janna_W;
}
const __cacheJanna_W = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_W>>();
export default function makeJanna_W(api: ContentApi) {
  const cached = __cacheJanna_W.get(api);
  if (cached) return cached;
  const built = __buildJanna_W(api);
  __cacheJanna_W.set(api, built);
  return built;
}


function __buildJanna_W_Bolt(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const HomingMissileSpellObject = api.HomingMissileSpellObject;
  const notifyJannaControlLanded = makeNotifyJannaControlLanded(api);
  class Janna_W_Bolt extends HomingMissileSpellObject {
    speed = MISSILE_SPEED;
    size = SIZE;
    damage = DAMAGE;
    slowPercent = SLOW_PERCENT;
    slowDuration = SLOW_DURATION_MS;

    _spin = 0;

    trailSystem = new TrailSystem({
      trailColor: '#C8F5E866',
      trailSize: this.size * 0.5,
      trailLifeTime: 300,
    });

    onAfterMove(): void {
      this._spin += 0.18;
    }

    onTargetArrive(target: ZephyrTarget): void {
      target.takeDamage(this.damage, this.owner);

      const slow = new Slow(this.slowDuration, this.owner, target);
      slow.percent = this.slowPercent;
      slow.stackId = 'janna_w_slow';
      target.addBuff(slow);

      notifyJannaControlLanded(this.owner, target);
    }

    draw(): void {
      push();
      translate(this.position.x, this.position.y);
      rotate(this._spin);

      const s = this.size / 2;

      // a small elemental wisp: a soft trailing body around a bright core
      noStroke();
      fill(180, 240, 225, 90);
      ellipse(0, 0, s * 2.6, s * 1.4);

      stroke(210, 250, 240, 220);
      strokeWeight(2);
      fill(225, 255, 245, 200);
      beginShape();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TWO_PI;
        const r = s * (i % 2 === 0 ? 1 : 0.55);
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape(CLOSE);

      noStroke();
      fill(255, 255, 255, 235);
      circle(0, 0, s * 0.7);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = this.size * 1.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Janna_W_Bolt;
}
const __cacheJanna_W_Bolt = new WeakMap<ContentApi, ReturnType<typeof __buildJanna_W_Bolt>>();
export function makeJanna_W_Bolt(api: ContentApi) {
  const cached = __cacheJanna_W_Bolt.get(api);
  if (cached) return cached;
  const built = __buildJanna_W_Bolt(api);
  __cacheJanna_W_Bolt.set(api, built);
  return built;
}