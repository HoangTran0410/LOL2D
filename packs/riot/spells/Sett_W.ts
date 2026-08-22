import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Sett_W = InstanceType<ReturnType<typeof makeSett_W>>;
type Sett_W_Grit_Bar = InstanceType<ReturnType<typeof makeSett_W_Grit_Bar>>;
type Sett_W_Grit_Listener = InstanceType<ReturnType<typeof makeSett_W_Grit_Listener>>;
type Sett_W_Punch = InstanceType<ReturnType<typeof makeSett_W_Punch>>;
type Sett_W_Telegraph = InstanceType<ReturnType<typeof makeSett_W_Telegraph>>;



export const SETT_W_GRIT_RATIO = 1.0;

export const SETT_W_GRIT_MAX = 100;

export const SETT_W_GRIT_DECAY_MS = 3_000;

export const SETT_W_BASE = 28;

export const SETT_W_GRIT_SCALE = 0.8;

export const SETT_W_SHIELD_MS = 3_000;

export const SETT_W_LENGTH = 420;

export const SETT_W_CONE_DEG = 75;

export const SETT_W_CONE_RAD = (SETT_W_CONE_DEG * Math.PI) / 180;

export const SETT_W_CORE_WIDTH = 90;

export const SETT_W_WINDUP_MS = 450;


/** The listener buff is re-planted whenever it is missing, so its length is cosmetic. */
const LISTEN_MS = 60_000;

const PUNCH_LIFE_MS = 400;

const HOT: [number, number, number] = [255, 140, 0];

const GOLD: [number, number, number] = [255, 215, 0];

const BLOOD: [number, number, number] = [183, 21, 64];


/**
 * Sett's signature: he remembers the damage he has taken and throws it back.
 *
 * The remembering happens in Buff.onDamageTaken, which runs after the whole
 * modifyIncomingDamage chain — Sett does not change the number that lands on him,
 * so he must not be a damage modifier. Grit lives on the spell (not the buff) so
 * the HUD, the bar and the cast all read one number.
 */
