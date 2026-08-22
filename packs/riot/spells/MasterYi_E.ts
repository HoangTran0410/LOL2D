import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type MasterYi_E = InstanceType<ReturnType<typeof makeMasterYi_E>>;
type MasterYi_E_Object = InstanceType<ReturnType<typeof makeMasterYi_E_Object>>;



// Exported so the suite asserts the on-hit wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const DURATION_MS = 5_000;

/** Added to every landed basic attack while the style holds. */
export const BONUS_TRUE_DAMAGE = 4;

export const ATTACK_SPEED_PERCENT = 0.2;

export const COOLDOWN_MS = 8_000;

export const MANA_COST = 25;

/** How long one Wuju cut hangs on the body it was struck into. */
export const CUT_MS = 240;


/**
 * Võ Thuật Wuju. For five seconds his hands hurt more.
 *
 * The bonus rides `EventType.ON_ATTACK_HIT` — the one event that fires once per
 * *landed* swing — rather than being folded into `attackDamage`, because that
 * is what makes it an on-hit effect: it never fires on a swing the victim
 * dodged, walked out of, or died before, and a spell cannot borrow it. The
 * duration itself is carried by `StatAmp`, so the player can see the style
 * running in the buff row and read how long is left.
 */
function __buildMasterYi_E(api: ContentApi) {
  const EventType = api.enums.EventType;
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const MasterYi_E_Object = makeMasterYi_E_Object(api);
  class MasterYi_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_masteryi_e');
    name = 'Võ Thuật Wuju (MasterYi_E)';
    description =
      `Trong <span class="time">${DURATION_MS / 1000} giây</span>, đòn đánh thường của Yi gây thêm` +
      ` <span class="damage">${BONUS_TRUE_DAMAGE} sát thương chuẩn</span> và anh nhận` +
      ` <span class="buff">+${Math.round(ATTACK_SPEED_PERCENT * 100)}% tốc độ đánh</span>`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    /** Milliseconds of style left. Drives teardown, so it is the source of truth. */
    _remainingMs = 0;
    _stopWatching: (() => void) | null = null;
    _blade: MasterYi_E_Object | null = null;

    get stackCount(): number | undefined {
      return this._remainingMs > 0 ? Math.ceil(this._remainingMs / 1000) : undefined;
    }

    onSpellCast(): void {
      // Recasting refreshes rather than stacking: one listener, always.
      this.endStyle();

      const amp = new StatAmp(DURATION_MS, this.owner, this.owner);
      // Several unrelated spells apply a bare StatAmp; without its own id they
      // fight over one slot. See the `stackId` note on `Buff`.
      amp.stackId = 'masteryi_e';
      amp.bonuses = { attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT } };
      this.owner.addBuff(amp);

      const blade = new MasterYi_E_Object(this.owner);
      blade.attachTo(this.owner);
      this.game.objectManager.addObject(blade);
      this._blade = blade;

      this._remainingMs = DURATION_MS;
      this._stopWatching = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          // The event is global; only his own swings carry the style.
          if (attacker !== this.owner || this._remainingMs <= 0) return;
          victim.takeDamage(BONUS_TRUE_DAMAGE, this.owner);
          blade.cut(victim);
        }
      );
    }

    onUpdate(): void {
      if (this._remainingMs <= 0) return;
      this._remainingMs -= deltaTime;
      if (this._remainingMs <= 0) this.endStyle();
    }

    onCancel(): void {
      this.endStyle();
    }

    deactivate(): void {
      super.deactivate();
      this.endStyle();
    }

    onRemoved(): void {
      super.onRemoved();
      this.endStyle();
    }

    /** Idempotent: expiry, death, scene exit and a recast all arrive here. */
    endStyle(): void {
      this._remainingMs = 0;
      this._stopWatching?.();
      this._stopWatching = null;
      if (this._blade) this._blade.toRemove = true;
      this._blade = null;
    }
  }
  return MasterYi_E;
}
const __cacheMasterYi_E = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_E>>();
export default function makeMasterYi_E(api: ContentApi) {
  const cached = __cacheMasterYi_E.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_E(api);
  __cacheMasterYi_E.set(api, built);
  return built;
}


