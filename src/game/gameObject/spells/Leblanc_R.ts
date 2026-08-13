import AssetManager, { type AssetKey } from '../../../managers/AssetManager';
import EventType from '../../enums/EventType';
import { uuidv4 } from '../../../utils/index';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import Leblanc_Q from './Leblanc_Q';
import Leblanc_W from './Leblanc_W';
import Leblanc_E from './Leblanc_E';

// Exported so the suite asserts Mimic's wiring, not a copy of the numbers —
// retuning a value should not mean editing the test.
export const MANA_COST = 0;
export const COOLDOWN_MS = 9_000;

/**
 * The three abilities Mimic is allowed to recast. An explicit allowlist
 * rather than "everything but the ultimate" — the summoner spells also
 * fire `ON_POST_CAST_SPELL` on this same owner and must never be captured.
 */
const MIMICABLE_SPELLS = [Leblanc_Q, Leblanc_W, Leblanc_E] as const;
type MimicableSpellClass = (typeof MIMICABLE_SPELLS)[number];

interface TrackedCast {
  SpellClass: MimicableSpellClass;
  context: CastContext;
}

/** The wiki ships one Mimic icon per mimicked form; show whichever is live. */
const MIMIC_ICON_BY_SPELL = new Map<MimicableSpellClass, AssetKey>([
  [Leblanc_Q, 'spell_leblanc_r2'],
  [Leblanc_W, 'spell_leblanc_r3'],
  [Leblanc_E, 'spell_leblanc_r4'],
]);

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
export default class Leblanc_R extends Spell {
  image = AssetManager.get('spell_leblanc_r');
  name = 'Bắt Chước (Leblanc_R)';
  description =
    'Tái hiện kỹ năng thường gần nhất mà LeBlanc đã dùng (Q, W hoặc E), bỏ qua thời gian hồi chiêu của kỹ năng đó. Nếu chưa dùng kỹ năng nào, mặc định tái hiện Ấn Ký Ác Ý (Q).';
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
    const entry = this.lastCast;
    const SpellClass = entry?.SpellClass ?? Leblanc_Q;
    const source = entry?.context;

    const origin = Object.freeze({ x: this.owner.position.x, y: this.owner.position.y });
    const cursorWorld = source ? source.cursorWorld : context.cursorWorld;
    const dx = cursorWorld.x - origin.x;
    const dy = cursorWorld.y - origin.y;
    const length = Math.hypot(dx, dy);

    const mimicContext: CastContext = Object.freeze({
      spellId: `${this.id}-mimic`,
      activationId: uuidv4(),
      startedAtMs: context.startedAtMs,
      caster: this.owner,
      origin,
      cursorWorld,
      direction: source
        ? source.direction
        : Object.freeze({ x: length === 0 ? 0 : dx / length, y: length === 0 ? 0 : dy / length }),
      ...(source?.target !== undefined ? { target: source.target } : {}),
    });

    const clone = new SpellClass(this.owner);
    // Mimic already paid its own cost; the mimicked ability must not charge again.
    clone.manaCost = 0;
    clone.healthCost = 0;
    if (clone.press(mimicContext)) this.activeMimic = clone;
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
    const SpellClass = MIMICABLE_SPELLS.find(Class => spell instanceof Class);
    if (!SpellClass || !spell.castContext) return;
    this.lastCast = { SpellClass, context: spell.castContext };
    this.image = AssetManager.get(MIMIC_ICON_BY_SPELL.get(SpellClass)!);
  };
}
