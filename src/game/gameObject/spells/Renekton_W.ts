import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import type { BasicAttackHit } from '@/game/combat/BasicAttack';
import EventType from '@/game/enums/EventType';
import Buff from '@/game/gameObject/Buff';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Shield from '@/game/gameObject/buffs/Shield';
import Stun from '@/game/gameObject/buffs/Stun';
import { isEnraged } from './Renekton_R';

/** How long the empowered bite waits to be spent. */
export const WINDOW_MS = 6_000;
export const STRIKES = 2;
export const ENRAGED_STRIKES = 3;
export const DAMAGE_PER_STRIKE = 12;
export const STUN_MS = 600;
export const ENRAGED_STUN_MS = 1_000;

/**
 * Ruthless Predator: the next swing lands more than once and puts them down.
 *
 * Like every empowered-attack ability here it rides `ON_ATTACK_HIT` rather than
 * dealing its own hit — the swing has to be a real basic attack or on-hit
 * effects, crit and the attack's own validity rules all quietly stop applying
 * to it.
 *
 * Reign of Anger adds a third strike and, on the first one, tears off whatever
 * the target was hiding behind. Shredding shields is expressed with the shield
 * buffs themselves (`deactivateBuff` on each), which is why it is exact: there
 * is no separate "shield pool" for it to disagree with.
 */
export default class Renekton_W extends Spell {
  // Nothing is aimed: the bite goes wherever the standing attack order goes.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_renekton_w');
  name = 'Kẻ Săn Mồi Tàn Nhẫn (Renekton_W)';
  description =
    `Cường hóa đòn đánh tiếp theo trong <span class="time">${WINDOW_MS / 1000} giây</span>:` +
    ` cắn <span>${STRIKES} nhát</span> × <span class="damage">${DAMAGE_PER_STRIKE} sát thương</span>` +
    ` và <span class="buff">Choáng</span> trong <span class="time">${STUN_MS / 1000} giây</span>.` +
    ` <span class="buff">Cuồng Nộ</span>: <span>${ENRAGED_STRIKES} nhát</span>,` +
    ` <span class="buff">Choáng ${ENRAGED_STUN_MS / 1000} giây</span>` +
    ` và <span class="damage">phá huỷ mọi lá chắn</span> của mục tiêu`;
  coolDown = 8_000;
  manaCost = 25;

  onSpellCast(): void {
    this.owner.addBuff(new Renekton_W_Buff(WINDOW_MS, this.owner, this.owner));
  }
}

export class Renekton_W_Buff extends Buff {
  image: Buff['image'] = AssetManager.get('spell_renekton_w');
  name = 'Kẻ Săn Mồi Tàn Bạo';

  private stopListening?: () => void;
  private art: Renekton_W_Object | null = null;

  onActivate(): void {
    this.art = new Renekton_W_Object(this.targetUnit);
    this.art.attachTo(this.targetUnit, this);
    this.game.objectManager.addObject(this.art);

    this.stopListening = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        // the event is global: every Renekton on the map hears every swing
        if (attacker !== this.targetUnit || !victim || victim.isDead) return;
        this.bite(victim);
      }
    );
  }

  private bite(victim: AttackableUnit): void {
    // Read once, at the moment of the bite: the transformation may end between
    // arming this and spending it, and the swing should be worth what it was
    // worth when it landed.
    const enraged = isEnraged(this.targetUnit);
    const strikes = enraged ? ENRAGED_STRIKES : STRIKES;

    if (enraged) {
      // Everything absorbing damage for them comes off before the first strike,
      // so the bite is answered by health rather than by a bubble.
      for (const buff of victim.buffs) {
        if (buff instanceof Shield && !buff.toRemove) buff.deactivateBuff();
      }
    }

    for (let i = 0; i < strikes; i++) {
      if (victim.isDead) break;
      victim.takeDamage(DAMAGE_PER_STRIKE, this.targetUnit);
    }

    if (!victim.isDead) {
      const held = new Stun(enraged ? ENRAGED_STUN_MS : STUN_MS, this.targetUnit, victim);
      held.image = this.image;
      victim.addBuff(held);
    }

    this.art?.discharge(victim.position.x, victim.position.y, strikes);
    this.deactivateBuff();
  }

  onDeactivate(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    if (this.art) {
      this.art.fadeOut();
      this.art = null;
    }
  }
}

