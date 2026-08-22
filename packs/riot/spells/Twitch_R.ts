import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Twitch_R = InstanceType<ReturnType<typeof makeTwitch_R>>;
type Twitch_R_Bolt = InstanceType<ReturnType<typeof makeTwitch_R_Bolt>>;
type Twitch_R_Pierce = InstanceType<ReturnType<typeof makeTwitch_R_Pierce>>;



export const DURATION = 7000;

export const BONUS_RANGE = 250;

export const BONUS_DAMAGE = 12;

/**
 * The pierce. It was 7 — barely a third of the basic attack that spawned it —
 * so a shot that cut through three bodies read as a rounding error rather than
 * as the reason the ultimate exists. At 15 a line of three is 45, which is
 * ultimate-tier without touching the single-target case at all.
 */
export const BOLT_DAMAGE = 15;

export const BOLT_RANGE = 700;

export const ON_HIT_DAMAGE = 9;

export const ATTACK_SPEED_PERCENT = 0.45;

export const STACK_ID = 'twitch_r';


/**
 * Spray and Pray, and the reason it is not just a stat line.
 *
 * The first version handed out attack range, attack damage and attack speed
 * and stopped there. That is an ultimate the player never *sees*: basic
 * attacks in this game are the dull part of a fight, so an ability whose whole
 * body is "your basic attacks are 25% better" reads as nothing happening. The
 * bolt below is the ability — every swing now punches through the target it
 * hit and keeps going, which changes how the fight is *positioned*, not just
 * how fast the numbers tick.
 *
 * It rides `ON_ATTACK_HIT` rather than reimplementing the swing (see
 * docs/ADDING_SPELLS.md §9), so it only fires on attacks that actually landed
 * and the original victim is never double-billed: it is seeded into the
 * missile's `hitTargets` before the bolt is in the world.
 */
function __buildTwitch_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const EventType = api.enums.EventType;
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const AttackableUnit = api.units.AttackableUnit;
  const Buff = api.buffs.Buff;
  const Twitch_R_Bolt = makeTwitch_R_Bolt(api);
  class Twitch_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_twitch_r');
    name = 'Nhắm Mắt Bắn Bừa (Twitch_R)';
    description =
      `Trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${BONUS_RANGE} tầm đánh</span>,` +
      ` <span class="buff">+${BONUS_DAMAGE} sát thương đánh thường</span>,` +
      ` <span class="buff">+${Math.round(ATTACK_SPEED_PERCENT * 100)}% tốc độ đánh</span>,` +
      ` <span class="buff">+${ON_HIT_DAMAGE} sát thương mỗi đòn đánh</span>,` +
      ` và mỗi đòn đánh thường <span class="damage">xuyên qua mục tiêu</span> bắn tiếp` +
      ` <span class="damage">${BOLT_DAMAGE} sát thương</span> cho mọi kẻ địch phía sau`;
    coolDown = 10000;
    manaCost = 50;

    /** Unsubscribes the piercing passive; `undefined` until the first update wires it. */
    private stopWatching?: () => void;

    onUpdate(): void {
      // Wired here, not in the constructor: every spell is instantiated once with
      // a null owner to build the picker, and that instance has no game to
      // subscribe to and must never react to a real fight.
      if (this.stopWatching || !this.owner || !this.game?.eventManager) return;

      this.stopWatching = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          // the event is global; every Twitch on the map hears every attack
          if (attacker !== this.owner || !victim) return;
          if (!this.isActive) return;
          this.fireBolt(victim);
        }
      );
    }

    /** True only while the buff this spell applied is still on Twitch. */
    get isActive(): boolean {
      return (
        this.owner?.buffs?.some((buff: Buff) => buff.stackId === STACK_ID && !buff.toRemove) ?? false
      );
    }

    fireBolt(victim: AttackableUnit): void {
      const through = victim.position.copy().sub(this.owner.position);
      // A victim standing exactly on Twitch gives no direction; `Game.facing()`
      // is the convention for that, never a zero vector.
      const direction = through.magSq() === 0 ? this.game.facing(this.owner) : through;
      const { to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.owner.position.copy().add(direction),
        BOLT_RANGE
      );

      const bolt = new Twitch_R_Bolt(this.owner);
      bolt.destination = to;
      // The attack already billed this one; the bolt is for whoever is behind it.
      bolt.hitTargets.push(victim);
      this.game.objectManager.addObject(bolt);
    }

    onRemoved(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.onRemoved();
    }

    deactivate(): void {
      this.stopWatching?.();
      this.stopWatching = undefined;
      super.deactivate();
    }

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = STACK_ID;
      amp.image = this.image;
      amp.name = 'Vãi Đạn';
      amp.bonuses = {
        attackRange: { baseBonus: BONUS_RANGE },
        attackDamage: { baseBonus: BONUS_DAMAGE },
        attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
        onHitDamage: { baseBonus: ON_HIT_DAMAGE },
      };
      this.owner.addBuff(amp);
    }
  }
  return Twitch_R;
}
const __cacheTwitch_R = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_R>>();
export default function makeTwitch_R(api: ContentApi) {
  const cached = __cacheTwitch_R.get(api);
  if (cached) return cached;
  const built = __buildTwitch_R(api);
  __cacheTwitch_R.set(api, built);
  return built;
}


