import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import type { BasicAttackHit } from '../../combat/BasicAttack';
import EventType from '../../enums/EventType';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Slow from '../buffs/Slow';
import { applyHemorrhage } from './Darius_Q';

/** How long the empowered swing waits to be spent. */
export const WINDOW_MS = 4_000;
export const BONUS_DAMAGE = 22;
/** Crippling: not a nudge, a leg taken out from under them. */
export const SLOW_PERCENT = 0.9;
export const SLOW_MS = 1_000;
/** A swing that kills gives half the remaining wait back. */
export const KILL_COOLDOWN_REFUND = 0.5;

/**
 * Crippling Strike: the next basic attack, but it takes the leg.
 *
 * Pressing W does nothing on its own — it arms `Darius_W_Buff`, which spends
 * itself on the next landed swing through `ON_ATTACK_HIT`. That seam matters:
 * the damage has to ride the real attack (so on-hit passives, crit and the
 * attack's own validity rules all still apply) rather than being a second,
 * parallel hit the spell deals by hand.
 */
export default class Darius_W extends Spell {
  // Nothing is aimed: the swing goes wherever the standing attack order goes.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_darius_w');
  name = 'Đánh Thọt (Darius_W)';
  description =
    `Cường hóa đòn đánh thường tiếp theo trong <span class="time">${WINDOW_MS / 1000} giây</span>:` +
    ` gây thêm <span class="damage">${BONUS_DAMAGE} sát thương</span>,` +
    ` <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> trong <span class="time">${SLOW_MS / 1000} giây</span>` +
    ` và cộng một cấp <span class="damage">Chảy Máu</span>.` +
    ` Nếu đòn này <span class="buff">hạ gục</span> mục tiêu, hồi lại một nửa thời gian hồi chiêu`;
  coolDown = 6_000;
  manaCost = 25;

  onSpellCast(): void {
    const armed = new Darius_W_Buff(WINDOW_MS, this.owner, this.owner);
    // Set before `addBuff`, which activates the buff inside the same call.
    armed.spell = this;
    this.owner.addBuff(armed);
  }
}

export class Darius_W_Buff extends Buff {
  image: Buff['image'] = AssetManager.get('spell_darius_w');
  name = 'Đòn Hiểm';

  /**
   * The spell that armed this, so a kill can pay part of its cooldown back.
   * Assigned by `Darius_W.onSpellCast` rather than taken as a constructor
   * argument: `BuffConstructor` fixes the three-argument shape every buff in
   * the catalogue is built with, and a fourth parameter would put this class
   * outside it.
   */
  spell: Darius_W | null = null;
  private stopListening?: () => void;
  private art: Darius_W_Object | null = null;

  onActivate(): void {
    this.art = new Darius_W_Object(this.targetUnit);
    this.art.attachTo(this.targetUnit, this);
    this.game.objectManager.addObject(this.art);

    this.stopListening = this.game.eventManager.on(
      EventType.ON_ATTACK_HIT,
      ({ attacker, victim }: BasicAttackHit) => {
        // the event is global: every Darius on the map hears every swing
        if (attacker !== this.targetUnit || !victim || victim.isDead) return;
        this.land(victim);
      }
    );
  }

