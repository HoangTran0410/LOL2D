<script setup lang="ts">
/**
 * One card in the champion grid — a real champion's portrait, name and Q/W/E/R
 * icons, or (when `champion` is null) the "Ngẫu Nhiên" random card that always
 * leads the grid.
 *
 * Two click targets, not a hit-target split: `.champion-card-pick` is an
 * invisible button covering the whole card (`position:absolute;inset:0` in
 * pregame-scene.css) that picks the champion — tap the portrait, the name,
 * empty padding, anywhere. Each ability icon is a *real*, visibly bordered
 * button (`.champion-spell-btn`) stacked above it (`position:relative`, so
 * it wins the click) that opens a read-only preview instead. This used to be
 * exactly that: an icon that opened a description and everything else that
 * picked, with the ambiguity that tapping "close to" an icon silently picked
 * instead of previewing. The fix is not removing the icon's own behaviour —
 * a player choosing between champions needs to read what their kit does —
 * it's making the icon an unmistakable button (border, hover state) instead
 * of a silent pixel boundary inside the same control that picks. See
 * `SpellDetailPane.vue` for what the preview it opens actually renders.
 *
 * Two real `<button>`s can't nest (invalid HTML, and Safari/VoiceOver do
 * strange things with it), which is why the pick control isn't simply the
 * outer element any more — see `.champion-card-pick` in pregame-scene.css.
 */
import AssetManager from '../../managers/AssetManager';
import type { SelectableChampion } from '../../game/preset';
import type { SpellClass } from './types';
import SpellIcon from './SpellIcon.vue';

defineProps<{
  champion: SelectableChampion | null;
  selected: boolean;
}>();
const emit = defineEmits<{ pick: []; preview: [spellClass: SpellClass] }>();
</script>

<template>
  <div class="champion-card" :class="{ selected }" :data-champion="champion ? champion.name : 'random'">
    <button
      type="button"
      class="champion-card-pick"
      :aria-label="champion ? `Chọn ${champion.name}` : 'Chọn ngẫu nhiên'"
      @click="emit('pick')"
    ></button>

    <div class="champion-portrait" :class="{ 'champion-portrait-random': !champion }">
      <img v-if="champion" :src="AssetManager.get(champion.avatar).url" :alt="champion.name" />
      <i v-else class="fas fa-random"></i>
    </div>
    <div class="champion-name">{{ champion ? champion.name : 'Ngẫu Nhiên' }}</div>
    <div v-if="champion" class="champion-spells">
      <button
        v-for="(spell, idx) in champion.spells"
        :key="idx"
        type="button"
        class="champion-spell-btn"
        title="Xem mô tả chiêu"
        @click="emit('preview', spell.spellClass)"
      >
        <SpellIcon :display="spell.display" />
      </button>
    </div>
  </div>
</template>
