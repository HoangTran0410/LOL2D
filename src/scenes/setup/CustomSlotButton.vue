<script setup lang="ts">
/**
 * One slot (A/Q/W/E/R/D/F) in the free-form kit builder. Shows whatever is
 * currently assigned (or the random dice if the slot is 'random'). Tapping
 * the icon previews the assigned spell; tapping the rest of the slot opens
 * the shared catalogue picker to change it.
 */
import { computed } from 'vue';
import AssetManager from '../../managers/AssetManager';
import type { SlotChoice } from '../../game/config/PregameConfig';
import { getPregameCatalog } from './pregameCatalog';
import { usePregameOverlays } from './pregameOverlays';

const props = defineProps<{
  choice: SlotChoice;
  label: string;
  hotkeyTitle: string;
}>();
const emit = defineEmits<{ open: [] }>();

const { spellCatalog } = getPregameCatalog();
const { openSpellDetail } = usePregameOverlays();

const entry = computed(() =>
  props.choice !== 'random' ? spellCatalog.find(e => e.id === props.choice) : undefined
);
const iconSrc = computed(
  () => entry.value && (entry.value.display.iconUrl ?? AssetManager.placeholder(entry.value.display.name).url)
);

const previewIcon = (): void => {
  if (entry.value) openSpellDetail(entry.value.spellClass);
};
</script>

<template>
  <button type="button" class="custom-slot" @click="emit('open')">
    <span class="custom-slot-hotkey" :title="hotkeyTitle">{{ label }}</span>
    <div class="custom-slot-icon">
      <img v-if="entry" :src="iconSrc!" :alt="entry.display.name" @click.stop="previewIcon" />
      <i v-else class="fas fa-random"></i>
    </div>
    <div class="custom-slot-name">{{ entry ? entry.display.name : 'Ngẫu Nhiên' }}</div>
  </button>
</template>
