import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Sett_Q = InstanceType<ReturnType<typeof makeSett_Q>>;
type Sett_Q_Glow = InstanceType<ReturnType<typeof makeSett_Q_Glow>>;
type Sett_Q_Knuckle = InstanceType<ReturnType<typeof makeSett_Q_Knuckle>>;



export const SETT_Q_HITS = 2;

export const SETT_Q_WINDOW_MS = 5_000;

export const SETT_Q_BONUS = 10;

export const SETT_Q_ATTACK_SPEED = 0.25;

/** How far the knuckle ring on a punched body opens. */
export const SETT_Q_RING_RADIUS = 46;


const KNUCKLE_LIFE_MS = 300;

const HOT: [number, number, number] = [225, 112, 85];

const BLOOD: [number, number, number] = [183, 21, 64];


/**
 * Arms the next two basic attacks. The swing itself is never reimplemented — the
 * spell listens on EventType.ON_ATTACK_HIT, which combat/BasicAttack.ts emits
 * once per landed basic attack, and adds its bonus on top of what already landed.
 */
function __buildSett_Q(api: ContentApi) {
  const EventType = api.enums.EventType;
  const AttackableUnit = api.units.AttackableUnit;
  const StatAmp = api.buffs.StatAmp;
  const Spell = api.Spell;
  const Sett_Q_Glow = makeSett_Q_Glow(api);
  const Sett_Q_Knuckle = makeSett_Q_Knuckle(api);
  class Sett_Q extends Spell {
    image = api.asset('spell_sett_q');
    name = 'Không Trượt Phát Nào (Sett_Q)';
    description =
      `Nắm tay rực lửa: ${SETT_Q_HITS} đòn đánh thường tiếp theo trong ` +
      `${SETT_Q_WINDOW_MS / 1000} giây gây thêm <span class="damage">${SETT_Q_BONUS} sát thương</span>, ` +
      `và Sett được +${Math.round(SETT_Q_ATTACK_SPEED * 100)}% tốc độ đánh trong suốt thời gian đó.`;
    coolDown = 7_000;
    manaCost = 20;

    /** Armed punches still to spend. Drives the HUD badge and the fist glow. */
    chargesLeft = 0;
    /** What is left of the arming window, in ms. */
    windowLeftMs = 0;

    private unhook: (() => void) | null = null;
    private glow: Sett_Q_Glow | null = null;
    private amp: StatAmp | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.coolDown },
      };
    }

    get stackCount(): number | undefined {
      return this.chargesLeft > 0 ? this.chargesLeft : undefined;
    }

    onSpellCast(): void {
      this.chargesLeft = SETT_Q_HITS;
      this.windowLeftMs = SETT_Q_WINDOW_MS;

      if (!this.unhook) {
        this.unhook = this.game.eventManager.on(EventType.ON_ATTACK_HIT, this.onPunchLanded);
      }

      if (this.amp && !this.amp.toRemove) this.amp.deactivateBuff();
      const amp = new StatAmp(SETT_Q_WINDOW_MS, this.owner, this.owner);
      amp.stackId = 'sett_q_iron_fists';
      amp.bonuses = { attackSpeed: { baseBonus: SETT_Q_ATTACK_SPEED } };
      this.owner.addBuff(amp);
      this.amp = amp;

      if (!this.glow || this.glow.toRemove) {
        const glow = new Sett_Q_Glow(this.owner, this);
        this.glow = glow;
        this.game.objectManager.addObject(glow);
      }
    }

    onUpdate(): void {
      if (this.windowLeftMs <= 0) return;
      this.windowLeftMs -= deltaTime;
      if (this.windowLeftMs <= 0) this.endWindow();
    }

    onRemoved(): void {
      super.onRemoved();
      this.endWindow();
    }

    /**
     * The payload is combat/BasicAttack.ts's BasicAttackHit. Events are global, so
     * the attacker check is what keeps every other champion's swing out of here.
     */
    private onPunchLanded = (hit: { attacker?: unknown; victim?: AttackableUnit } | undefined) => {
      if (!hit || hit.attacker !== this.owner) return;
      if (this.chargesLeft <= 0) return;
      const victim = hit.victim;
      if (!victim || victim.isDead || victim.toRemove) return;

      this.chargesLeft -= 1;
      victim.takeDamage(SETT_Q_BONUS, this.owner);
      this.game.objectManager.addObject(new Sett_Q_Knuckle(this.owner, victim.position.copy()));
      if (this.chargesLeft <= 0) this.dropGlow();
    };

    private endWindow(): void {
      this.windowLeftMs = 0;
      this.chargesLeft = 0;
      this.dropGlow();
      if (this.unhook) {
        this.unhook();
        this.unhook = null;
      }
    }

    private dropGlow(): void {
      if (!this.glow) return;
      this.glow.toRemove = true;
      this.glow = null;
    }
  }
  return Sett_Q;
}
const __cacheSett_Q = new WeakMap<ContentApi, ReturnType<typeof __buildSett_Q>>();
export default function makeSett_Q(api: ContentApi) {
  const cached = __cacheSett_Q.get(api);
  if (cached) return cached;
  const built = __buildSett_Q(api);
  __cacheSett_Q.set(api, built);
  return built;
}


