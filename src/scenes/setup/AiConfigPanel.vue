<script setup lang="ts">
/**
 * The "Tướng Địch (AI)" panel: the three AI behaviour flags shared by every
 * bot. How *many* bots there are lives in the Players tab now, as direct
 * manipulation on the participant list (`PlayersTab.vue`'s "Thêm Bot" and
 * per-row remove) rather than a slider here — a count control in a tab you
 * can't see silently changing a list in a tab you can was exactly the
 * indirection this screen's redesign removes. This panel does not duplicate
 * it.
 */
defineProps<{
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
}>();
const emit = defineEmits<{
  'update:autoMove': [boolean];
  'update:autoAttack': [boolean];
  'update:autoCast': [boolean];
}>();
</script>

<template>
  <div class="pregame-column">
    <h2>Tướng Địch (AI)</h2>
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
