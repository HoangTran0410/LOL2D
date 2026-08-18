import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Buff from '@/game/gameObject/Buff';
import Shield from '@/game/gameObject/buffs/Shield';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';

export const SETT_W_GRIT_RATIO = 0.5;
export const SETT_W_GRIT_MAX = 40;
export const SETT_W_GRIT_DECAY_MS = 4_000;
export const SETT_W_BASE = 20;
export const SETT_W_GRIT_SCALE = 0.5;
export const SETT_W_SHIELD_MS = 4_000;
export const SETT_W_LENGTH = 380;
export const SETT_W_WIDTH = 140;
export const SETT_W_CORE_LENGTH = 140;
export const SETT_W_WINDUP_MS = 250;

/** The listener buff is re-planted whenever it is missing, so its length is cosmetic. */
const LISTEN_MS = 60_000;
const PUNCH_LIFE_MS = 360;
const HOT: [number, number, number] = [225, 112, 85];
const BLOOD: [number, number, number] = [183, 21, 64];

/**
 * Sett's signature: he remembers the damage he has taken and throws it back.
 *
 * The remembering happens in Buff.onDamageTaken, which runs after the whole
 * modifyIncomingDamage chain — Sett does not change the number that lands on him,
 * so he must not be a damage modifier. Grit lives on the spell (not the buff) so
 * the HUD, the bar and the cast all read one number.
 */
export default class Sett_W extends Spell {
  image = AssetManager.get('spell_sett_w');
  name = 'Cuồng Thú Quyền (Sett_W)';
  description =
    `Sett tích <b>Nộ Khí</b> bằng ${Math.round(SETT_W_GRIT_RATIO * 100)}% sát thương phải nhận ` +
    `(tối đa ${SETT_W_GRIT_MAX}). Khi tung chưởng, toàn bộ Nộ Khí biến thành khiên và ` +
    `<span class="damage">${SETT_W_BASE} sát thương</span> cộng ` +
    `${Math.round(SETT_W_GRIT_SCALE * 100)}% Nộ Khí trong một hình chữ nhật dài ${SETT_W_LENGTH}. ` +
    `Phần lõi ${SETT_W_CORE_LENGTH} đầu tiên xuyên qua khiên của mục tiêu.`;
  coolDown = 10_000;
  manaCost = 40;
  range = SETT_W_LENGTH;

  /**
   * Each chunk remembers what it was worth and how long ago it landed; a chunk
   * fades linearly to nothing over SETT_W_GRIT_DECAY_MS.
   */
  gritChunks: { amount: number; age: number }[] = [];

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

  /** Grit available right now, after decay. Never above the cap. */
  get grit(): number {
    let total = 0;
    for (const chunk of this.gritChunks) {
      const left = 1 - chunk.age / SETT_W_GRIT_DECAY_MS;
      if (left > 0) total += chunk.amount * left;
    }
    return Math.min(total, SETT_W_GRIT_MAX);
  }

  get stackCount(): number | undefined {
    const banked = Math.floor(this.grit);
    return banked > 0 ? banked : undefined;
  }

  /** Called by the listener buff with SETT_W_GRIT_RATIO of what actually landed. */
  addGrit(amount: number): void {
    if (!(amount > 0)) return;
    const room = SETT_W_GRIT_MAX - this.grit;
    if (room <= 0) return;
    this.gritChunks.push({ amount: Math.min(amount, room), age: 0 });
  }

  onUpdate(): void {
    this.keepListening();
    this.keepBar();
    this.decayGrit();
  }

  onCastStart(context: CastContext): void {
    const aim = this.firingDirection(context);
    const telegraph = new Sett_W_Telegraph(this.owner, Math.atan2(aim.y, aim.x));
    this.game.objectManager.addObject(telegraph);
  }

