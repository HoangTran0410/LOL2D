import { ref, computed, type Ref, type ComputedRef } from 'vue';
import {
  loadPregameConfig,
  savePregameConfig,
  sanitizePregameConfig,
  toMatchRules,
  DEFAULT_PREGAME_CONFIG,
  DEFAULT_CHAMPION_LOADOUT,
  AI_COUNT_MIN,
  type PregameConfig,
  type ChampionLoadout,
  type MatchRules,
} from '../../game/config/PregameConfig';

export interface PregameConfigController {
  config: Ref<PregameConfig>;
  /** `Spell.ts`-facing numbers derived from `config.rules` — recomputes whenever CDR/URF change. */
  matchRules: ComputedRef<MatchRules>;
  setPlayerLoadout(loadout: ChampionLoadout): void;
  setBotLoadout(index: number, loadout: ChampionLoadout): void;
  setAiCount(count: number): void;
  /** Remove one bot by list position (not just the last), shifting the rest up. */
  removeBotAt(index: number): void;
  setAiFlag(flag: 'autoMove' | 'autoAttack' | 'autoCast', value: boolean): void;
  setCooldownReduction(percent: number): void;
  setManaFree(value: boolean): void;
  resetToDefault(): void;
}

/**
 * The pregame screen's reactive state, and the one place that writes it to
 * `localStorage`. A thin Vue wrapper around `game/config/PregameConfig.ts` —
 * every read and write still goes through `loadPregameConfig`,
 * `savePregameConfig` and `sanitizePregameConfig` unchanged, so the
 * validation/versioning contract documented there is untouched. This module
 * only replaces the old `SetupScene.persist()` plumbing and the hand-written
 * `{ ...this.config, ... }` field updates with reactive state a template can
 * bind to directly.
 *
 * One instance per mount: `SetupScene.ts` mounts a fresh app in `enter()`, so
 * calling this at the top of `SetupScene.vue`'s `<script setup>` re-reads
 * `localStorage` on every entry, same as the old `enter() { this.config =
 * loadPregameConfig(); ... }`.
 */
export const usePregameConfig = (): PregameConfigController => {
  const config = ref<PregameConfig>(loadPregameConfig());

  const persist = (): void => {
    savePregameConfig(config.value);
  };

  const setPlayerLoadout = (loadout: ChampionLoadout): void => {
    config.value = { ...config.value, player: loadout };
    persist();
  };

  const setBotLoadout = (index: number, loadout: ChampionLoadout): void => {
    const bots = config.value.ai.bots.slice();
    bots[index] = loadout;
    config.value = { ...config.value, ai: { ...config.value.ai, bots } };
    persist();
  };

  const setAiCount = (count: number): void => {
    config.value = { ...config.value, ai: { ...config.value.ai, count } };
    persist();
  };

  /**
   * Remove the bot at `index` from the active list, shifting every bot after
   * it up one and dropping `count` by one. The remaining active bots keep
   * their loadouts — they just move down a slot — which is the whole point of
   * removing a *specific* bot rather than only the last one. The fixed-length
   * `bots` array (always `AI_COUNT_MAX` entries — see the type's doc comment)
   * is preserved by refilling the freed tail slot with a default loadout.
   *
   * `botBehaviours` is spliced in exactly the same step, because the two arrays
   * are index-aligned by definition: shift the kits without the flags and the
   * bot that moved down a slot inherits the behaviour of the bot that used to
   * be there. The freed tail slot is refilled from the *global* flags rather
   * than from `DEFAULT_BOT_BEHAVIOUR` — that is what a slot nobody has
   * configured means everywhere else (see `sanitizePregameConfig`'s migration
   * and `MatchDirector.addBot`), and this screen is where those flags are set.
   */
  const removeBotAt = (index: number): void => {
    if (index < 0 || index >= config.value.ai.count) return;
    const { autoMove, autoAttack, autoCast } = config.value.ai;

    const bots = config.value.ai.bots.slice();
    bots.splice(index, 1);
    bots.push(DEFAULT_CHAMPION_LOADOUT);

    const botBehaviours = config.value.ai.botBehaviours.slice();
    botBehaviours.splice(index, 1);
    botBehaviours.push({ autoMove, autoAttack, autoCast });

    const count = Math.max(AI_COUNT_MIN, config.value.ai.count - 1);
    config.value = {
      ...config.value,
      ai: { ...config.value.ai, count, bots, botBehaviours },
    };
    persist();
  };

  const setAiFlag = (flag: 'autoMove' | 'autoAttack' | 'autoCast', value: boolean): void => {
    config.value = { ...config.value, ai: { ...config.value.ai, [flag]: value } };
    persist();
  };

  const setCooldownReduction = (percent: number): void => {
    config.value = {
      ...config.value,
      rules: { ...config.value.rules, cooldownReductionPercent: percent },
    };
    persist();
  };

  const setManaFree = (value: boolean): void => {
    config.value = { ...config.value, rules: { ...config.value.rules, manaFree: value } };
    persist();
  };

  const resetToDefault = (): void => {
    config.value = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
    persist();
  };

  const matchRules = computed(() => toMatchRules(config.value.rules));

  return {
    config,
    matchRules,
    setPlayerLoadout,
    setBotLoadout,
    setAiCount,
    removeBotAt,
    setAiFlag,
    setCooldownReduction,
    setManaFree,
    resetToDefault,
  };
};