/**
 * The pair of burning fists. Body-local, but a SpellObject rather than caster
 * vfx so it keeps its own draw slot while the spell that owns it is idle.
 */
function __buildSett_Q_Glow(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Sett_Q_Glow extends SpellObject {
    age = 0;
    /** Seeded once: random() inside draw() flickers instead of animating. */
    embers: { angle: number; reach: number; phase: number }[] = [];

    private spell: Sett_Q;

    constructor(owner: AttackableUnit, spell: Sett_Q) {
      super(owner);
      this.spell = spell;
      this.attachTo(owner);
    }

    onAdded(): void {
      for (let i = 0; i < 6; i++) {
        this.embers.push({
          angle: random(TWO_PI),
          reach: random(16, 30),
          phase: random(TWO_PI),
        });
      }
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      if (this.spell.chargesLeft <= 0) this.toRemove = true;
    }

    draw(): void {
      const pulse = 0.5 + 0.5 * sin(this.age / 130);
      const body = this.owner.animatedValues.displaySize * 0.5 || 27;
      push();
      rectMode(CORNER);
      translate(this.position.x, this.position.y);
      noStroke();
      // one fat knuckle box per remaining charge, left and right of his hips
      for (let side = -1; side <= 1; side += 2) {
        const fistX = side * body * 0.82;
        const fistY = body * 0.18;
        fill(BLOOD[0], BLOOD[1], BLOOD[2], 150 + 60 * pulse);
        rect(fistX - 9, fistY - 8, 18, 16, 3);
        fill(HOT[0], HOT[1], HOT[2], 180 + 70 * pulse);
        rect(fistX - 6, fistY - 5, 12, 10, 2);
      }
      stroke(HOT[0], HOT[1], HOT[2], 110 + 90 * pulse);
      strokeWeight(2);
      for (const ember of this.embers) {
        const lift = ember.reach * (0.6 + 0.4 * sin(this.age / 200 + ember.phase));
        const ex = cos(ember.angle) * body * 0.8;
        line(ex, body * 0.2, ex, body * 0.2 - lift);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(180);
    }
  }
  return Sett_Q_Glow;
}
const __cacheSett_Q_Glow = new WeakMap<ContentApi, ReturnType<typeof __buildSett_Q_Glow>>();
export function makeSett_Q_Glow(api: ContentApi) {
  const cached = __cacheSett_Q_Glow.get(api);
  if (cached) return cached;
  const built = __buildSett_Q_Glow(api);
  __cacheSett_Q_Glow.set(api, built);
  return built;
}


/** The count-down the player reads: one ring on each body an armed punch lands on. */
function __buildSett_Q_Knuckle(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Sett_Q_Knuckle extends SpellObject {
    lifeTime = KNUCKLE_LIFE_MS;
    age = 0;
    radius = SETT_Q_RING_RADIUS;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      push();
      rectMode(CORNER);
      translate(this.position.x, this.position.y);
      // a fat rim on the real radius, with a flat leading edge slab behind it
      noFill();
      stroke(HOT[0], HOT[1], HOT[2], 235 * fade);
      strokeWeight(6 * fade + 2);
      circle(0, 0, this.radius * 2 * opened);
      noStroke();
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 120 * fade);
      rect(-this.radius * 0.7 * opened, -7, this.radius * 1.4 * opened, 14, 3);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 24) * 2);
    }
  }
  return Sett_Q_Knuckle;
}
const __cacheSett_Q_Knuckle = new WeakMap<ContentApi, ReturnType<typeof __buildSett_Q_Knuckle>>();
export function makeSett_Q_Knuckle(api: ContentApi) {
  const cached = __cacheSett_Q_Knuckle.get(api);
  if (cached) return cached;
  const built = __buildSett_Q_Knuckle(api);
  __cacheSett_Q_Knuckle.set(api, built);
  return built;
}