function __buildTwitch_R_Bolt(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Twitch_R_Pierce = makeTwitch_R_Pierce(api);
  class Twitch_R_Bolt extends MissileSpellObject {
    speed = 26;
    /**
     * The hitbox, and what it is drawn at. 14 was thinner than the champion body
     * it was supposed to punch through, so the signature of the ultimate — one
     * shot skewering a whole line — was invisible unless you already knew to look
     * for it.
     */
    size = 30;
    /** Infinity is the whole point: the bolt does not stop at the first body. */
    maxHitCount = Infinity;

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // A heavy round, and it gets heavier-looking the more it has already gone
      // through — the pierce count is the one thing the player wants to read off
      // this ability, so the bolt itself reports it.
      const heat = Math.min(this.hitTargets.length, 4) / 4;

      noStroke();
      // long muzzle-lit tracer
      fill(150, 240, 90, 70 + 60 * heat);
      rect(-74 - 24 * heat, -8, 86 + 24 * heat, 16, 8);
      fill(210, 255, 140, 150 + 60 * heat);
      rect(-52 - 18 * heat, -4.5, 64 + 18 * heat, 9, 5);
      // the slug
      fill(255, 255, 235, 250);
      rect(-14, -3.5, 30, 7, 4);
      // a hot nose cone, so the leading edge is unmistakable
      fill(190, 255, 120, 245);
      triangle(16, -6, 32, 0, 16, 6);

      // toxic wash bleeding off the flanks: this is Twitch, not a rifle round
      fill(120, 220, 70, 60 + 70 * heat);
      ellipse(-30, 0, 60 + 30 * heat, 22 + 12 * heat);
      pop();
    }

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(BOLT_DAMAGE, this.owner);
      // the burst is drawn per body, so a pierce through four is four separate
      // punches rather than one smear
      const splash = new Twitch_R_Pierce(this.owner, this.position.x, this.position.y);
      this.game.objectManager.addObject(splash);
    }

    getDisplayBoundingBox() {
      const r = 110;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Twitch_R_Bolt;
}
const __cacheTwitch_R_Bolt = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_R_Bolt>>();
export function makeTwitch_R_Bolt(api: ContentApi) {
  const cached = __cacheTwitch_R_Bolt.get(api);
  if (cached) return cached;
  const built = __buildTwitch_R_Bolt(api);
  __cacheTwitch_R_Bolt.set(api, built);
  return built;
}


/** One body punched through: a hard ring and a spray out the far side. */
function __buildTwitch_R_Pierce(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Twitch_R_Pierce extends SpellObject {
    age = 0;
    lifeTime = 260;

    constructor(owner: AttackableUnit, x: number, y: number) {
      super(owner);
      this.position = createVector(x, y);
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      push();
      translate(this.position.x, this.position.y);
      const flash = 1 - constrain(t / 0.3, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(240, 255, 210, 235 * flash);
        circle(0, 0, 26 * (1 - flash) + 10);
      }
      noFill();
      stroke(170, 250, 110, 235 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, 18 + 54 * t);
      stroke(90, 190, 60, 180 * fade);
      strokeWeight(2);
      circle(0, 0, 10 + 34 * t);
      pop();
    }

    getDisplayBoundingBox() {
      const r = 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Twitch_R_Pierce;
}
const __cacheTwitch_R_Pierce = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_R_Pierce>>();
export function makeTwitch_R_Pierce(api: ContentApi) {
  const cached = __cacheTwitch_R_Pierce.get(api);
  if (cached) return cached;
  const built = __buildTwitch_R_Pierce(api);
  __cacheTwitch_R_Pierce.set(api, built);
  return built;
}