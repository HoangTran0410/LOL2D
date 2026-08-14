import { ref, computed, type Ref, type ComputedRef } from 'vue';
import {
  loadPregameConfig,
  savePregameConfig,
  sanitizePregameConfig,
  toMatchRules,
  DEFAULT_PREGAME_CONFIG,
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
    setAiFlag,
    setCooldownReduction,
    setManaFree,
    resetToDefault,
  };
};
