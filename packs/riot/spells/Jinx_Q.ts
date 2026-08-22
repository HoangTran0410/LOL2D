import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackController } from '@moba2d/core/content/types';

type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Jinx_Q = InstanceType<ReturnType<typeof makeJinx_Q>>;
type Jinx_Q_Launcher = InstanceType<ReturnType<typeof makeJinx_Q_Launcher>>;



export const DURATION = 6000;

export const BONUS_RANGE = 200;

export const ON_HIT_DAMAGE = 7;

export const ATTACK_SPEED_PENALTY = -0.3;

export const STACK_ID = 'jinx_q';

/** How long the swap itself plays for. */
export const SWAP_MS = 280;

/** How far past the body the launcher reaches, for the cull box. */
export const LAUNCHER_MARGIN = 80;


/**
 * Switcheroo!
 *
 * The rocket launcher: longer reach and a heavier shell per swing, paid for in
 * rate of fire. It is a pure basic-attack ability, which is only interesting
 * because `onHitDamage` and `attackRange` are stats now — before that this
 * would have had to hand-roll an `ON_ATTACK_HIT` listener and could not have
 * touched reach at all.
 *
 * Modelled as a timed buff rather than League's free toggle: a toggle with no
 * cost is a strictly-better state the player would simply leave on.
 */
function __buildJinx_Q(api: ContentApi) {
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const Jinx_Q_Launcher = makeJinx_Q_Launcher(api);
  class Jinx_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_jinx_q');
    name = 'Tráo Hàng! (Jinx_Q)';
    description =
      `Đổi sang súng phóng lựu trong <span class="time">${DURATION / 1000} giây</span>:` +
      ` <span class="buff">+${BONUS_RANGE} tầm đánh</span>, <span class="buff">+${ON_HIT_DAMAGE} sát thương mỗi đòn</span>,` +
      ` đổi lại <span class="damage">-${Math.abs(ATTACK_SPEED_PENALTY) * 100}% tốc độ đánh</span>`;
    coolDown = 8000;
    manaCost = 20;

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = STACK_ID;
      amp.image = this.image;
      amp.name = 'Đổi Súng!';
      amp.bonuses = {
        attackRange: { baseBonus: BONUS_RANGE },
        onHitDamage: { baseBonus: ON_HIT_DAMAGE },
        attackSpeed: { percentBaseBonus: ATTACK_SPEED_PENALTY },
      };
      this.owner.addBuff(amp);

      // An ability whose entire effect is "your attacks are different now" and
      // whose entire feedback was a buff icon in the corner. Six seconds of a
      // changed basic attack has to be visible on the champion, so the weapon she
      // swapped to is drawn in her hands for exactly as long as the buff lives —
      // the object watches the buff rather than timing itself, so a cleanse or an
      // early death takes the launcher with it.
      const launcher = new Jinx_Q_Launcher(this.owner);
      launcher.attachTo(this.owner, amp);
      this.game.objectManager.addObject(launcher);
    }
  }
  return Jinx_Q;
}
const __cacheJinx_Q = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_Q>>();
export default function makeJinx_Q(api: ContentApi) {
  const cached = __cacheJinx_Q.get(api);
  if (cached) return cached;
  const built = __buildJinx_Q(api);
  __cacheJinx_Q.set(api, built);
  return built;
}


/** Fishbones, shouldered for the duration of Switcheroo!. */
function __buildJinx_Q_Launcher(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Jinx_Q_Launcher extends SpellObject {
    age = 0;
    /**
     * Where the weapon is pointing, remembered between frames.
     *
     * Not the cursor: `this.game.worldMouse` is shared mutable aim state and
     * spell files are scanned for reads of it, for the good reason that the
     * cursor is one player's and this object belongs to whichever champion cast
     * it. The two things that are actually hers are what she is shooting and
     * where she is walking — and in that order, because a weapon that swings to
     * face the target is the one that looks aimed. Held rather than recomputed
     * from scratch so standing still does not snap it back to due east.
     */
    heldAngle = 0;

    update() {
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.heldAngle = this.aimAngle();
      this.dropIfAttachmentLost();
    }

    private aimAngle(): number {
      // Structural, the same read `BasicAttack.order` uses: the controller lives
      // on `Champion`, and this object is handed the wider `AttackableUnit`.
      const target = (this.owner as { basicAttack?: BasicAttackController }).basicAttack?.target;
      if (target) {
        return Math.atan2(target.position.y - this.position.y, target.position.x - this.position.x);
      }
      const destination = this.owner.destination;
      if (destination) {
        const dx = destination.x - this.position.x;
        const dy = destination.y - this.position.y;
        if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
      }
      return this.heldAngle;
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const radius = size / 2;
      const angle = this.heldAngle;
      const swap = constrain(this.age / SWAP_MS, 0, 1);
      // Shouldered over the first quarter second: it swings up into place.
      const settle = 1 - Math.pow(1 - swap, 3);
      const glow = 0.7 + 0.3 * Math.sin(this.age / 140);

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      // Held off her leading shoulder rather than through the middle of her.
      translate(radius * 0.15, radius * 0.55 * settle);
      rotate((1 - settle) * -0.9);

      const length = 62;
      const barrel = 20;

      noStroke();
      // Muzzle heat, so the business end is unmistakable at a glance.
      blendMode(ADD);
      fill(255, 110, 170, 90 * glow * settle);
      circle(length * 0.72, 0, barrel * 2.1);
      blendMode(BLEND);

      // Stock and body.
      fill(58, 44, 66);
      rect(-length * 0.42, -barrel * 0.34, length * 0.5, barrel * 0.68, 4);
      fill(46, 120, 96);
      rect(-length * 0.1, -barrel * 0.5, length * 0.62, barrel, 5);
      // Widening muzzle — Fishbones flares out into a mouth.
      fill(38, 100, 82);
      quad(
        length * 0.5,
        -barrel * 0.5,
        length * 0.82,
        -barrel * 0.78,
        length * 0.82,
        barrel * 0.78,
        length * 0.5,
        barrel * 0.5
      );
      // Teeth around it.
      fill(248, 244, 236);
      for (let i = -1; i <= 1; i++) {
        triangle(
          length * 0.8,
          i * barrel * 0.46 - barrel * 0.14,
          length * 0.8,
          i * barrel * 0.46 + barrel * 0.14,
          length * 0.66,
          i * barrel * 0.46
        );
      }
      // Dorsal fin and a pink shell showing in the breech.
      fill(228, 66, 148);
      triangle(
        length * 0.05,
        -barrel * 0.5,
        length * 0.3,
        -barrel * 1.1,
        length * 0.34,
        -barrel * 0.5
      );
      fill(255, 190, 220, 230 * glow);
      circle(length * 0.62, 0, barrel * 0.72);

      // The swap itself: a ring off the weapon as it comes up.
      if (swap < 1) {
        noFill();
        stroke(255, 150, 200, 220 * (1 - swap));
        strokeWeight(4 * (1 - swap) + 1);
        circle(length * 0.3, 0, 30 + 90 * swap);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + LAUNCHER_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Jinx_Q_Launcher;
}
const __cacheJinx_Q_Launcher = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_Q_Launcher>>();
export function makeJinx_Q_Launcher(api: ContentApi) {
  const cached = __cacheJinx_Q_Launcher.get(api);
  if (cached) return cached;
  const built = __buildJinx_Q_Launcher(api);
  __cacheJinx_Q_Launcher.set(api, built);
  return built;
}