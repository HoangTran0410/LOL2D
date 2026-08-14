<script setup lang="ts">
/**
 * One kit slot — a custom-mode A/Q/W/E/R/D/F slot, or a champion-mode D/F
 * summoner slot. Shows whatever is currently assigned; the whole button is
 * one target with one destination: tapping it (anywhere on it) opens the
 * spell selector for this slot. There is no second, competing target on the
 * icon itself any more — see `SpellSelectorPane.vue`'s file comment for what
 * used to sit here and why it was replaced.
 */
import SpellIcon from './SpellIcon.vue';

defineProps<{
  label: string;
  hotkeyTitle: string;
  icon: { iconUrl: string | null; name: string } | null;
}>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="kit-slot" :title="hotkeyTitle" @click="emit('open')">
    <span class="kit-slot-hotkey">{{ label }}</span>
    <div class="kit-slot-icon">
      <SpellIcon :display="icon" />
    </div>
    <div class="kit-slot-name">{{ icon ? icon.name : 'Ngẫu Nhiên' }}</div>
  </button>
</template>