  onSpellCast(context: CastContext): void {
    const spent = this.grit;
    this.gritChunks = [];

    if (spent > 0) {
      const guard = new Shield(SETT_W_SHIELD_MS, this.owner, this.owner);
      guard.amount = spent;
      guard.color = HOT;
      guard.stackId = 'sett_w_grit_shield';
      this.owner.addBuff(guard);
    }

    const aim = this.firingDirection(context);
    const heading = Math.atan2(aim.y, aim.x);
    const along = Math.cos(heading);
    const across = Math.sin(heading);
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

    // A plain loop: Array.prototype.filter cannot narrow here.
    const struck = new Set<AttackableUnit>();
    for (const victim of candidates) {
      if (struck.has(victim)) continue;
      const dx = victim.position.x - origin.x;
      const dy = victim.position.y - origin.y;
      const depth = dx * along + dy * across;
      const offset = -dx * across + dy * along;
      const pad = victim.collisionRadius;
      if (depth < -pad || depth > SETT_W_LENGTH + pad) continue;
      if (Math.abs(offset) > SETT_W_WIDTH / 2 + pad) continue;
      struck.add(victim);

      if (depth <= SETT_W_CORE_LENGTH + pad) {
        // The white-hot core is felt through a shield: swing for the shield as
        // well, so exactly `damage` reaches the body underneath it.
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
    if (this.gritChunks.length === 0) return;
    const alive: { amount: number; age: number }[] = [];
    for (const chunk of this.gritChunks) {
      chunk.age += deltaTime;
      if (chunk.age < SETT_W_GRIT_DECAY_MS) alive.push(chunk);
    }
    this.gritChunks = alive;
  }
}

/**
 * Pure listener: it never touches the damage, it only tells the spell what got
 * through. onDamageTaken runs after the whole modifier chain, so `landed` is the
 * number the player actually saw.
 */
export class Sett_W_Grit_Listener extends Buff {
  name = 'Nộ Khí';
  spell: Sett_W | null = null;

  onDamageTaken(_swung: number, landed: number): void {
    if (landed > 0) this.spell?.addGrit(landed * SETT_W_GRIT_RATIO);
  }
}

/** The chunky bar under his feet. Without it the player cannot play W. */
export class Sett_W_Grit_Bar extends SpellObject {
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

/** The windup: the box grows to full reach while he pulls the fist back. */
export class Sett_W_Telegraph extends SpellObject {
  /** Ground art: Z_INDEX_MAP is keyed by exact constructor, so a subclass must say so. */
  zIndex = 2;
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
    const grown = t * t; // wind-in easing: slow start, then the arm snaps
    const reach = SETT_W_LENGTH * grown;
    push();
    rectMode(CORNER);
    translate(this.position.x, this.position.y);
    rotate(this.heading);
    noFill();
    stroke(HOT[0], HOT[1], HOT[2], 90 + 90 * grown);
    strokeWeight(3);
    rect(0, -SETT_W_WIDTH / 2, reach, SETT_W_WIDTH, 4);
    // the flat leading edge, which is where the knuckles will arrive
    strokeWeight(6);
    line(reach, -SETT_W_WIDTH / 2, reach, SETT_W_WIDTH / 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((SETT_W_LENGTH + 60) * 2);
  }
}

/**
 * The punch itself. Two regions because they behave differently: a solid
 * white-hot core slab that is felt through a shield, and an open outlined band
 * behind it that is not.
 */
export class Sett_W_Punch extends SpellObject {
  /**
   * Ground art, at zIndex 2 rather than the 99 a SpellObject subclass falls
   * through to: the core is a solid slab, and at 99 it would paint over the very
   * body it just hit.
   */
  zIndex = 2;
  lifeTime = PUNCH_LIFE_MS;
  age = 0;
  radius = SETT_W_LENGTH;
  /** Seeded once in onAdded — random() inside draw() flickers instead of animating. */
  cracks: { depth: number; offset: number; tilt: number; span: number }[] = [];

  private heading: number;
  private grit: number;

  constructor(owner: AttackableUnit, heading: number, grit: number) {
    super(owner);
    this.heading = heading;
    this.grit = grit;
  }

  onAdded(): void {
    for (let i = 0; i < 9; i++) {
      this.cracks.push({
        depth: random(20, SETT_W_LENGTH),
        offset: random(-SETT_W_WIDTH / 2, SETT_W_WIDTH / 2),
        tilt: random(-0.7, 0.7),
        span: random(16, 40),
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
    const heat = 0.4 + 0.6 * constrain(this.grit / SETT_W_GRIT_MAX, 0, 1);
    push();
    rectMode(CORNER);
    translate(this.position.x, this.position.y);
    rotate(this.heading);

    // outer band: open box, ordinary damage
    noFill();
    stroke(BLOOD[0], BLOOD[1], BLOOD[2], 230 * fade);
    strokeWeight(5 * fade + 2);
    const reach = SETT_W_CORE_LENGTH + (SETT_W_LENGTH - SETT_W_CORE_LENGTH) * opened;
    rect(SETT_W_CORE_LENGTH, -SETT_W_WIDTH / 2, reach - SETT_W_CORE_LENGTH, SETT_W_WIDTH, 4);

    // core: one solid white-hot slab, at exactly the length that ignores shields
    noStroke();
    fill(255, 236 - 40 * (1 - heat), 214 - 60 * (1 - heat), 210 * fade);
    rect(0, -SETT_W_WIDTH / 2, SETT_W_CORE_LENGTH, SETT_W_WIDTH, 4);
    fill(HOT[0], HOT[1], HOT[2], 235 * fade * heat);
    rect(6, -SETT_W_WIDTH / 2 + 6, SETT_W_CORE_LENGTH - 12, SETT_W_WIDTH - 12, 3);

    // radial speed lines down the whole punch, and cracked ground under it
    stroke(255, 214, 190, 200 * fade);
    strokeWeight(3);
    for (const crack of this.cracks) {
      const at = crack.depth * opened;
      line(at, crack.offset, at + crack.span * cos(crack.tilt), crack.offset + crack.span * 0.4);
    }

    // the flat leading edge: the knuckle face
    stroke(255, 244, 226, 245 * fade);
    strokeWeight(8 * fade + 2);
    line(reach, -SETT_W_WIDTH / 2, reach, SETT_W_WIDTH / 2);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((SETT_W_LENGTH + 60) * 2);
  }
}
