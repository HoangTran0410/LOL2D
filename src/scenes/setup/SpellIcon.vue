<script setup lang="ts">
/**
 * A spell's icon, or the dice glyph for "no spell picked yet" (`display:
 * null` — a slot's `random` choice, or a champion loadout with no fixed
 * identity). Falls back to `AssetManager.placeholder` the same way every
 * spell-icon `<img>` on this screen always has, so this is the one place
 * that fallback is written rather than four.
 */
import AssetManager from '@/managers/AssetManager';

defineProps<{
  display: { iconUrl: string | null; name: string } | null;
  lazy?: boolean;
}>();
</script>

<template>
  <img
    v-if="display"
    :src="display.iconUrl ?? AssetManager.placeholder(display.name).url"
    :alt="display.name"
    :title="display.name"
    :loading="lazy ? 'lazy' : 'eager'"
    decoding="async"
  />
  <i v-else class="fas fa-random"></i>
</template>
