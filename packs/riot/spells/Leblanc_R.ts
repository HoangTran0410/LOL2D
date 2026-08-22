import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type Spell = InstanceType<ContentApi['Spell']>;
type Leblanc_R = InstanceType<ReturnType<typeof makeLeblanc_R>>;



// Exported so the suite asserts Mimic's wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const MANA_COST = 0;

export const COOLDOWN_MS = 9_000;


/**
 * The slots Mimic may copy from: the four ability slots, never the summoner
 * ones and never the basic attack.
 *
 * It used to be a hard list of `Leblanc_Q | Leblanc_W | Leblanc_E`, which is the
 * right rule for the game this ability comes from and the wrong one for this
 * one: LOL2D has a kit builder, so LeBlanc's Q slot may be holding Ahri's orb.
 * Keyed on *where the spell sits* rather than what class it is, Mimic copies
 * whatever the champion actually cast — which is what the ability says it does.
 *
 * `SpellHotKeys` is the layout: index 0 is the basic attack, 1-4 are Q/W/E/R,
 * 5-6 are the summoner spells. Summoners are excluded because they fire the
 * same event on the same owner and are not abilities; the basic attack because
 * copying it is a swing, not a spell.
 */
export const FIRST_ABILITY_SLOT = 1;

export const LAST_ABILITY_SLOT = 4;


interface TrackedCast {
  SpellClass: new (owner: any) => Spell;
  image: unknown;
  name: string;
}


const isInFlight = (state: string): boolean =>
  state === 'CASTING' || state === 'CHARGING' || state === 'CHANNELING';


/**
 * Mimic — see the design note in the PR description for the full reasoning.
 * Short version: this recasts a brand-new instance of whichever of
 * `Leblanc_Q` / `Leblanc_W` / `Leblanc_E` LeBlanc last cast, bound to her own
 * body (not a decoy — Mimic has none), replayed through the exact same typed
 * `CastSpec` runtime every other spell uses. A fresh instance always starts
 * `READY`, which is what lets Mimic ignore the mimicked ability's own
 * cooldown without touching its state.
 *
 * What is faithful: the recast runs the real ability class, so mark
 * consumption (Q), the blink-and-mark (W), and the chain-then-root (E) all
 * behave exactly as a normal cast would, aimed at the original cast's
 * target/direction.
 *
 * What is simplified, on purpose:
 *  - Real Mimic deals its own independently-ranked "modified" damage. This
 *    game has no per-ability rank/AP system to hang that formula on, so the
 *    recast deals the mimicked ability's normal, undiminished damage instead
 *    of a separately tuned number. Mimic's own cooldown (long relative to
 *    Q/W/E) and zero mana cost are the balance lever, same as in the source
 *    game — Mimic's cost is what limits it, not a damage penalty.
 *  - The recast's range/validity (can LeBlanc still reach that target?) is
 *    checked against her *current* position, not a snapshot from the
 *    original cast, so walking away between the original cast and Mimic can
 *    make the recast whiff instead of firing. This cannot crash — an invalid
 *    target/direction just makes the mimicked spell's own `press()` refuse,
 *    the same way a normal cast would.
 *  - Only Q/W/E are mimicable; summoner spells and Mimic itself are excluded
 *    by an explicit allowlist, matching "last non-ultimate ability" exactly.
 *  - With nothing cast yet, Mimic defaults to Sigil of Malice aimed at the
 *    current cursor, matching the wiki's documented default.
 */
