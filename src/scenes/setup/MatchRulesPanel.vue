<script setup lang="ts">
/** The "Luật Đấu" column: cooldown reduction and URF. */
import { CDR_PERCENT_MIN, CDR_PERCENT_MAX } from '@/game/config/PregameConfig';

defineProps<{
  cooldownReductionPercent: number;
  manaFree: boolean;
}>();
const emit = defineEmits<{
  'update:cooldownReductionPercent': [number];
  'update:manaFree': [boolean];
}>();

const onCdrInput = (event: Event): void => {
  emit('update:cooldownReductionPercent', Number((event.target as HTMLInputElement).value));
};
</script>

<template>
  <div class="pregame-column">
    <h2>Luật Đấu</h2>
    <label class="pregame-field">
      <span
        >Giảm hồi chiêu:
        <strong id="pregame-cdr-value">{{ cooldownReductionPercent }}%</strong></span
      >
      <input
        type="range"
        id="pregame-cdr"
        :min="CDR_PERCENT_MIN"
        :max="CDR_PERCENT_MAX"
        step="10"
        :value="cooldownReductionPercent"
        @input="onCdrInput"
      />
    </label>
    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="pregame-urf"
        :checked="manaFree"
        @change="emit('update:manaFree', ($event.target as HTMLInputElement).checked)"
      />
      <span>URF (không tốn mana)</span>
    </label>
  </div>
</template>
