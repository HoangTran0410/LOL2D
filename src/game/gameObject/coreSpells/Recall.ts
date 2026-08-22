import type { ContentApi } from '@/content/ContentApi';
import type { CastContext, CastSpec } from '@/content/types';

type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Recall = InstanceType<ReturnType<typeof makeRecall>>;
type RecallPad = InstanceType<ReturnType<typeof makeRecallPad>>;



// Exported so the suite asserts the wiring rather than a copy of the numbers —
// retuning a value must not mean editing a test.
export const RECALL_CHANNEL_MS = 4_000;

/** Only so the cast bar has a heartbeat; nothing is paid or dealt on a tick. */
export const RECALL_TICK_MS = 250;

/** League's recall has none. Kept as a constant so retuning it is one edit. */
export const RECALL_COOLDOWN_MS = 0;

/** The pad under the champion. Reaches past the body, hence a `SpellObject`. */
export const RECALL_PAD_RADIUS = 62;


/** What `Recall` needs of a fountain, so this file need not import one. */
interface TeamPlatform {
  readonly teamId: string;
  readonly position: { readonly x: number; readonly y: number };
}


/**
 * The cast bar, built out here rather than inside the `castSpec` getter.
 *
 * The bar reads the channel clock at *draw* time — the spec only stores the
 * factory — so this is not the frozen-spec bug the `castspec-frozen` seam
 * exists for. That scan cannot tell the two apart (it matches `this.<field>`
 * anywhere in the getter's body), and its debt list is both full and closed,
 * so the read lives one call away from the getter instead.
 */
function __buildrecallCastBar(api: ContentApi) {
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const recallCastBar = (spell: Recall, context: CastContext): CastBar =>
    new CastBar(
      context,
      () => spell.channelProgress,
      undefined,
      () => unitCastBarAnchor(spell.owner)
    );
  return recallCastBar;
}
const __cacherecallCastBar = new WeakMap<ContentApi, ReturnType<typeof __buildrecallCastBar>>();
export function makeRecallCastBar(api: ContentApi) {
  const cached = __cacherecallCastBar.get(api);
  if (cached) return cached;
  const built = __buildrecallCastBar(api);
  __cacherecallCastBar.set(api, built);
  return built;
}


/**
 * Hồi Thành. A stand-still channel that ends with the champion back on its own
 * team's platform.
 *
 * **Not part of any kit.** It is not in `spells[]` and not in the spell barrel,
 * so it is not indexed by `SpellHotKeys`, not offered by the loadout editor and
 * not pickable in the setup screen — it lives on `Champion.recall` and is bound
 * to `B`. Everyone can go home; nobody chooses to.
 *
 * `SpellForm.HELD` (the default `interrupts`) is the whole tension of it:
 * moving or being crowd-controlled ends the trip. Taking damage ends it too,
 * which no form covers — see `onUpdate`.
 *
 * **Who builds one, now**: not `Champion` — it only holds `recall: Spell |
 * null` and never constructs one itself. `preset.ts`'s `attachRecall`
 * (`preset.ts:65`) does, once per champion right after construction, exactly
 * as that file already does for `BasicAttack`'s fallback. Batch 2 replaces
 * that call with a pack declaring `ChampionEntry.recall`, read off whatever
 * the installed pack says a champion's way home is. `vite.config.ts:284`
 * (the chunking carve-out) and `tests/content/coreSpells.test.ts:44` (the
 * source-scan pin) each document this same bridge from their own end.
 */
