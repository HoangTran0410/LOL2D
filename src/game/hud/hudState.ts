/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Everything the HUD needs to *know*, with no opinion on how it is drawn.
 *
 * This is the shared layer both view layers (`DesktopHudView`, `MobileHudView`)
 * read from. It exists so the desktop and mobile HUDs can be extended
 * independently without ever forking the arithmetic that turns a `Game` into
 * "66/100 health" or "this spell is greyed out" — that logic is written once,
 * here, and both views only choose how to lay the result out.
 */
import type Game from '@/game/Game';
import { HotKeys, SpellHotKeys } from '@/game/constants';
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';

function ensureVisibleAsset(asset: Pick<AssetHandle, 'key' | 'status'> | undefined): void {
  if (asset?.key && asset.status === 'idle') {
    void AssetManager.ensure(asset.key).catch(error => console.warn(error));
  }
}

/**
 * How often the HUD reads the game, in milliseconds.
 *
 * It used to run on every animation frame, which meant rebuilding the spell and
 * buff arrays sixty times a second and handing Vue a fresh identity for every
 * one of them — style recalculation and patching on a phone that is already
 * several times slower than the desktop this was written on. Nothing here
 * changes fast enough to need it: the health bar carries a 0.1s CSS transition
 * that smooths the gaps, the cooldown numbers are whole seconds, and the wedge
 * is a percentage nobody can read to the frame. 50ms is twenty reads a second,
 * which is still four times finer than the fastest thing on screen.
 */
export const HUD_UPDATE_INTERVAL_MS = 50;

export interface SpellDisplay {
  instance: any;
  image: string;
  disabled: boolean;
  coolDown: number;
  currentCooldown: number;
  state: string;
  name: string;
  description: string;
  coolDownText: number;
  coolDownPercent: number;
  showCoolDown: boolean;
  /** True only for a real wait. A swing rhythm gets the wedge and nothing else. */
  lockedOut: boolean;
  small: boolean;
  canCast: boolean;
  hotKey: string;
  /** Undefined for spells that do not accumulate anything. */
  stackCount?: number;
  manaCost: number;
  /** False once the pool has dropped below manaCost, which greys the icon. */
  affordable: boolean;
}

export interface BuffDisplay {
  image: string;
  duration: number;
  timeElapsed: number;
  timeLeftText: number;
  stacks: number;
}

export interface StatsDisplay {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  healthPercent: number;
  manaPercent: number;
  shieldPercent: number;
  shieldLeftPercent: number;
  shield: number;
}

/**
 * Hồi Thành, which is not a `SpellDisplay` because it is not in `spells[]` —
 * it lives on `Champion.recall` (see that class's comment for why) and the bar
 * is built by index off the kit. Its own row here keeps that separation
 * visible instead of smuggling an eighth slot into a seven-slot array.
 */
export interface RecallDisplay {
  name: string;
  description: string;
  /** `B`. The key is one way in, not the definition of the action. */
  hotKey: string;
  /** The trip home is running, so the button now cancels it. */
  channeling: boolean;
  /** 0..100 through the channel, clamped: the button fills by this. */
  progressPercent: number;
  /** Whole seconds of channel left. 0 while it is not running. */
  secondsLeft: number;
  /** False for a corpse, a silenced champion, or a disabled recall. */
  canCast: boolean;
}

export interface HudState {
  avatar: string;
  isDead: boolean;
  reviveAfter: number;
  stats: StatsDisplay;
  spells: SpellDisplay[];
  buffs: BuffDisplay[];
  /** Null for a unit with no recall at all — a headless test, mostly. */
  recall: RecallDisplay | null;
}

function buildStats(player: any): StatsDisplay {
  const { health, maxHealth, mana, maxMana } = player.stats || {};
  const healthPercent = Math.min((health?.value as number) / maxHealth?.value, 1) * 100;
  const shield = player.shieldAmount ?? 0;
  const shieldPercent = Math.min(shield / (maxHealth?.value || 1), 1) * 100;
  return {
    health: ~~health?.value,
    maxHealth: ~~maxHealth?.value,
    mana: ~~mana?.value,
    maxMana: ~~maxMana?.value,
    healthPercent,
    manaPercent: Math.min((mana?.value as number) / maxMana?.value, 1) * 100,
    shield: ~~shield,
    shieldPercent,
    shieldLeftPercent: Math.min(healthPercent, 100 - shieldPercent),
  };
}

