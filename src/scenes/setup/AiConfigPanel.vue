<script setup lang="ts">
/** The "Tướng Địch (AI)" column: bot count and the three AI behaviour flags shared by every bot. */
import { AI_COUNT_MIN, AI_COUNT_MAX } from '../../game/config/PregameConfig';

defineProps<{
  count: number;
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
}>();
const emit = defineEmits<{
  'update:count': [number];
  'update:autoMove': [boolean];
  'update:autoAttack': [boolean];
  'update:autoCast': [boolean];
}>();

const onCountInput = (event: Event): void => {
  emit('update:count', Number((event.target as HTMLInputElement).value));
};
</script>

<template>
  <div class="pregame-column">
    <h2>Tướng Địch (AI)</h2>
    <label class="pregame-field">
      <span>Số lượng tướng AI: <strong id="pregame-ai-count-value">{{ count }}</strong></span>
      <input
        type="range"
        id="pregame-ai-count"
        :min="AI_COUNT_MIN"
        :max="AI_COUNT_MAX"
        step="1"
        :value="count"
        @input="onCountInput"
      />
    </label>
    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="pregame-ai-automove"
        :checked="autoMove"
        @change="emit('update:autoMove', ($event.target as HTMLInputElement).checked)"
      />
      <span>AI tự di chuyển</span>
    </label>
    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="pregame-ai-autoattack"
        :checked="autoAttack"
        @change="emit('update:autoAttack', ($event.target as HTMLInputElement).checked)"
      />
      <span>AI tự tấn công</span>
    </label>
    <label class="pregame-toggle">
      <input
        type="checkbox"
        id="pregame-ai-autocast"
        :checked="autoCast"
        @change="emit('update:autoCast', ($event.target as HTMLInputElement).checked)"
      />
      <span>AI tự dùng kỹ năng</span>
    </label>
  </div>
</template>