/** How far in front of him the bared jaws sit while the bite is armed. */
const JAW_OFFSET = 26;

/**
 * The armed bite: a set of jaws opening and closing in front of him.
 *
 * Not a blade and not an orbit — Renekton's read is teeth, and the tell is that
 * the jaws are *open*. When the bite is spent they snap shut on whoever ate it,
 * once per strike, which is what makes two hits distinguishable from three.
 */
export class Renekton_W_Object extends SpellObject {
  age = 0;
  /** Counts down from 1 once the bite has been spent. */
  spent = 0;
  spentAt: { x: number; y: number } | null = null;
  spentStrikes = STRIKES;
  private closing = false;

  discharge(x: number, y: number, strikes: number): void {
    this.spent = 1;
    this.spentAt = { x, y };
    this.spentStrikes = strikes;
  }

  fadeOut(): void {
    this.closing = true;
    if (this.spent <= 0) this.toRemove = true;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.spent > 0) {
      this.spent = Math.max(0, this.spent - deltaTime / 320);
      if (this.spent === 0 && this.closing) this.toRemove = true;
    }
  }

  draw(): void {
    // eased open rather than appearing already open
    const bared = constrain(this.age / 240, 0, 1);
    const open = (1 - (1 - bared) * (1 - bared)) * (0.7 + 0.3 * sin(this.age / 280));
    const enraged = isEnraged(this.owner);
    const [r, g, b] = enraged ? [255, 140, 70] : [215, 70, 55];

    push();
    translate(this.owner.position.x, this.owner.position.y);

    // the jaws: two arcs of teeth hinged at the same point
    for (const side of [-1, 1]) {
      push();
      translate(JAW_OFFSET * bared, 0);
      rotate(side * 0.5 * open);
      noStroke();
      fill(r, g, b, 200);
      beginShape();
      vertex(0, 0);
      vertex(30, side * 4);
      vertex(34, side * 12);
      vertex(4, side * 10);
      endShape(CLOSE);
      // teeth, which is the whole silhouette
      fill(250, 250, 244, 235);
      for (let i = 0; i < 4; i++) {
        const x = 6 + i * 7;
        beginShape();
        vertex(x, side * 5);
        vertex(x + 3, side * 5);
        vertex(x + 1.5, side * 11);
        endShape(CLOSE);
      }
      pop();
    }
    pop();

    // the spend: one snap per strike, spreading outward from the body
    if (this.spent <= 0 || !this.spentAt) return;
    push();
    translate(this.spentAt.x, this.spentAt.y);
    const grow = 1 - this.spent;
    noFill();
    for (let i = 0; i < this.spentStrikes; i++) {
      const lag = constrain(grow * 3 - i * 0.5, 0, 1);
      if (lag <= 0) continue;
      stroke(r, g, b, 230 * (1 - lag));
      strokeWeight(5 * (1 - lag) + 1);
      circle(0, 0, 24 + 70 * lag);
    }
    // a white bite mark on the body itself
    stroke(255, 250, 245, 220 * this.spent);
    strokeWeight(3);
    arc(0, 0, 44, 30, -2.5, -0.7);
    arc(0, 0, 44, 30, 0.7, 2.5);
    pop();
  }

  getDisplayBoundingBox() {
    const x = this.spentAt?.x ?? this.owner.position.x;
    const y = this.spentAt?.y ?? this.owner.position.y;
    const minX = Math.min(x, this.owner.position.x) - 90;
    const minY = Math.min(y, this.owner.position.y) - 90;
    return new Rectangle({
      x: minX,
      y: minY,
      w: Math.abs(x - this.owner.position.x) + 180,
      h: Math.abs(y - this.owner.position.y) + 180,
      data: this,
    });
  }
}
