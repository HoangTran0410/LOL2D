import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Vi_W = InstanceType<ReturnType<typeof makeVi_W>>;
type Vi_W_Buff = InstanceType<ReturnType<typeof makeVi_W_Buff>>;
type Vi_W_Fracture = InstanceType<ReturnType<typeof makeVi_W_Fracture>>;
type Vi_W_Shatter = InstanceType<ReturnType<typeof makeVi_W_Shatter>>;



export const W_DURATION_MS = 8_000;

export const W_STACKS = 3;

export const W_PROC = 16;

export const W_SLOW = 0.2;

export const W_SLOW_MS = 2_000;

export const W_ATTACK_SPEED = 0.5;

export const W_HASTE_MS = 4_000;


const BRASS: [number, number, number] = [225, 177, 44];

const HEXTECH: [number, number, number] = [0, 168, 255];


/**
 * Armour break, counted per victim.
 *
 * The count lives in a Map keyed by the unit, so switching targets never carries
 * progress across — two hits on one body and two on another is four swings and
 * no proc, which is the decision the ability actually asks the player to make.
 * The count is also drawn on the victim rather than in the HUD, because the
 * player is looking at the enemy when they decide whether to keep hitting them.
 */
function __buildVi_W(api: ContentApi) {
  const EventType = api.enums.EventType;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const StatAmp = api.buffs.StatAmp;
  const Spell = api.Spell;
  const Vi_W_Buff = makeVi_W_Buff(api);
  const Vi_W_Fracture = makeVi_W_Fracture(api);
  const Vi_W_Shatter = makeVi_W_Shatter(api);
  class Vi_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_vi_w');
    name = 'Cú Đấm Phá Giáp (Vi_W)';
    description = `Kích hoạt tăng <b>50% tốc đánh</b> trong ${W_DURATION_MS / 1000} giây. Mỗi ${W_STACKS} đòn đánh thường vào
      <b>cùng một mục tiêu</b> gây thêm <span class="damage">${W_PROC} sát thương</span> và
      làm chậm ${W_SLOW * 100}% trong ${W_SLOW_MS / 1000} giây.`;
    coolDown = 10_000;
    manaCost = 20;

    private hits = new Map<AttackableUnit, number>();
    private marks = new Map<AttackableUnit, Vi_W_Fracture>();
    private unsubscribe: (() => void) | null = null;
    private window: Vi_W_Buff | null = null;

    onSpellCast(): void {
      this.stop();

      const opened = new Vi_W_Buff(W_DURATION_MS, this.owner, this.owner);
      this.window = opened;
      opened.addDeactivateListener(() => this.stop());
      this.owner.addBuff(opened);

      const haste = new StatAmp(W_DURATION_MS, this.owner, this.owner);
      haste.bonuses = { attackSpeed: { baseBonus: 0.5 } };
      haste.stackId = 'vi_w_haste';
      this.owner.addBuff(haste);

      this.unsubscribe = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) =>
        this.onAttackLanded(hit)
      );
    }

    /** Every event is global, so the first thing to check is whose swing it was. */
    onAttackLanded(hit: BasicAttackHit): void {
      if (!hit || hit.attacker !== this.owner) return;
      const victim = hit.victim;
      if (!victim || victim.isDead || victim.toRemove) return;

      const counted = (this.hits.get(victim) ?? 0) + 1;
      if (counted >= W_STACKS) {
        this.hits.set(victim, 0);
        this.breakArmour(victim);
        return;
      }
      this.hits.set(victim, counted);
      this.showFractures(victim, counted);
    }

    private breakArmour(victim: AttackableUnit): void {
      victim.takeDamage(W_PROC, this.owner);

      const held = new Slow(W_SLOW_MS, this.owner, victim);
      held.percent = W_SLOW;
      held.stackId = 'vi_w_armour_break';
      victim.addBuff(held);

      const haste = new StatAmp(W_HASTE_MS, this.owner, this.owner);
      haste.bonuses = { attackSpeed: { baseBonus: W_ATTACK_SPEED } };
      haste.stackId = 'vi_w_haste';
      this.owner.addBuff(haste);

      this.clearMark(victim);
      this.game.objectManager.addObject(new Vi_W_Shatter(this.owner, victim.position.copy()));
    }

    private showFractures(victim: AttackableUnit, counted: number): void {
      let mark = this.marks.get(victim);
      if (!mark || mark.toRemove) {
        mark = new Vi_W_Fracture(this.owner, victim);
        this.marks.set(victim, mark);
        this.game.objectManager.addObject(mark);
      }
      mark.seams = counted;
    }

    private clearMark(victim: AttackableUnit): void {
      const mark = this.marks.get(victim);
      if (mark) mark.toRemove = true;
      this.marks.delete(victim);
    }

    /** Every cleanup path runs this: recast, expiry, death, scene exit. */
    private stop(): void {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.hits.clear();
      for (const mark of this.marks.values()) mark.toRemove = true;
      this.marks.clear();

      const opened = this.window;
      this.window = null;
      if (opened && !opened.toRemove) opened.deactivateBuff();
    }

    deactivate(): void {
      super.deactivate();
      this.stop();
    }

    onRemoved(): void {
      super.onRemoved();
      this.stop();
    }
  }
  return Vi_W;
}
const __cacheVi_W = new WeakMap<ContentApi, ReturnType<typeof __buildVi_W>>();
export default function makeVi_W(api: ContentApi) {
  const cached = __cacheVi_W.get(api);
  if (cached) return cached;
  const built = __buildVi_W(api);
  __cacheVi_W.set(api, built);
  return built;
}


