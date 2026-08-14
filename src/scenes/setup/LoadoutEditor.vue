<script setup lang="ts">
/**
 * A champion/kit editor: the "Chọn Tướng" / "Tự Ghép Chiêu" mode toggle, the
 * champion grid + summoner slots for champion mode, and the 7 custom slots
 * for kit mode. Reused for the player's own section and for whichever bot row
 * is expanded — one implementation, not a player-specific copy and a
 * bot-specific copy (see `BotRow.vue`).
 *
 * Renders a fragment (three top-level siblings, no wrapping element) so its
 * host stays exactly what it was as hand-built DOM: `#pregame-player-editor`
 * or a bot row's `.bot-row-editor` containing `.kit-mode-toggle` and the two
 * `.kit-mode-panel`s directly, not one level deeper.
 */
import type { ChampionLoadout, SlotChoice } from '../../game/config/PregameConfig';
import { SLOT_COUNT } from '../../game/config/PregameConfig';
import { SpellHotKeys } from '../../game/constants';
import { usePregameOverlays } from './pregameOverlays';
import ChampionGrid from './ChampionGrid.vue';
import SummonerSlot from './SummonerSlot.vue';
import CustomSlotButton from './CustomSlotButton.vue';

const props = defineProps<{ loadout: ChampionLoadout }>();
const emit = defineEmits<{ change: [ChampionLoadout] }>();

const { openCatalogPicker } = usePregameOverlays();

/** A, Q, W, E, R, D, F — same order and source as the real in-game hotkeys. */
const SLOT_LABELS = SpellHotKeys.map(code => String.fromCharCode(code));

const setMode = (mode: 'champion' | 'custom'): void => {
  emit('change', { ...props.loadout, mode });
};
const pickChampion = (championName: string): void => {
  emit('change', { ...props.loadout, mode: 'champion', championName });
};
const pickSummoner = (slot: 'D' | 'F', id: string): void => {
  emit('change', { ...props.loadout, [slot === 'D' ? 'summonerD' : 'summonerF']: id });
};
const pickSlot = (index: number): void => {
  openCatalogPicker((picked: SlotChoice) => {
    const nextSlots = props.loadout.customSlots.slice();
    nextSlots[index] = picked;
    emit('change', { ...props.loadout, customSlots: nextSlots });
  });
};

const slotLabel = (index: number): string => (index === 0 ? `${SLOT_LABELS[0]} · ĐT` : SLOT_LABELS[index]);
const slotTitle = (index: number): string =>
  index === 0 ? 'Phím đòn đánh thường' : `Phím ${SLOT_LABELS[index]}`;
</script>

<template>
  <div class="kit-mode-toggle">
    <button
      type="button"
      class="kit-mode-btn"
      :class="{ selected: loadout.mode === 'champion' }"
      @click="setMode('champion')"
    >
      Chọn Tướng
    </button>
    <button
      type="button"
      class="kit-mode-btn"
      :class="{ selected: loadout.mode === 'custom' }"
      @click="setMode('custom')"
    >
      Tự Ghép Chiêu
    </button>
  </div>

  <div class="kit-mode-panel" :hidden="loadout.mode !== 'champion'">
    <ChampionGrid :selected="loadout.championName" @pick="pickChampion" />
    <div class="summoner-row">
      <SummonerSlot slot="D" :selected="loadout.summonerD" @pick="id => pickSummoner('D', id)" />
      <SummonerSlot slot="F" :selected="loadout.summonerF" @pick="id => pickSummoner('F', id)" />
    </div>
  </div>

  <div class="kit-mode-panel" :hidden="loadout.mode !== 'custom'">
    <p class="custom-slot-hint">
      Ô A là đòn đánh thường: đổi ô này đổi luôn phím tấn công và nhịp đánh của tướng, không chỉ thêm một
      chiêu mới.
    </p>
    <div class="custom-slot-row">
      <CustomSlotButton
        v-for="index in SLOT_COUNT"
        :key="index - 1"
        :choice="loadout.customSlots[index - 1] ?? 'random'"
        :label="slotLabel(index - 1)"
        :hotkey-title="slotTitle(index - 1)"
        @open="pickSlot(index - 1)"
      />
    </div>
  </div>
</template>