function __buildSett_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Shield = api.buffs.Shield;
  const Spell = api.Spell;
  const Sett_W_Grit_Listener = makeSett_W_Grit_Listener(api);
  const Sett_W_Grit_Bar = makeSett_W_Grit_Bar(api);
  const Sett_W_Telegraph = makeSett_W_Telegraph(api);
  const Sett_W_Punch = makeSett_W_Punch(api);
  class Sett_W extends Spell {
    image = api.asset('spell_sett_w');
    name = 'Cuồng Thú Quyền (Sett_W)';
    description =
      `Sett tích <b>Nộ Khí</b> bằng 100% mọi sát thương nhận vào (không giới hạn tối đa). ` +
      `Sau 3 giây không nhận sát thương, Nộ Khí mới bắt đầu suy giảm. ` +
      `Khi kích hoạt chiêu, Sett lập tức nhận lá chắn bằng toàn bộ Nộ Khí trong 3 giây ` +
      `và tung đòn đánh hình cánh quạt ${SETT_W_CONE_DEG}° tầm ${SETT_W_LENGTH} gây ` +
      `<span class="damage">${SETT_W_BASE} sát thương</span> cộng ` +
      `${Math.round(SETT_W_GRIT_SCALE * 100)}% Nộ Khí (dải trung tâm gây sát thương chuẩn).`;
    coolDown = 10_000;
    manaCost = 40;
    range = SETT_W_LENGTH;

    /**
     * Each chunk remembers what it was worth.
     */
    gritChunks: { amount: number }[] = [];
    timeSinceDamage = 0;
    private castGrit = 0;

    private bar: Sett_W_Grit_Bar | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: SETT_W_WINDUP_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    /** Grit available right now, uncapped, decaying only after 3s of no incoming damage. */
    get grit(): number {
      let total = 0;
      for (const chunk of this.gritChunks) {
        total += chunk.amount;
      }
      if (this.timeSinceDamage >= SETT_W_GRIT_DECAY_MS) {
        const decayProgress = (this.timeSinceDamage - SETT_W_GRIT_DECAY_MS) / SETT_W_GRIT_DECAY_MS;
        const left = Math.max(0, 1 - decayProgress);
        total *= left;
      }
      return Math.max(0, total);
    }

    get stackCount(): number | undefined {
      const banked = Math.floor(this.grit);
      return banked > 0 ? banked : undefined;
    }

    /** Called by the listener buff: adds 100% of damage taken, resetting the decay timer. */
    addGrit(amount: number): void {
      if (!(amount > 0)) return;
      this.gritChunks.push({ amount });
      this.timeSinceDamage = 0;
    }

    onUpdate(): void {
      this.keepListening();
      this.keepBar();
      this.decayGrit();
    }

    onCastStart(context: CastContext): void {
      this.castGrit = this.grit;
      this.gritChunks = [];
      this.timeSinceDamage = 0;

      if (this.castGrit > 0) {
        const guard = new Shield(SETT_W_SHIELD_MS, this.owner, this.owner);
        guard.amount = this.castGrit;
        guard.color = [255, 170, 0];
        guard.stackId = 'sett_w_grit_shield';
        this.owner.addBuff(guard);
      }

      const aim = this.firingDirection(context);
      const telegraph = new Sett_W_Telegraph(this.owner, Math.atan2(aim.y, aim.x));
      this.game.objectManager.addObject(telegraph);
    }

    onSpellCast(context: CastContext): void {
      const spent = this.castGrit;

      const aim = this.firingDirection(context);
      const heading = Math.atan2(aim.y, aim.x);
      const damage = SETT_W_BASE + SETT_W_GRIT_SCALE * spent;
      const origin = this.owner.position;

      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: origin.x,
          y: origin.y,
          r: effectiveRange(SETT_W_LENGTH, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const struck = new Set<AttackableUnit>();
      for (const victim of candidates) {
        if (struck.has(victim) || victim.isDead || victim.toRemove) continue;
        const dx = victim.position.x - origin.x;
        const dy = victim.position.y - origin.y;
        const dist = Math.hypot(dx, dy);
        const pad = victim.collisionRadius || 20;
        if (dist > SETT_W_LENGTH + pad) continue;

        const angle = Math.atan2(dy, dx);
        let diff = angle - heading;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        if (Math.abs(diff) > SETT_W_CONE_RAD / 2 + pad / Math.max(dist, 1)) continue;
        struck.add(victim);

        const lateral = Math.abs(-dx * Math.sin(heading) + dy * Math.cos(heading));
        if (lateral <= SETT_W_CORE_WIDTH / 2 + pad) {
          // True damage piercing shields along center strip
          victim.takeDamage(damage + victim.shieldAmount, this.owner);
        } else {
          victim.takeDamage(damage, this.owner);
        }
      }

      const punch = new Sett_W_Punch(this.owner, heading, spent);
      this.game.objectManager.addObject(punch);
    }

    onRemoved(): void {
      super.onRemoved();
      if (this.bar) {
        this.bar.toRemove = true;
        this.bar = null;
      }
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    private keepListening(): void {
      for (const buff of this.owner.buffs) {
        if (buff.toRemove) continue;
        if (!(buff instanceof Sett_W_Grit_Listener)) continue;
        buff.spell = this;
        if (buff.timeElapsed > LISTEN_MS * 0.5) buff.renewBuff();
        return;
      }
      const listener = new Sett_W_Grit_Listener(LISTEN_MS, this.owner, this.owner);
      listener.spell = this;
      this.owner.addBuff(listener);
    }

    private keepBar(): void {
      if (this.bar && !this.bar.toRemove) return;
      const bar = new Sett_W_Grit_Bar(this.owner, this);
      this.bar = bar;
      this.game.objectManager.addObject(bar);
    }

    private decayGrit(): void {
      this.timeSinceDamage += deltaTime;
      if (this.gritChunks.length === 0) return;
      if (this.timeSinceDamage >= SETT_W_GRIT_DECAY_MS * 2) {
        this.gritChunks = [];
      }
    }
  }
  return Sett_W;
}
const __cacheSett_W = new WeakMap<ContentApi, ReturnType<typeof __buildSett_W>>();
export default function makeSett_W(api: ContentApi) {
  const cached = __cacheSett_W.get(api);
  if (cached) return cached;
  const built = __buildSett_W(api);
  __cacheSett_W.set(api, built);
  return built;
}


/**
 * Pure listener: it never touches the damage, it only tells the spell what got
 * through. onDamageTaken runs after the whole modifier chain, so `landed` is the
 * number the player actually saw.
 */
function __buildSett_W_Grit_Listener(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class Sett_W_Grit_Listener extends Buff {
    name = 'Nộ Khí';
    spell: Sett_W | null = null;

    onDamageTaken(_swung: number, landed: number): void {
      if (landed > 0) this.spell?.addGrit(landed * SETT_W_GRIT_RATIO);
    }
  }
  return Sett_W_Grit_Listener;
}
const __cacheSett_W_Grit_Listener = new WeakMap<ContentApi, ReturnType<typeof __buildSett_W_Grit_Listener>>();
export function makeSett_W_Grit_Listener(api: ContentApi) {
  const cached = __cacheSett_W_Grit_Listener.get(api);
  if (cached) return cached;
  const built = __buildSett_W_Grit_Listener(api);
  __cacheSett_W_Grit_Listener.set(api, built);
  return built;
}


/** The chunky bar under his feet. Without it the player cannot play W. */
function __buildSett_W_Grit_Bar(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Sett_W_Grit_Bar extends SpellObject {
    shown = 0;

    private spell: Sett_W;

    constructor(owner: AttackableUnit, spell: Sett_W) {
      super(owner);
      this.spell = spell;
      this.attachTo(owner);
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      const wanted = this.spell.grit > 0 ? 1 : 0;
      this.shown += (wanted - this.shown) * 0.14;
    }

    draw(): void {
      if (this.shown < 0.03) return;
      const filled = constrain(this.spell.grit / SETT_W_GRIT_MAX, 0, 1);
      const barWide = 76;
      const barTall = 13;
      const body = this.owner.animatedValues.displaySize * 0.5 || 27;
      push();
      rectMode(CORNER);
      translate(this.position.x - barWide / 2, this.position.y + body + 12);
      noStroke();
      fill(24, 16, 14, 205 * this.shown);
      rect(-3, -3, barWide + 6, barTall + 6, 3);
      fill(52, 34, 30, 235 * this.shown);
      rect(0, 0, barWide, barTall, 2);
      // one solid slab, no gradient: heavy and rectangular, like the rest of him
      fill(HOT[0], HOT[1], HOT[2], 250 * this.shown);
      rect(0, 0, barWide * filled, barTall, 2);
      fill(BLOOD[0], BLOOD[1], BLOOD[2], 190 * this.shown);
      rect(0, barTall * 0.62, barWide * filled, barTall * 0.38, 2);
      // notches every quarter so the player reads how close to full he is
      fill(18, 12, 10, 170 * this.shown);
      for (let notch = 1; notch < 4; notch++) {
        rect((barWide * notch) / 4 - 1, 0, 2, barTall);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(200);
    }
  }
  return Sett_W_Grit_Bar;
}
const __cacheSett_W_Grit_Bar = new WeakMap<ContentApi, ReturnType<typeof __buildSett_W_Grit_Bar>>();
export function makeSett_W_Grit_Bar(api: ContentApi) {
  const cached = __cacheSett_W_Grit_Bar.get(api);
  if (cached) return cached;
  const built = __buildSett_W_Grit_Bar(api);
  __cacheSett_W_Grit_Bar.set(api, built);
  return built;
}


/** The windup: the cone sector grows to full reach while he pulls the fist back. */
function __buildSett_W_Telegraph(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Sett_W_Telegraph extends SpellObject {
    /** Ground art: Z_INDEX_MAP is keyed by exact constructor, so a subclass must say so. */
    zIndex = GROUND_Z_INDEX;
    lifeTime = SETT_W_WINDUP_MS;
    age = 0;

    private heading: number;

    constructor(owner: AttackableUnit, heading: number) {
      super(owner);
      this.heading = heading;
      this.attachTo(owner);
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const grown = t * t; // wind-in easing
      const reach = SETT_W_LENGTH * grown;
      const halfAngle = SETT_W_CONE_RAD / 2;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // 1. Expanding cone sector outline and fill
      fill(HOT[0], HOT[1], HOT[2], 25 + 50 * grown);
      stroke(GOLD[0], GOLD[1], GOLD[2], 120 + 130 * grown);
      strokeWeight(2.5);
      arc(0, 0, reach * 2, reach * 2, -halfAngle, halfAngle, PIE);

      // 2. Center true-damage strip indicator
      fill(255, 255, 255, 45 * grown);
      noStroke();
      rect(0, -SETT_W_CORE_WIDTH / 2, reach, SETT_W_CORE_WIDTH);

      // 3. Leading arc rim
      noFill();
      stroke(255, 230, 180, 230 * grown);
      strokeWeight(5);
      arc(0, 0, reach * 2, reach * 2, -halfAngle, halfAngle);

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SETT_W_LENGTH + 60) * 2);
    }
  }
  return Sett_W_Telegraph;
}
const __cacheSett_W_Telegraph = new WeakMap<ContentApi, ReturnType<typeof __buildSett_W_Telegraph>>();
export function makeSett_W_Telegraph(api: ContentApi) {
  const cached = __cacheSett_W_Telegraph.get(api);
  if (cached) return cached;
  const built = __buildSett_W_Telegraph(api);
  __cacheSett_W_Telegraph.set(api, built);
  return built;
}


