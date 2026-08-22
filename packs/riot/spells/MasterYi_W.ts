import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type MasterYi_W = InstanceType<ReturnType<typeof makeMasterYi_W>>;
type MasterYi_W_Object = InstanceType<ReturnType<typeof makeMasterYi_W_Object>>;



// Exported so the suite asserts the channel's wiring, not a copy of the
// numbers — retuning a value must not mean editing a test.
export const CHANNEL_DURATION_MS = 2_000;

export const TICK_EVERY_MS = 250;

/** Eight ticks over the full channel: 32 health back on a ~100 pool. */
export const HEAL_PER_TICK = 4;

/**
 * The PC ability's 70% damage reduction, expressed with the buff this game
 * actually has. A flat pool of absorbed damage is the only mitigation
 * primitive in the catalogue, and it reads the same way to the player: an
 * interrupted Meditate is worth less than one that runs.
 */
export const SHIELD_AMOUNT = 25;

/** It hangs on briefly after the channel, as the PC reduction does. */
export const SHIELD_LINGER_MS = 500;

export const MEDITATE_RADIUS = 90;

export const COOLDOWN_MS = 8_000;

export const MANA_COST = 40;


/**
 * Thiền. A stand-still channel that heals and hardens him, and which any
 * crowd control — or his own first step — ends.
 *
 * `SpellForm.HELD` (the default `interrupts`) is exactly right: the effect is
 * the champion sitting there doing it, so moving must end it. That is the
 * whole tension of the ability.
 */
function __buildMasterYi_W(api: ContentApi) {
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const MasterYi_W_Object = makeMasterYi_W_Object(api);
  class MasterYi_W extends Spell {
    image = api.asset('spell_masteryi_w');
    name = 'Thiền (MasterYi_W)';
    description =
      `Yi ngồi thiền tối đa <span class="time">${CHANNEL_DURATION_MS / 1000} giây</span>, hồi` +
      ` <span class="damage">${HEAL_PER_TICK} máu</span> mỗi <span class="time">${TICK_EVERY_MS / 1000} giây</span>` +
      ` và nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>. Di chuyển hoặc bị khống chế sẽ ngắt thiền`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    _channelElapsedMs = 0;
    _aura: MasterYi_W_Object | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        channel: { durationMs: CHANNEL_DURATION_MS, tickEveryMs: TICK_EVERY_MS },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        vfx: {
          channelLoop: context =>
            new CastBar(
              context,
              () => this._channelElapsedMs / CHANNEL_DURATION_MS,
              undefined,
              () => unitCastBarAnchor(this.owner)
            ),
        },
      };
    }

    onSpellCast(): void {
      this._channelElapsedMs = 0;
      this.owner.stopMovement?.();

      const guard = new Shield(CHANNEL_DURATION_MS + SHIELD_LINGER_MS, this.owner, this.owner);
      guard.amount = SHIELD_AMOUNT;
      guard.color = [150, 235, 190];
      this.owner.addBuff(guard);

      // The mandala reaches well past his body, so it is a SpellObject and not
      // `castSpec.vfx`: caster VFX stops being drawn the moment the champion is
      // culled or fogged, and the damage-free half of an ability is exactly the
      // half nobody notices going missing.
      this._aura = new MasterYi_W_Object(this.owner);
      this._aura.attachTo(this.owner);
      this.game.objectManager.addObject(this._aura);
    }

    onChannelTick(): void {
      if (this.owner.isDead) return;
      this.owner.takeHeal(HEAL_PER_TICK, this.owner);
      this._aura?.pulse();
    }

    onUpdate(): void {
      if (this.state === 'CHANNELING') this._channelElapsedMs += deltaTime;
    }

    onCancel(): void {
      this.endChannel();
    }

    onComplete(): void {
      this.endChannel();
    }

    /** Idempotent: death, cancellation and a clean finish all arrive here. */
    endChannel(): void {
      if (this._aura) this._aura.toRemove = true;
      this._aura = null;
      this._channelElapsedMs = 0;
    }
  }
  return MasterYi_W;
}
const __cacheMasterYi_W = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_W>>();
export default function makeMasterYi_W(api: ContentApi) {
  const cached = __cacheMasterYi_W.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_W(api);
  __cacheMasterYi_W.set(api, built);
  return built;
}


/**
 * The mandala under him: a slow ground pattern rather than a burst, so the
 * enemy reading the screen can see the channel is still running and how long
 * it has left. Painted at `zIndex = GROUND_Z_INDEX` — ground art goes under the feet
 * standing on it, the slot `Singed_W_Object` already established.
 */
function __buildMasterYi_W_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class MasterYi_W_Object extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    age = 0;
    /** Counts down after each heal tick, so the rings bloom on the beat. */
    _tickFlash = 0;
    /** Seeded once: the petals do not re-roll every frame. */
    _petalLean: number[] = [];

    onAdded(): void {
      for (let i = 0; i < 8; i++) this._petalLean.push(random(-0.2, 0.2));
    }

    /** Called from the spell's channel tick: the visual beat is the damage beat. */
    pulse(): void {
      this._tickFlash = TICK_EVERY_MS;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      if (this._tickFlash > 0) this._tickFlash -= deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw(): void {
      // One normalized clock; nothing here reads a bare frame counter.
      const grown = constrain(this.age / 260, 0, 1);
      const open = 1 - (1 - grown) * (1 - grown);
      const beat = constrain(this._tickFlash / TICK_EVERY_MS, 0, 1);
      const radius = MEDITATE_RADIUS * open;

      push();
      translate(this.position.x, this.position.y);

      // the calm pool he is sitting in
      noStroke();
      fill(120, 210, 175, 34);
      circle(0, 0, radius * 2);

      // the rim sits on the real footprint, so the aura is not a guess
      noFill();
      stroke(180, 245, 210, 120 + 90 * beat);
      strokeWeight(2 + 2 * beat);
      circle(0, 0, radius * 2);

      // eight lotus petals, leaning the way they were seeded
      stroke(210, 255, 230, 150);
      strokeWeight(2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TWO_PI + this.age / 1600 + (this._petalLean[i] ?? 0);
        const inner = radius * 0.32;
        const outer = radius * (0.78 + 0.08 * sin(this.age / 300 + i));
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      // the heal itself: a ring closing inward on every tick, so the rhythm of
      // the channel and the rhythm of the healing can never drift apart
      if (beat > 0) {
        stroke(235, 255, 240, 210 * beat);
        strokeWeight(3 * beat + 1);
        circle(0, 0, radius * 2 * (1 - beat) + 18);
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = MEDITATE_RADIUS + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return MasterYi_W_Object;
}
const __cacheMasterYi_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_W_Object>>();
export function makeMasterYi_W_Object(api: ContentApi) {
  const cached = __cacheMasterYi_W_Object.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_W_Object(api);
  __cacheMasterYi_W_Object.set(api, built);
  return built;
}