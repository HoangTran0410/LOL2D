import { ref, computed, type Ref, type ComputedRef } from 'vue';
import {
  loadPregameConfig,
  savePregameConfig,
  sanitizePregameConfig,
  toMatchRules,
  DEFAULT_PREGAME_CONFIG,
  DEFAULT_CHAMPION_LOADOUT,
  AI_COUNT_MAX,
  AI_COUNT_MIN,
  type PregameConfig,
  type ChampionLoadout,
  type MatchRules,
} from '@/game/config/PregameConfig';
import { MatchTeam as TeamId, teamForAddedBot } from '@/game/config/MatchTeams';

export interface PregameConfigController {
  config: Ref<PregameConfig>;
  /** `Spell.ts`-facing numbers derived from `config.rules` — recomputes whenever CDR/URF change. */
  matchRules: ComputedRef<MatchRules>;
  setPlayerLoadout(loadout: ChampionLoadout): void;
  setBotLoadout(index: number, loadout: ChampionLoadout): void;
  /** Activates new slots on the less populated team without moving existing bots. */
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
    const nextCount = Math.min(AI_COUNT_MAX, Math.max(AI_COUNT_MIN, Math.round(count)));
    const previousCount = config.value.ai.count;
    const botTeams = config.value.ai.botTeams.slice();

    // A slot becoming active is a new participant, even when its saved kit and
    // behaviour were retained while inactive. Pick only that new slot's side;
    // existing participants keep their teams byte-for-byte.
    for (let i = previousCount; i < nextCount; i++) {
      const members: { teamId: string }[] = [{ teamId: TeamId.BLUE }];
      for (let j = 0; j < i; j++) members.push({ teamId: botTeams[j] });
      botTeams[i] = teamForAddedBot(members);
    }

    config.value = {
      ...config.value,
      ai: { ...config.value.ai, count: nextCount, botTeams },
    };
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
   * `botTeams` and `botBehaviours` are spliced in the same step because all
   * three arrays are index-aligned: shift only the kit and the bot that moved
   * down inherits somebody else's side and behaviour. The freed behaviour slot
   * comes from the *global* flags rather than `DEFAULT_BOT_BEHAVIOUR`; its team
   * comes from the stable default slot at the tail.
   */
  const removeBotAt = (index: number): void => {
    if (index < 0 || index >= config.value.ai.count) return;
    const { autoMove, autoAttack, autoCast } = config.value.ai;

    const bots = config.value.ai.bots.slice();
    bots.splice(index, 1);
    bots.push(DEFAULT_CHAMPION_LOADOUT);

    const botTeams = config.value.ai.botTeams.slice();
    botTeams.splice(index, 1);
    botTeams.push(DEFAULT_PREGAME_CONFIG.ai.botTeams[AI_COUNT_MAX - 1]);

    const botBehaviours = config.value.ai.botBehaviours.slice();
    botBehaviours.splice(index, 1);
    botBehaviours.push({ autoMove, autoAttack, autoCast });

    const count = Math.max(AI_COUNT_MIN, config.value.ai.count - 1);
    config.value = {
      ...config.value,
      ai: { ...config.value.ai, count, bots, botTeams, botBehaviours },
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