function __buildLeblanc_R(api: ContentApi) {
  const EventType = api.enums.EventType;
  const uuidv4 = api.utils.uuidv4;
  const Spell = api.Spell;
  class Leblanc_R extends Spell {
    image = api.asset('spell_leblanc_r');
    name = 'Mô Phỏng (Leblanc_R)';
    description =
      'Tái hiện <span class="buff">kỹ năng gần nhất</span> mà LeBlanc đã dùng (bất kỳ chiêu nào ở ô Q, W, E, R —' +
      ' không tính phép bổ trợ), <span class="buff">bỏ qua thời gian hồi chiêu</span> của kỹ năng đó và' +
      ' <span class="buff">nhắm lại theo con trỏ hiện tại</span>. Biểu tượng R đổi theo chiêu sẽ được tái hiện.';
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    private tracking = false;
    private stopTracking: (() => void) | null = null;
    private lastCast: TrackedCast | null = null;
    private activeMimic: Spell | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'start', durationMs: this.coolDown },
      };
    }

    onUpdate(): void {
      // Lazy, not in the constructor: every spell is instantiated with a null
      // owner to build the champion picker, and `this.game` is unavailable
      // then. `onUpdate` only ever runs once this spell is on a live champion.
      if (!this.tracking) {
        this.tracking = true;
        this.stopTracking = this.game.eventManager.on(EventType.ON_POST_CAST_SPELL, this.handleCast);
      }

      if (this.activeMimic) {
        this.activeMimic.update();
        if (!isInFlight(this.activeMimic.state)) this.activeMimic = null;
      }
    }

    onSpellCast(context: CastContext): void {
      const SpellClass = this.lastCast?.SpellClass ?? this.defaultMimicClass();
      if (!SpellClass) return;

      const clone = new SpellClass(this.owner);
      // Mimic already paid its own cost; the mimicked ability must not charge again.
      clone.manaCost = 0;
      clone.healthCost = 0;

      /**
       * Aimed *now*, not replayed.
       *
       * The old version reused the original cast's `cursorWorld`, `direction` and
       * `target`, so Mimic fired at wherever the first cast had been pointed —
       * which looks like the ability ignoring your mouse, because it was. It also
       * meant walking between the two casts left the copy shooting at empty
       * ground, and a mimicked unit-target spell chasing a body that may have
       * died. Building the context through `createSpellContext` re-runs the same
       * `TargetResolver` a fresh press does, so UNIT spells re-acquire and
       * DIRECTION spells take the live cursor.
       */
      const resolved = this.game.createSpellContext?.(clone, this.owner, context.cursorWorld);
      if (resolved) {
        if (clone.press(resolved)) this.activeMimic = clone;
        return;
      }

      // No resolver, or nothing valid under the cursor: fall back to a direction
      // built from the live cursor rather than a stale one.
      const origin = Object.freeze({ x: this.owner.position.x, y: this.owner.position.y });
      const dx = context.cursorWorld.x - origin.x;
      const dy = context.cursorWorld.y - origin.y;
      const length = Math.hypot(dx, dy);
      const mimicContext: CastContext = Object.freeze({
        spellId: `${this.id}-mimic`,
        activationId: uuidv4(),
        startedAtMs: context.startedAtMs,
        caster: this.owner,
        origin,
        cursorWorld: Object.freeze({ ...context.cursorWorld }),
        direction: Object.freeze({
          x: length === 0 ? 0 : dx / length,
          y: length === 0 ? 0 : dy / length,
        }),
      });
      if (clone.press(mimicContext)) this.activeMimic = clone;
    }

    /** With nothing cast yet, Mimic falls back to whatever sits in the Q slot. */
    private defaultMimicClass(): (new (owner: any) => Spell) | null {
      const first = (this.owner.spells as Spell[])?.[FIRST_ABILITY_SLOT];
      if (!first || first === this) return null;
      return first.constructor as new (owner: any) => Spell;
    }

    onRemoved(): void {
      this.stopTracking?.();
      this.activeMimic?.cancel('SCENE_EXIT');
      this.activeMimic = null;
      super.onRemoved();
    }

    deactivate(): void {
      this.activeMimic?.cancel('SCENE_EXIT');
      this.activeMimic = null;
      super.deactivate();
    }

    private handleCast = (spell: Spell): void => {
      if (spell === this || spell.owner !== this.owner) return;

      const slot = (this.owner.spells as Spell[])?.indexOf(spell) ?? -1;
      if (slot < FIRST_ABILITY_SLOT || slot > LAST_ABILITY_SLOT) return;

      this.lastCast = {
        SpellClass: spell.constructor as new (owner: any) => Spell,
        image: spell.image,
        name: spell.name,
      };
      // The icon becomes the ability it will replay, so the slot answers "what
      // does pressing R do right now?" without the player having to remember.
      this.image = spell.image;
    };
  }
  return Leblanc_R;
}
const __cacheLeblanc_R = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_R>>();
export default function makeLeblanc_R(api: ContentApi) {
  const cached = __cacheLeblanc_R.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_R(api);
  __cacheLeblanc_R.set(api, built);
  return built;
}