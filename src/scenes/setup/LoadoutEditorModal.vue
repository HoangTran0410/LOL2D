<script setup lang="ts">
/**
 * The loadout editor: mode toggle, champion grid + D/F summoner slots, or the
 * 7 custom slots. One shared modal, bound to whichever participant's card was
 * tapped in the Players tab (the player's or one bot's) — the same component,
 * the same gesture either way; only which loadout it writes to differs. This
 * is what removes the old duplication, where the player's editor and an
 * expanded bot row's editor were two copies of the same UI that could both be
 * visible on screen at once.
 *
 * A slot (`SlotButton`) opens `SpellSelectorPane` *inside this same modal* —
 * `activeSlot` swaps the body between the two views rather than stacking a
 * second modal on top, so there is never more than one dialog open at a time.
 * `SpellSelectorPane` reads the slot's current choice for its initial
 * highlight and only calls back on `commit`; `cancel` just clears
 * `activeSlot` and the loadout is untouched, so "closing without committing
 * leaves the slot as it was" falls out of the data flow rather than needing
 * an explicit undo.
 */
import { ref, computed } from 'vue';
import type { ChampionLoadout, MatchRules, SlotChoice } from '../../game/config/PregameConfig';
import { SLOT_COUNT } from '../../game/config/PregameConfig';
import { SpellHotKeys } from '../../game/constants';
import { SpellGroups, type SpellCatalogEntry } from '../../game/preset';
import { getPregameCatalog } from './pregameCatalog';
import type { SelectorGroup, SpellClass } from './types';
import ChampionGrid from './ChampionGrid.vue';
import SlotButton from './SlotButton.vue';
import SpellSelectorPane from './SpellSelectorPane.vue';

const props = defineProps<{
  title: string;
  loadout: ChampionLoadout;
  matchRules: MatchRules;
}>();
const emit = defineEmits<{ change: [ChampionLoadout]; close: [] }>();

const { spellCatalog, summoners, catalogByClass } = getPregameCatalog();

/** A, Q, W, E, R, D, F — same order and source as the real in-game hotkeys. */
const SLOT_LABELS = SpellHotKeys.map(code => String.fromCharCode(code));

type ActiveSlot = { kind: 'summoner'; slot: 'D' | 'F' } | { kind: 'custom'; index: number } | null;
const activeSlot = ref<ActiveSlot>(null);

const setMode = (mode: 'champion' | 'custom'): void => {
  emit('change', { ...props.loadout, mode });
};
const pickChampion = (championName: string): void => {
  emit('change', { ...props.loadout, mode: 'champion', championName });
};

const summonerGroups: SelectorGroup[] = [{ name: null, entries: summoners }];
const catalogGroups: SelectorGroup[] = SpellGroups.map(group => ({
  name: group.name,
  entries: (group.spells as SpellClass[])
    .map(spellClass => catalogByClass.get(spellClass))
    .filter((entry): entry is SpellCatalogEntry => !!entry),
})).filter(group => group.entries.length > 0);

const slotLabel = (index: number): string => (index === 0 ? `${SLOT_LABELS[0]} · ĐT` : SLOT_LABELS[index]);
const slotHotkeyTitle = (index: number): string =>
  index === 0 ? 'Phím đòn đánh thường' : `Phím ${SLOT_LABELS[index]}`;

const selectorTitle = computed(() => {
  if (!activeSlot.value) return '';
  return activeSlot.value.kind === 'summoner'
    ? `Phép Bổ Trợ (${activeSlot.value.slot})`
    : slotLabel(activeSlot.value.index);
});
const selectorGroups = computed<SelectorGroup[]>(() =>
  activeSlot.value?.kind === 'summoner' ? summonerGroups : catalogGroups
);
const selectorAllowRandom = computed(() => activeSlot.value?.kind === 'custom');
const selectorCurrentChoice = computed<string>(() => {
  if (!activeSlot.value) return 'random';
  return activeSlot.value.kind === 'summoner'
    ? (activeSlot.value.slot === 'D' ? props.loadout.summonerD : props.loadout.summonerF)
    : (props.loadout.customSlots[activeSlot.value.index] ?? 'random');
});

const openSummonerSlot = (slot: 'D' | 'F'): void => {
  activeSlot.value = { kind: 'summoner', slot };
};
const openCustomSlot = (index: number): void => {
  activeSlot.value = { kind: 'custom', index };
};
const cancelSlot = (): void => {
  activeSlot.value = null;
};
const commitSlot = (choice: string): void => {
  const target = activeSlot.value;
  if (!target) return;
  if (target.kind === 'summoner') {
    const key = target.slot === 'D' ? 'summonerD' : 'summonerF';
    emit('change', { ...props.loadout, [key]: choice });
  } else {
    const nextSlots = props.loadout.customSlots.slice();
    nextSlots[target.index] = choice as SlotChoice;
    emit('change', { ...props.loadout, customSlots: nextSlots });
  }
  activeSlot.value = null;
};

const summonerIcon = (id: string) => summoners.find(s => s.id === id)?.display ?? null;
const slotIcon = (choice: SlotChoice) =>
  (choice !== 'random' ? (spellCatalog.find(e => e.id === choice)?.display ?? null) : null);
</script>

<template>
  <div class="pregame-modal-backdrop" @click.self="emit('close')">
    <div class="pregame-modal loadout-modal">
      <template v-if="!activeSlot">
        <header class="pregame-modal-header">
          <h3>{{ title }}</h3>
          <button type="button" class="pregame-icon-btn" title="Đóng" @click="emit('close')">
            <i class="fas fa-times"></i>
          </button>
        </header>

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

        <div v-if="loadout.mode === 'champion'" class="kit-mode-panel">
          <ChampionGrid :selected="loadout.championName" @pick="pickChampion" />
          <div class="summoner-row">
            <SlotButton
              label="D"
              hotkey-title="Phím D"
              :icon="summonerIcon(loadout.summonerD)"
              @open="openSummonerSlot('D')"
            />
            <SlotButton
              label="F"
              hotkey-title="Phím F"
              :icon="summonerIcon(loadout.summonerF)"
              @open="openSummonerSlot('F')"
            />
          </div>
        </div>

        <div v-else class="kit-mode-panel">
          <p class="custom-slot-hint">
            Ô A là đòn đánh thường: đổi ô này đổi luôn phím tấn công và nhịp đánh của tướng, không chỉ thêm
            một chiêu mới.
          </p>
          <div class="custom-slot-row">
            <SlotButton
              v-for="index in SLOT_COUNT"
              :key="index - 1"
              :label="slotLabel(index - 1)"
              :hotkey-title="slotHotkeyTitle(index - 1)"
              :icon="slotIcon(loadout.customSlots[index - 1] ?? 'random')"
              @open="openCustomSlot(index - 1)"
            />
          </div>
        </div>
      </template>

      <SpellSelectorPane
        v-else
        :title="selectorTitle"
        :groups="selectorGroups"
        :allow-random="selectorAllowRandom"
        :current-choice="selectorCurrentChoice"
        :match-rules="matchRules"
        @commit="commitSlot"
        @cancel="cancelSlot"
      />
    </div>
  </div>
</template>