/** The window itself: a timer with an icon, so the player can see it running out. */
function __buildVi_W_Buff(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class Vi_W_Buff extends Buff {
    name = 'Phá Giáp';
    image = api.asset('spell_vi_w');
  }
  return Vi_W_Buff;
}
const __cacheVi_W_Buff = new WeakMap<ContentApi, ReturnType<typeof __buildVi_W_Buff>>();
export function makeVi_W_Buff(api: ContentApi) {
  const cached = __cacheVi_W_Buff.get(api);
  if (cached) return cached;
  const built = __buildVi_W_Buff(api);
  __cacheVi_W_Buff.set(api, built);
  return built;
}


/**
 * The count, drawn on the victim's own body: one hairline fracture, then two.
 * It rides the unit, so it syncs position every frame and drops the moment the
 * body it is drawn on is gone.
 */
function __buildVi_W_Fracture(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Vi_W_Fracture extends SpellObject {
    /** How many hairlines to draw — 1 or 2; the third is a Vi_W_Shatter instead. */
    seams = 1;
    age = 0;
    radius = 44;
    private victim: AttackableUnit;
    private cracks: { angle: number; length: number; kink: number }[] = [];

    constructor(owner: AttackableUnit, victim: AttackableUnit) {
      super(owner);
      this.victim = victim;
      this.position = victim.position.copy();
      this.attachTo(victim);
    }

    onAdded(): void {
      for (let i = 0; i < 2; i++) {
        this.cracks.push({
          angle: random(0, TWO_PI),
          length: random(0.7, 1),
          kink: random(-0.5, 0.5),
        });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.victim.position.x, this.victim.position.y);
    }

    draw(): void {
      if (!this.cracks.length) return;
      const pulse = 0.7 + 0.3 * sin(this.age / 140);
      const half = this.victim.animatedValues.displaySize / 2 || this.radius;

      push();
      translate(this.position.x, this.position.y);
      for (let i = 0; i < this.seams && i < this.cracks.length; i++) {
        const crack = this.cracks[i];
        const reach = half * crack.length;
        stroke(BRASS[0], BRASS[1], BRASS[2], 210 * pulse);
        strokeWeight(2);
        line(
          Math.cos(crack.angle) * -reach,
          Math.sin(crack.angle) * -reach,
          Math.cos(crack.angle + crack.kink) * reach,
          Math.sin(crack.angle + crack.kink) * reach
        );
        stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 150 * pulse);
        strokeWeight(1);
        line(
          Math.cos(crack.angle) * -reach * 0.5,
          Math.sin(crack.angle) * -reach * 0.5 - 2,
          Math.cos(crack.angle + crack.kink) * reach * 0.8,
          Math.sin(crack.angle + crack.kink) * reach * 0.8 - 2
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Vi_W_Fracture;
}
const __cacheVi_W_Fracture = new WeakMap<ContentApi, ReturnType<typeof __buildVi_W_Fracture>>();
export function makeVi_W_Fracture(api: ContentApi) {
  const cached = __cacheVi_W_Fracture.get(api);
  if (cached) return cached;
  const built = __buildVi_W_Fracture(api);
  __cacheVi_W_Fracture.set(api, built);
  return built;
}


/** The third hit: the plating gives, and the shards leave the body outward. */
function __buildVi_W_Shatter(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Vi_W_Shatter extends SpellObject {
    lifeTime = 380;
    age = 0;
    radius = 70;
    private shards: { angle: number; length: number; width: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      for (let i = 0; i < 9; i++) {
        this.shards.push({
          angle: random(0, TWO_PI),
          length: random(0.5, 1),
          width: random(4, 9),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const flung = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);
      noStroke();
      for (const shard of this.shards) {
        const reach = this.radius * shard.length * flung;
        const cx = Math.cos(shard.angle) * reach;
        const cy = Math.sin(shard.angle) * reach;
        fill(BRASS[0], BRASS[1], BRASS[2], 235 * fade);
        push();
        translate(cx, cy);
        rotate(shard.angle);
        triangle(shard.width, 0, -shard.width, -shard.width * 0.5, -shard.width, shard.width * 0.5);
        pop();
      }
      stroke(HEXTECH[0], HEXTECH[1], HEXTECH[2], 220 * fade * fade);
      strokeWeight(3 * fade + 1);
      noFill();
      circle(0, 0, 18 + 34 * flung);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Vi_W_Shatter;
}
const __cacheVi_W_Shatter = new WeakMap<ContentApi, ReturnType<typeof __buildVi_W_Shatter>>();
export function makeVi_W_Shatter(api: ContentApi) {
  const cached = __cacheVi_W_Shatter.get(api);
  if (cached) return cached;
  const built = __buildVi_W_Shatter(api);
  __cacheVi_W_Shatter.set(api, built);
  return built;
}