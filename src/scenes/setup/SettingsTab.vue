<script setup lang="ts">
/**
 * "Cấu hình" tab: AI behaviour, match-wide rules, and (see
 * `InputModePanel.vue`) which layout this screen and the real match use —
 * touch or pointer. That last one used to be a bare icon in the pregame
 * panel's corner, not a setting; it lives here now for the same reason
 * everything else on this tab does: it changes how the *match* runs, not
 * who is playing.
 */
import type { PregameConfig } from '../../game/config/PregameConfig';
import AiConfigPanel from './AiConfigPanel.vue';
import MatchRulesPanel from './MatchRulesPanel.vue';
import InputModePanel from './InputModePanel.vue';
import type { TouchModePreference } from '../../game/input/TouchControls';

defineProps<{
  config: PregameConfig;
  setAiFlag: (flag: 'autoMove' | 'autoAttack' | 'autoCast', value: boolean) => void;
  setCooldownReduction: (percent: number) => void;
  setManaFree: (value: boolean) => void;
  isTouchUi: boolean;
  inputMode: TouchModePreference;
  setInputMode: (preference: TouchModePreference) => void;
}>();
</script>

<template>
  <div class="pregame-columns">
    <AiConfigPanel
      :auto-move="config.ai.autoMove"
      :auto-attack="config.ai.autoAttack"
      :auto-cast="config.ai.autoCast"
      @update:auto-move="v => setAiFlag('autoMove', v)"
      @update:auto-attack="v => setAiFlag('autoAttack', v)"
      @update:auto-cast="v => setAiFlag('autoCast', v)"
    />
    <MatchRulesPanel
      :cooldown-reduction-percent="config.rules.cooldownReductionPercent"
      :mana-free="config.rules.manaFree"
      @update:cooldown-reduction-percent="setCooldownReduction"
      @update:mana-free="setManaFree"
    />
    <InputModePanel :is-touch-ui="isTouchUi" :mode="inputMode" @update:mode="setInputMode" />
  </div>
</template>
