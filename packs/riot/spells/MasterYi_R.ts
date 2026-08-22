import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Chilled = InstanceType<ContentApi['buffs']['Chilled']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type MasterYi_R = InstanceType<ReturnType<typeof makeMasterYi_R>>;
type MasterYi_R_Object = InstanceType<ReturnType<typeof makeMasterYi_R_Object>>;



// Exported so the suite asserts the ultimate's wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const DURATION_MS = 6_000;

export const MOVE_SPEED_PERCENT = 0.35;

export const ATTACK_SPEED_PERCENT = 0.5;

export const COOLDOWN_MS = 10_000;

export const MANA_COST = 100;

/** How far the wind streaks trail behind him, for the display box. */
export const AURA_REACH = 110;


/**
 * Chiến Binh Sơn Cước. He cannot be slowed and he will catch you.
 *
 * Slow immunity has no buff of its own in this game's catalogue, and inventing
 * one would be a new engine primitive for a single ability. It is expressed
 * instead as an *effect that keeps cleansing*: `MasterYi_R_Object` strips
 * `Slow` and `Chilled` off him every frame it is alive, which is
 * indistinguishable from immunity to the player and costs nothing new. The
 * speed and the swing rate are the two buffs that do map cleanly.
 */
function __buildMasterYi_R(api: ContentApi) {
  const Spell = api.Spell;
  const Speedup = api.buffs.Speedup;
  const StatAmp = api.buffs.StatAmp;
  const MasterYi_R_Object = makeMasterYi_R_Object(api);
  class MasterYi_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_masteryi_r');
    name = 'Chiến Binh Sơn Cước (MasterYi_R)';
    description =
      `Trong <span class="time">${DURATION_MS / 1000} giây</span>, Yi nhận` +
      ` <span class="buff">+${Math.round(MOVE_SPEED_PERCENT * 100)}% tốc chạy</span> và` +
      ` <span class="buff">+${Math.round(ATTACK_SPEED_PERCENT * 100)}% tốc độ đánh</span>,` +
      ` đồng thời <span class="buff">gỡ bỏ và miễn nhiễm mọi hiệu ứng làm chậm</span>`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    _aura: MasterYi_R_Object | null = null;

    onSpellCast(): void {
      const speed = new Speedup(DURATION_MS, this.owner, this.owner);
      speed.percent = MOVE_SPEED_PERCENT;
      this.owner.addBuff(speed);

      const amp = new StatAmp(DURATION_MS, this.owner, this.owner);
      // Its own id, or this and Wuju Style's amp fight over one StatAmp slot.
      amp.stackId = 'masteryi_r';
      amp.bonuses = { attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT } };
      this.owner.addBuff(amp);

      if (this._aura) this._aura.toRemove = true;
      const aura = new MasterYi_R_Object(this.owner);
      aura.lifeTime = DURATION_MS;
      aura.attachTo(this.owner);
      this.game.objectManager.addObject(aura);
      this._aura = aura;
      // The cleanse half starts on the cast, not on the first frame after it:
      // popping the ultimate out of a slow has to work the instant it is pressed.
      aura.shedSlows();
    }

    onUpdate(): void {
      if (this._aura?.toRemove) this._aura = null;
    }
  }
  return MasterYi_R;
}
const __cacheMasterYi_R = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_R>>();
export default function makeMasterYi_R(api: ContentApi) {
  const cached = __cacheMasterYi_R.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_R(api);
  __cacheMasterYi_R.set(api, built);
  return built;
}


/**
 * The wind he runs in, and the thing that keeps him out of every slow.
 *
 * A SpellObject rather than caster VFX for the usual reason — the streaks trail
 * a body-length behind him, and caster VFX stops being drawn the moment the
 * champion is culled — but it also carries the immunity, so the effect the
 * player can see and the rule they are relying on end on the same frame.
 */
function __buildMasterYi_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Chilled = api.buffs.Chilled;
  const Slow = api.buffs.Slow;
  class MasterYi_R_Object extends SpellObject {
    lifeTime = DURATION_MS;
    age = 0;
    /** Seeded once so the streaks do not re-roll their offsets each frame. */
    _streakOffsets: number[] = [];

    onAdded(): void {
      for (let i = 0; i < 6; i++) this._streakOffsets.push(random(-1, 1));
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.shedSlows();
    }

    /**
     * Immunity as a standing cleanse. Both movement debuffs in the catalogue are
     * covered; `deactivateBuff()` is the only way to end a buff (there is no
     * `Buff.deactivate`), and it puts the stat modifier back on its way out.
     */
    shedSlows(): void {
      for (const buff of this.owner.buffs) {
        if (buff.toRemove) continue;
        if (buff instanceof Slow || buff instanceof Chilled) buff.deactivateBuff();
      }
    }

    draw(): void {
      const left = constrain(1 - this.age / this.lifeTime, 0, 1);
      // Wind-in easing on the entry so it grows into place instead of popping.
      const entry = constrain(this.age / 220, 0, 1);
      const grown = entry * entry;
      const size = this.owner.animatedValues?.displaySize ?? 40;

      push();
      translate(this.position.x, this.position.y);

      // the ring of mountain wind, thinning as the ultimate runs out
      noFill();
      stroke(255, 205, 110, 60 + 90 * left);
      strokeWeight(2 + 2 * left);
      circle(0, 0, (size + 26) * grown);

      // streaks blown off him — six, leaning the way they were seeded
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + this.age / 240 + (this._streakOffsets[i] ?? 0) * 0.3;
        const near = size * 0.6;
        const far = near + AURA_REACH * 0.45 * grown * (0.6 + 0.4 * sin(this.age / 180 + i));
        stroke(255, 225, 150, 150 * left);
        strokeWeight(3);
        line(cos(a) * near, sin(a) * near, cos(a) * far, sin(a) * far);
        stroke(255, 250, 225, 220 * left);
        strokeWeight(1.2);
        line(cos(a) * near, sin(a) * near, cos(a) * far * 0.9, sin(a) * far * 0.9);
      }

      // the clock, so the enemy can count him down as well as he can
      stroke(255, 230, 160, 190);
      strokeWeight(3);
      arc(0, 0, size + 40, size + 40, -HALF_PI, -HALF_PI + TWO_PI * left);

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = AURA_REACH;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return MasterYi_R_Object;
}
const __cacheMasterYi_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_R_Object>>();
export function makeMasterYi_R_Object(api: ContentApi) {
  const cached = __cacheMasterYi_R_Object.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_R_Object(api);
  __cacheMasterYi_R_Object.set(api, built);
  return built;
}