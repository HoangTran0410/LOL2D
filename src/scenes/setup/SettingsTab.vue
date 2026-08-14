<script setup lang="ts">
/** "Cấu hình" tab: AI behaviour and match-wide rules — nothing about who is playing, only how the match runs. */
import type { PregameConfig } from '../../game/config/PregameConfig';
import AiConfigPanel from './AiConfigPanel.vue';
import MatchRulesPanel from './MatchRulesPanel.vue';

defineProps<{
  config: PregameConfig;
  setAiFlag: (flag: 'autoMove' | 'autoAttack' | 'autoCast', value: boolean) => void;
  setCooldownReduction: (percent: number) => void;
  setManaFree: (value: boolean) => void;
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
  </div>
</template>