function buildSpells(player: any): SpellDisplay[] {
  const mana = player.stats?.mana;
  return (player.spells || [])
    .filter((i: any) => i?.image?.path)
    .map((spell: any, index: number) => {
      ensureVisibleAsset(spell.image);
      const isInternalSpell = index === 0;
      const isSummonerSpell = index > 4;
      const hotKey = SpellHotKeys[index]
        ? String.fromCharCode(SpellHotKeys[index]).toUpperCase()
        : '';

      const { disabled, image, state, currentCooldown, name, description, stackCount } =
        spell || {};

      // The *effective* numbers, not the spell's own tuning fields: under a
      // cooldown-reduction or URF match those differ, and the icon has to agree
      // with what the cast path actually charges and waits. `currentCooldown`
      // already counts down from the reduced duration, so using the raw
      // `coolDown` as the denominator would also under-fill the sweep.
      // These are equipped spells, so an owner and its match rules always
      // exist — ownerless instances built by `pregameCatalog` cannot see match
      // rules and stay on raw numbers.
      const coolDown = spell?.effectiveCoolDownMs ?? spell?.coolDown ?? 0;
      const manaCost = spell?.effectiveManaCost ?? spell?.manaCost ?? 0;

      return {
        instance: spell,
        image: image?.path,
        disabled,
        coolDown,
        currentCooldown,
        state,
        name,
        description,
        coolDownText: Math.ceil(currentCooldown / 1000),
        coolDownPercent: coolDown > 0 ? Math.min((currentCooldown / coolDown) * 100, 100) : 0,
        showCoolDown: currentCooldown > 0,
        // `!== false` so a spell that never heard of the flag still reads as a
        // lockout, which is what every cooldown but the swing timer is.
        lockedOut: currentCooldown > 0 && spell?.cooldownLocksOut !== false,
        small: isInternalSpell || isSummonerSpell,
        canCast: player.canCast && !player.isDead,
        hotKey,
        stackCount,
        manaCost,
        affordable: (mana?.value ?? 0) >= manaCost,
      };
    });
}

/**
 * One row per kind of buff, not per stack: one stacking spell alone can hold hundreds of
 * StatAmp instances, which used to render hundreds of icons. The longest
 * remaining instance drives the countdown.
 */
function buildBuffs(player: any): BuffDisplay[] {
  const buffRows = new Map<any, BuffDisplay>();
  for (const buff of player.buffs || []) {
    if (!buff?.image?.path) continue;
    ensureVisibleAsset(buff.image);

    const key = buff.stackId ?? buff.constructor;
    const timeLeft = (buff.duration || 0) - (buff.timeElapsed || 0);
    const existing = buffRows.get(key);
    // A `countedStacks` buff (`src/game/gameObject/Buff.ts` — a permanent,
    // uniform stat stack) is one instance carrying its whole
    // count on `.stacks`; every other buff has never heard of that field, so
    // this falls back to 1 and behaves exactly as a plain per-instance count.
    const stacks = buff.stacks ?? 1;

    if (existing) {
      existing.stacks += stacks;
      if (timeLeft > existing.duration - existing.timeElapsed) {
        existing.duration = buff.duration;
        existing.timeElapsed = buff.timeElapsed;
        existing.timeLeftText = Math.ceil(timeLeft / 1000);
      }
      continue;
    }

    buffRows.set(key, {
      image: buff.image.path,
      duration: buff.duration,
      timeElapsed: buff.timeElapsed,
      timeLeftText: Math.ceil(timeLeft / 1000),
      stacks,
    });
  }
  return [...buffRows.values()];
}

/**
 * The channel's length comes off the spell's own `castSpec.channel`, never off
 * a copy of `RECALL_CHANNEL_MS` — retuning the constant must not mean editing
 * the HUD, and importing the spell here would drag it into this shared layer.
 */
function buildRecall(player: any): RecallDisplay | null {
  const recall = player.recall;
  if (!recall) return null;

  const durationMs = recall.castSpec?.channel?.durationMs ?? 0;
  const progress = Math.min(1, Math.max(0, recall.channelProgress ?? 0));

  return {
    name: recall.name ?? '',
    description: recall.description ?? '',
    hotKey: String.fromCharCode(HotKeys.B),
    channeling: recall.state === 'CHANNELING',
    progressPercent: progress * 100,
    secondsLeft: Math.ceil(((1 - progress) * durationMs) / 1000),
    canCast: !!player.canCast && !player.isDead && !recall.disabled,
  };
}

/** Reads `game.player` and returns everything the HUD displays. Null while there is no player yet. */
export function computeHudState(game: Game | undefined | null): HudState | null {
  const player = (game as any)?.player;
  if (!player) return null;

  ensureVisibleAsset(player.avatar);

  return {
    avatar: player.avatar?.path || '',
    isDead: player.isDead,
    reviveAfter: ~~((player.deathData?.reviveAfter ?? 0) / 1000),
    stats: buildStats(player),
    spells: buildSpells(player),
    buffs: buildBuffs(player),
    recall: buildRecall(player),
  };
}
