import AssetManager from '../../../managers/AssetManager';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import BuffAddType from '../../enums/BuffAddType';
import EventType from '../../enums/EventType';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

/** How long Silver Bolts stays armed. */
export const VAYNE_W_DURATION_MS = 8_000;
/** Hits on the *same* victim needed to proc. */
export const VAYNE_W_STACKS = 3;
/** Extra damage the proc deals. */
export const VAYNE_W_PROC = 22;

/** How high above the body the tally sits. */
const MARK_LIFT = 34;
/** How far past its centre the tally paints. */
const MARK_REACH = 56;
/** How long the proc ring takes to open and go. */
const PROC_MS = 420;
/** How far past its centre the proc ring paints. */
const PROC_REACH = 76;

/**
 * Silver Bolts — a per-victim on-hit counter, not a damage spell.
 *
 * The counter is a `Map` keyed by the unit, so walking off one target and onto
 * another carries nothing over. That is the mechanic rather than a limitation,
 * and it is why the tally has to be legible *on the victim*: the player counts
 * two silver triangles over a body, not a number in a panel.
 */
export default class Vayne_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_vayne_w');
  name = 'Mũi Tên Bạc (Vayne_W)';
  description = `Trong ${VAYNE_W_DURATION_MS / 1000} giây, mỗi ${VAYNE_W_STACKS} đòn đánh thường
    vào <b>cùng một mục tiêu</b> gây thêm
    <span class="damage">${VAYNE_W_PROC} sát thương</span>. Đổi mục tiêu là mất đếm.`;
  coolDown = 10_000;
  manaCost = 40;

  onSpellCast(): void {
    this.owner.addBuff(new Vayne_W_Buff(VAYNE_W_DURATION_MS, this.owner, this.owner));
  }
}

/** One victim's row in the tally: how many hits it has taken, and its marker. */
interface BoltTally {
  hits: number;
  mark: Vayne_W_Mark | null;
}

/**
 * The armed window. Subscribes once and stays subscribed for its whole life —
 * unsubscribing from inside the callback would splice the subscriber array while
 * `EventManager.emit` is iterating it and skip whichever listener sat next.
 */
export class Vayne_W_Buff extends Buff {
  name = 'Mũi Tên Bạc';
  description = 'Ba mũi vào cùng một mục tiêu.';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  private tally = new Map<AttackableUnit, BoltTally>();
  private unsubscribe: (() => void) | null = null;

  onActivate(): void {
    this.unsubscribe = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) =>
      this.onBoltLanded(hit)
    );
  }

  onDeactivate(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const row of this.tally.values()) {
      if (row.mark) row.mark.toRemove = true;
    }
    this.tally.clear();
  }

  private onBoltLanded(hit: BasicAttackHit): void {
    if (!hit) return;
    // Every event is global, so the attacker filter is the whole subscription.
    if (hit.attacker !== this.targetUnit) return;

    const victim = hit.victim;
    if (!victim || victim === this.targetUnit || victim.isDead) return;

    const row = this.tally.get(victim) ?? { hits: 0, mark: null };
    row.hits += 1;
    this.tally.set(victim, row);

    if (row.hits >= VAYNE_W_STACKS) {
      row.hits = 0;
      if (row.mark) {
        row.mark.toRemove = true;
        row.mark = null;
      }
      victim.takeDamage(VAYNE_W_PROC, this.sourceUnit);
      this.game.objectManager.addObject(new Vayne_W_Proc(this.sourceUnit, victim));
      return;
    }

    if (!row.mark || row.mark.toRemove) {
      row.mark = new Vayne_W_Mark(this.sourceUnit, victim);
      this.game.objectManager.addObject(row.mark);
    }
    row.mark.showStacks(row.hits);
  }
}

/**
 * The running tally, riding the victim's body: one small silver triangle per
 * landed bolt. Attached to the unit rather than to the buff, because the buff
 * lives on Vayne and `attachTo`'s buff watch looks for it on the *anchor* — the
 * marker's lifetime against the window is the buff's own `onDeactivate`.
 */
export class Vayne_W_Mark extends SpellObject {
  stacks = 0;
  /** One age per drawn triangle, so each pops in on its own clock. */
  stackAges: number[] = [];
  private victim: AttackableUnit;

  constructor(owner: AttackableUnit, victim: AttackableUnit) {
    super(owner);
    this.victim = victim;
    this.attachTo(victim);
    this.position.set(victim.position.x, victim.position.y);
  }

  /** Brings the drawn count in line with the tally, keeping existing ages. */
  showStacks(count: number): void {
    while (this.stackAges.length < count) this.stackAges.push(0);
    while (this.stackAges.length > count) this.stackAges.pop();
    this.stacks = count;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.victim.position.x, this.victim.position.y);
    for (let i = 0; i < this.stackAges.length; i++) this.stackAges[i] += deltaTime;
  }

  draw(): void {
    const bodySize = this.victim.animatedValues.displaySize || this.victim.stats.size.value;
    const lift = bodySize * 0.5 + MARK_LIFT * 0.5;
    const spread = 11;

    push();
    translate(this.position.x, this.position.y - lift);
    noStroke();
    for (let i = 0; i < this.stackAges.length; i++) {
      // Each triangle winds in with t*t from its own birth, so the second one
      // arriving is visibly a second one arriving.
      const t = constrain(this.stackAges[i] / 180, 0, 1);
      const grown = t * t;
      const slot = (i - (this.stackAges.length - 1) / 2) * spread * 2;
      const half = 4 + 4 * grown;

      fill(236, 240, 241, 235 * grown);
      triangle(slot, -half, slot - half, half, slot + half, half);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((MARK_REACH + MARK_LIFT) * 2);
  }
}

/**
 * The proc: the tally is gone and one silver ring opens on the victim's body.
 * Different region, different shape, on the target — a player must not have to
 * guess which of the two things just happened.
 */
export class Vayne_W_Proc extends SpellObject {
  lifeTime = PROC_MS;
  age = 0;
  private victim: AttackableUnit;

  constructor(owner: AttackableUnit, victim: AttackableUnit) {
    super(owner);
    this.victim = victim;
    this.attachTo(victim);
    this.position.set(victim.position.x, victim.position.y);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.victim.position.x, this.victim.position.y);
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    const bodySize = this.victim.animatedValues.displaySize || this.victim.stats.size.value;
    // The hard rim sits on the body it hit, not on some larger decorative circle.
    const reach = bodySize * 0.6 + (PROC_REACH - bodySize * 0.6) * opened;

    push();
    noFill();
    stroke(236, 240, 241, 240 * fade);
    strokeWeight(4 * fade + 1.5);
    circle(this.position.x, this.position.y, reach * 2);
    stroke(44, 62, 80, 170 * fade);
    strokeWeight(2);
    circle(this.position.x, this.position.y, reach * 2 - 7);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(PROC_REACH * 2);
  }
}