/**
 * The punch itself. Blasts the full cone sector with golden flame, with an intense
 * true-damage laser strip along the center.
 */
function __buildSett_W_Punch(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Sett_W_Punch extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    lifeTime = PUNCH_LIFE_MS;
    age = 0;
    radius = SETT_W_LENGTH;
    cracks: { depth: number; offset: number; tilt: number; span: number }[] = [];

    private heading: number;
    private grit: number;

    constructor(owner: AttackableUnit, heading: number, grit: number) {
      super(owner);
      this.heading = heading;
      this.grit = grit;
    }

    onAdded(): void {
      for (let i = 0; i < 12; i++) {
        this.cracks.push({
          depth: random(30, SETT_W_LENGTH * 0.95),
          offset: random(-SETT_W_CORE_WIDTH * 1.5, SETT_W_CORE_WIDTH * 1.5),
          tilt: random(-0.7, 0.7),
          span: random(20, 55),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const heat = 0.5 + 0.5 * constrain(this.grit / SETT_W_GRIT_MAX, 0, 1);
      const halfAngle = SETT_W_CONE_RAD / 2;
      const reach = SETT_W_LENGTH * opened;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // 1. Blazing cone sector shockwave
      fill(HOT[0], HOT[1], HOT[2], 65 * fade * heat);
      stroke(GOLD[0], GOLD[1], GOLD[2], 240 * fade);
      strokeWeight(4 * fade + 1.5);
      arc(0, 0, reach * 2, reach * 2, -halfAngle, halfAngle, PIE);

      // 2. Core true-damage blast beam along the center
      noStroke();
      fill(255, 245, 220, 230 * fade * heat);
      rect(0, -SETT_W_CORE_WIDTH / 2, reach, SETT_W_CORE_WIDTH, 4);
      fill(255, 255, 255, 250 * fade);
      rect(0, -SETT_W_CORE_WIDTH / 4, reach, SETT_W_CORE_WIDTH / 2, 2);

      // 3. Ground cracks and ember sparks
      stroke(255, 200, 120, 220 * fade);
      strokeWeight(2.5);
      for (const crack of this.cracks) {
        const at = crack.depth * opened;
        line(at, crack.offset, at + crack.span * cos(crack.tilt), crack.offset + crack.span * 0.4);
      }

      // 4. Heavy outer rim impact shockwave
      noFill();
      stroke(255, 255, 255, 250 * fade);
      strokeWeight(7 * fade + 2);
      arc(0, 0, reach * 2, reach * 2, -halfAngle, halfAngle);

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SETT_W_LENGTH + 60) * 2);
    }
  }
  return Sett_W_Punch;
}
const __cacheSett_W_Punch = new WeakMap<ContentApi, ReturnType<typeof __buildSett_W_Punch>>();
export function makeSett_W_Punch(api: ContentApi) {
  const cached = __cacheSett_W_Punch.get(api);
  if (cached) return cached;
  const built = __buildSett_W_Punch(api);
  __cacheSett_W_Punch.set(api, built);
  return built;
}