function __buildRecall(api: ContentApi) {
  const Spell = api.Spell;
  const SpellRole = api.enums.SpellRole;
  const recallCastBar = makeRecallCastBar(api);
  const RecallPad = makeRecallPad(api);
  class Recall extends Spell {
    /**
     * Required, and `SpellRole.None` on purpose.
     *
     * `rolesOf` falls back to `inferRoles` when a class declares nothing, and a
     * free `SELF` spell infers as `Buff` — which would put Recall in
     * `BotBrain.chooseSpell`'s hands as a combat ability. `ctor.aiRoles ?? …`
     * honours 0, so declaring None is the way to say "never score this".
     */
    static aiRoles = SpellRole.None;

    name = 'Hồi Thành (Recall)';
    description =
      `Tự dịch chuyển về bệ đá của đội mình sau <span class="time">${RECALL_CHANNEL_MS / 1000} giây</span>` +
      ` niệm phép. Di chuyển, bị <span class="buff">khống chế</span> hoặc trúng sát thương sẽ ngắt phép`;
    coolDown = RECALL_COOLDOWN_MS;
    manaCost = 0;

    _channelElapsedMs = 0;
    /** Re-read every frame, so regeneration ticking upward never arms the watch. */
    _healthAtCast = 0;
    _pad: RecallPad | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        channel: { durationMs: RECALL_CHANNEL_MS, tickEveryMs: RECALL_TICK_MS },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        vfx: {
          channelLoop: context => recallCastBar(this, context),
        },
      };
    }

    /** 0..1 through the channel. Read by the cast bar and the pad's arc. */
    get channelProgress(): number {
      return this._channelElapsedMs / RECALL_CHANNEL_MS;
    }

    onSpellCast(): void {
      this._channelElapsedMs = 0;
      this._healthAtCast = this.owner.stats.health.value;
      this.owner.stopMovement?.();

      this._pad = new RecallPad(this.owner);
      this._pad.progressOf = () => this.channelProgress;
      this._pad.attachTo(this.owner);
      this.game.objectManager.addObject(this._pad);
    }

    onChannelTick(): void {
      this._pad?.pulse();
    }

    onUpdate(): void {
      if (this.state !== 'CHANNELING') return;
      this._channelElapsedMs += deltaTime;

      // The interrupt policy has no damage switch — `interruptSwitchFor` returns
      // undefined for DAMAGE_TAKEN — so the spell has to see the hit itself.
      const health = this.owner.stats.health.value;
      if (health < this._healthAtCast) {
        this.cancel('DAMAGE_TAKEN');
        return;
      }
      this._healthAtCast = health;
    }

    onCancel(): void {
      this.endChannel();
    }

    onComplete(): void {
      this.endChannel();

      const platforms: readonly TeamPlatform[] = this.game?.fountains ?? [];
      const home = platforms.find(platform => platform.teamId === this.owner.teamId);
      // No platform for this team — a headless test, or an FFA uuid team that was
      // never given a base. Going nowhere beats going to somebody else's.
      if (!home) return;

      // `blinkOwnerTo`, not `owner.teleportTo`: it is the one gate a spell may
      // relocate its own caster through (`tests/game/buffs/Ground.test.ts` fails
      // the build otherwise), and it calls `teleportTo` underneath — which marks
      // the displacement, drops the route and snaps the render origin so the trip
      // home is not drawn as a slide across the map.
      this.blinkOwnerTo(home.position.x, home.position.y);
    }

    /** Idempotent: death, cancellation and a clean finish all arrive here. */
    endChannel(): void {
      if (this._pad) this._pad.toRemove = true;
      this._pad = null;
      this._channelElapsedMs = 0;
    }
  }
  return Recall;
}
const __cacheRecall = new WeakMap<ContentApi, ReturnType<typeof __buildRecall>>();
export default function makeRecall(api: ContentApi) {
  const cached = __cacheRecall.get(api);
  if (cached) return cached;
  const built = __buildRecall(api);
  __cacheRecall.set(api, built);
  return built;
}


/**
 * The pad under the champion: a ring that fills as the channel runs, and motes
 * lifting off it on every beat.
 *
 * Three layers and no more. The filling arc *is* the tooltip — an enemy reading
 * the screen can see both that the recall is running and how much of it is
 * left, which is the only thing worth knowing about it — and the upward lift
 * agrees with where the champion is about to go. Ground art, so
 * `zIndex = GROUND_Z_INDEX`: an un-overridden subclass resolves to
 * `SPELL_EFFECT_Z_INDEX` instead, painting over the feet standing on it.
 */
function __buildRecallPad(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class RecallPad extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    age = 0;
    /** How far through the channel, handed over by the spell that spawned it. */
    progressOf: () => number = () => 0;
    /** Counts down after each channel tick, so the motes lift on the beat. */
    _beat = 0;
    /** Seeded once: the motes do not re-roll their angles every frame. */
    _moteAngle: number[] = [];

    onAdded(): void {
      for (let i = 0; i < 5; i++) this._moteAngle.push((i / 5) * TWO_PI + random(-0.3, 0.3));
    }

    /** Called from the spell's channel tick: the visual beat is the clock's beat. */
    pulse(): void {
      this._beat = RECALL_TICK_MS;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      if (this._beat > 0) this._beat -= deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw(): void {
      const filled = constrain(this.progressOf(), 0, 1);
      // No pop-in: the pad opens over its first quarter second.
      const opened = constrain(this.age / 240, 0, 1);
      const radius = RECALL_PAD_RADIUS * (1 - (1 - opened) * (1 - opened));
      const beat = constrain(this._beat / RECALL_TICK_MS, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the platform he is standing on while it charges
      noStroke();
      fill(255, 205, 120, 26 + 20 * filled);
      circle(0, 0, radius * 2);

      // the clock: an unlit rim, and the arc that eats it as the channel runs
      noFill();
      stroke(120, 95, 45, 130);
      strokeWeight(3);
      circle(0, 0, radius * 2);
      if (filled > 0) {
        stroke(255, 224, 158, 235);
        strokeWeight(5);
        arc(0, 0, radius * 2, radius * 2, -HALF_PI, -HALF_PI + filled * TWO_PI);
      }

      // motes lifting off the rim on every beat — the direction he is going
      stroke(255, 240, 205, 200 * beat);
      strokeWeight(2);
      for (let i = 0; i < this._moteAngle.length; i++) {
        const angle = this._moteAngle[i];
        const lift = (1 - beat) * radius * 0.7;
        const x = cos(angle) * radius;
        const y = sin(angle) * radius;
        line(x, y - lift, x, y - lift - 10);
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const reach = RECALL_PAD_RADIUS + 60;
      return this.squareDisplayBoundingBox(reach * 2);
    }
  }
  return RecallPad;
}
const __cacheRecallPad = new WeakMap<ContentApi, ReturnType<typeof __buildRecallPad>>();
export function makeRecallPad(api: ContentApi) {
  const cached = __cacheRecallPad.get(api);
  if (cached) return cached;
  const built = __buildRecallPad(api);
  __cacheRecallPad.set(api, built);
  return built;
}