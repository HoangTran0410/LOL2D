import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';
// Relative, not `@/`: `DariusAxe` moved into `packs/riot/vfx/` (Task 2 of the
// content-pack extraction) — see `Lux_R.ts`'s identical note on `LuxBeamEffect`.
import { drawDariusAxe } from '../vfx/DariusAxe';
import { makeApplyHemorrhage } from './Darius_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Darius_W = InstanceType<ReturnType<typeof makeDarius_W>>;
type Darius_W_Buff = InstanceType<ReturnType<typeof makeDarius_W_Buff>>;
type Darius_W_Object = InstanceType<ReturnType<typeof makeDarius_W_Object>>;



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
function __buildDarius_W(api: ContentApi) {
  const Spell = api.Spell;
  const Darius_W_Buff = makeDarius_W_Buff(api);
  class Darius_W extends Spell {
    // Nothing is aimed: the swing goes wherever the standing attack order goes.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_darius_w');
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
  return Darius_W;
}
const __cacheDarius_W = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_W>>();
export default function makeDarius_W(api: ContentApi) {
  const cached = __cacheDarius_W.get(api);
  if (cached) return cached;
  const built = __buildDarius_W(api);
  __cacheDarius_W.set(api, built);
  return built;
}


function __buildDarius_W_Buff(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Buff = api.buffs.Buff;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const applyHemorrhage = makeApplyHemorrhage(api);
  const Darius_W_Object = makeDarius_W_Object(api);
  class Darius_W_Buff extends Buff {
    image: Buff['image'] = api.asset('spell_darius_w');
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
  return Darius_W_Buff;
}
const __cacheDarius_W_Buff = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_W_Buff>>();
export function makeDarius_W_Buff(api: ContentApi) {
  const cached = __cacheDarius_W_Buff.get(api);
  if (cached) return cached;
  const built = __buildDarius_W_Buff(api);
  __cacheDarius_W_Buff.set(api, built);
  return built;
}


/** How far off his body the blade rides while the swing is armed. */
const HOOK_ORBIT = 30;

/** Hip scale: big enough to read as his axe, small enough not to hide him. */
const AXE_LENGTH = 52;


/**
 * The armed blade: a hooked Noxian cleaver hanging at his hip, dripping.
 *
 * Deliberately not a ring or an orbit — Camille's blades already own that
 * silhouette. This is one heavy shape on one side of him, so "W is up" reads
 * from the shape of his outline rather than from a colour.
 */
function __buildDarius_W_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Darius_W_Object extends SpellObject {
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

      // The axe, carried low and to his right, blade hanging forward and already
      // wet — the same weapon Q swings and E hooks with, at hip scale. It used to
      // be a five-vertex blob that shared nothing with either.
      push();
      translate(HOOK_ORBIT * out - AXE_LENGTH * 0.3, bob);
      // Nearly nose-down while sheathed, tipping up to ready as it is drawn.
      rotate(1.15 - out * 0.5);
      drawDariusAxe(AXE_LENGTH, { alpha: 255 * out, bloodied: true });
      pop();

      // blood running off the edge, one drip per seeded slot
      noStroke();
      for (const drip of this.drips) {
        const fall = ((this.age / 9 + drip.phase * 30) % 40) / 40;
        fill(180, 25, 25, 220 * (1 - fall) * out);
        circle(
          HOOK_ORBIT * out + drip.offset,
          AXE_LENGTH * 0.42 + fall * drip.length + bob,
          3.5 * (1 - fall * 0.5)
        );
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
  return Darius_W_Object;
}
const __cacheDarius_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_W_Object>>();
export function makeDarius_W_Object(api: ContentApi) {
  const cached = __cacheDarius_W_Object.get(api);
  if (cached) return cached;
  const built = __buildDarius_W_Object(api);
  __cacheDarius_W_Object.set(api, built);
  return built;
}