/** One cut landed by an empowered swing. */
interface WujuCut {
  x: number;
  y: number;
  angle: number;
  age: number;
}


/**
 * The lit blade, riding his body, plus the cuts it leaves in whatever it hits.
 *
 * A SpellObject rather than caster VFX because the cuts land on the *victim* —
 * a champion's own draw call is skipped whenever he is culled or fogged, and an
 * on-hit effect that only paints while its owner is on screen is an on-hit
 * effect the enemy never learns to fear.
 */
function __buildMasterYi_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class MasterYi_E_Object extends SpellObject {
    age = 0;
    _cuts: WujuCut[] = [];

    cut(victim: AttackableUnit): void {
      this._cuts.push({
        x: victim.position.x,
        y: victim.position.y,
        angle: Math.atan2(
          victim.position.y - this.owner.position.y,
          victim.position.x - this.owner.position.x
        ),
        age: 0,
      });
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      let i = 0;
      while (i < this._cuts.length) {
        this._cuts[i].age += deltaTime;
        if (this._cuts[i].age >= CUT_MS) this._cuts.splice(i, 1);
        else i++;
      }
    }

    draw(): void {
      const size = this.owner.animatedValues?.displaySize ?? 40;
      // A slow breath rather than a strobe: the style is a state, not an event.
      const breath = 0.65 + 0.35 * sin(this.age / 220);

      push();
      // the lit edge orbiting his hand
      translate(this.position.x, this.position.y);
      const a = this.age / 260;
      const reach = size * 0.62;
      stroke(150, 235, 255, 120 + 90 * breath);
      strokeWeight(3);
      line(cos(a) * reach * 0.3, sin(a) * reach * 0.3, cos(a) * reach, sin(a) * reach);
      stroke(245, 255, 255, 210);
      strokeWeight(1.2);
      line(cos(a) * reach * 0.35, sin(a) * reach * 0.35, cos(a) * reach, sin(a) * reach);
      pop();

      for (const cut of this._cuts) {
        const t = constrain(cut.age / CUT_MS, 0, 1);
        const fade = 1 - t;
        const open = 1 - (1 - t) * (1 - t);
        push();
        translate(cut.x, cut.y);
        rotate(cut.angle);
        noFill();
        // three parallel slashes, opening as they fade: a style, not a puff
        for (let i = -1; i <= 1; i++) {
          stroke(150, 235, 255, 170 * fade);
          strokeWeight(4 * fade + 0.5);
          line(-6, i * 9 * (0.4 + open), 22 + 14 * open, i * 13 * (0.4 + open));
          stroke(250, 255, 255, 230 * fade);
          strokeWeight(1.4 * fade + 0.3);
          line(-4, i * 9 * (0.4 + open), 20 + 14 * open, i * 13 * (0.4 + open));
        }
        pop();
      }
    }

    getDisplayBoundingBox(): Rectangle {
      let minX = this.position.x - 70;
      let minY = this.position.y - 70;
      let maxX = this.position.x + 70;
      let maxY = this.position.y + 70;
      for (const cut of this._cuts) {
        if (cut.x - 60 < minX) minX = cut.x - 60;
        if (cut.y - 60 < minY) minY = cut.y - 60;
        if (cut.x + 60 > maxX) maxX = cut.x + 60;
        if (cut.y + 60 > maxY) maxY = cut.y + 60;
      }
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return MasterYi_E_Object;
}
const __cacheMasterYi_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_E_Object>>();
export function makeMasterYi_E_Object(api: ContentApi) {
  const cached = __cacheMasterYi_E_Object.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_E_Object(api);
  __cacheMasterYi_E_Object.set(api, built);
  return built;
}