  private land(victim: AttackableUnit): void {
    // Latched before the hit, read after: `takeDamage` is synchronous, so this
    // is the only honest way to ask "did my swing kill it".
    const wasAlive = !victim.isDead;
    victim.takeDamage(BONUS_DAMAGE, this.targetUnit);

    if (!victim.isDead) {
      const cripple = new Slow(SLOW_MS, this.targetUnit, victim);
      cripple.percent = SLOW_PERCENT;
      cripple.image = this.image;
      victim.addBuff(cripple);
      applyHemorrhage(this.targetUnit, victim);
    } else if (wasAlive && this.spell) {
      // Shortens what is already on the clock rather than starting a new wait,
      // so the number has been through `reducedCooldown` once already and must
      // not be put through it again.
      this.spell.currentCooldown *= KILL_COOLDOWN_REFUND;
    }

    this.art?.discharge(victim.position.x, victim.position.y);
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

/** How far off his body the hooked blade rides while the swing is armed. */
const HOOK_ORBIT = 30;

/**
 * The armed blade: a hooked Noxian cleaver hanging at his hip, dripping.
 *
 * Deliberately not a ring or an orbit — Camille's blades already own that
 * silhouette. This is one heavy shape on one side of him, so "W is up" reads
 * from the shape of his outline rather than from a colour.
 */
export class Darius_W_Object extends SpellObject {
  age = 0;
  /** Counts down from 1 once the swing has been spent. */
  spent = 0;
  spentAt: { x: number; y: number } | null = null;
  /** Drops the effect once the discharge flash has played out. */
  private closing = false;

  /** Seeded once — `random()` in `draw()` flickers instead of animating. */
  drips: { offset: number; phase: number; length: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < 5; i++) {
      this.drips.push({
        offset: random(-12, 12),
        phase: random(0, TWO_PI),
        length: random(6, 16),
      });
    }
  }

  discharge(x: number, y: number): void {
    this.spent = 1;
    this.spentAt = { x, y };
  }

  /** The buff ended: play out whatever is left, then go. */
  fadeOut(): void {
    this.closing = true;
    if (this.spent <= 0) this.toRemove = true;
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (this.spent > 0) {
      this.spent = Math.max(0, this.spent - deltaTime / 260);
      if (this.spent === 0 && this.closing) this.toRemove = true;
    }
  }

  draw(): void {
    // ease-in as it is drawn from the belt, so it does not pop into existence
    const draw01 = constrain(this.age / 200, 0, 1);
    const out = draw01 * draw01;
    const bob = sin(this.age / 260) * 3;

    push();
    translate(this.owner.position.x, this.owner.position.y);

    // the cleaver, held low and to his right
    push();
    translate(HOOK_ORBIT * out, bob);
    rotate(0.5 + (1 - out) * 1.2);
    // haft
    stroke(94, 62, 40);
    strokeWeight(5);
    line(-14, 0, 10, 0);
    // hooked head — the hook is the read: this cut catches and holds
    noStroke();
    fill(198, 204, 216);
    beginShape();
    vertex(8, -12);
    vertex(26, -16);
    vertex(30, 2);
    vertex(16, 14);
    vertex(8, 6);
    endShape(CLOSE);
    fill(168, 26, 28);
    beginShape();
    vertex(12, -8);
    vertex(23, -10);
    vertex(24, 0);
    vertex(15, 7);
    endShape(CLOSE);
    pop();

    // blood running off the edge, one drip per seeded slot
    noStroke();
    for (const drip of this.drips) {
      const fall = ((this.age / 9 + drip.phase * 30) % 40) / 40;
      fill(180, 25, 25, 220 * (1 - fall) * out);
      circle(HOOK_ORBIT * out + drip.offset, 10 + fall * drip.length + bob, 3.5 * (1 - fall * 0.5));
    }
    pop();

    // the spend: a hooked gash torn across whoever ate it
    if (this.spent <= 0 || !this.spentAt) return;
    push();
    translate(this.spentAt.x, this.spentAt.y);
    const grow = 1 - this.spent;
    noFill();
    stroke(255, 60, 55, 240 * this.spent);
    strokeWeight(5 * this.spent + 1);
    arc(0, 0, 40 + 34 * grow, 54 + 34 * grow, -0.9, 1.1);
    stroke(255, 220, 210, 200 * this.spent);
    strokeWeight(2);
    arc(0, 0, 26 + 34 * grow, 38 + 34 * grow, -0.7, 0.9);
    pop();
  }

  getDisplayBoundingBox() {
    // covers his body, the blade beside him and wherever the gash was torn
    const x = this.spentAt?.x ?? this.owner.position.x;
    const y = this.spentAt?.y ?? this.owner.position.y;
    const minX = Math.min(x, this.owner.position.x) - 80;
    const minY = Math.min(y, this.owner.position.y) - 80;
    return new Rectangle({
      x: minX,
      y: minY,
      w: Math.abs(x - this.owner.position.x) + 160,
      h: Math.abs(y - this.owner.position.y) + 160,
      data: this,
    });
  }
}
