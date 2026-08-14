<script setup lang="ts">
/**
 * The pregame setup screen. Two tabs:
 *
 *   - "Tướng" (`PlayersTab`) — one list of participants, the player first and
 *     clearly marked, then every active bot, then the "add a bot" control as
 *     direct manipulation on that same list. Tapping any participant opens
 *     `LoadoutEditorModal` bound to their loadout — the *same* modal either
 *     way, which is what removes the old duplication (an always-visible
 *     player editor plus a second copy inline in whichever bot row was
 *     expanded).
 *   - "Cấu hình" (`SettingsTab`) — AI behaviour and match rules. Nothing
 *     about who is playing lives here any more.
 *
 * Defaulting to the Players tab is what makes the screen "read cleanly on
 * first open" (the owner's stated goal): a participant list plus two tab
 * buttons, not every control this screen has all at once.
 *
 * All persisted state lives in `usePregameConfig` — every control writes
 * straight through to `localStorage` on change, same as before this
 * redesign. `SetupScene.ts` owns only the two scene transitions ("Quay lại",
 * "Bắt Đầu" — "Mặc Định" doesn't transition), passed in as `onBack`/`onStart`
 * props, because a Vue component has no access to `sceneManager` itself.
 */
import { ref, computed } from 'vue';
import { usePregameConfig } from './setup/usePregameConfig';
import { useTouchUi } from './setup/useTouchUi';
import { AI_COUNT_MIN, AI_COUNT_MAX, type ChampionLoadout } from '../game/config/PregameConfig';
import { getSpellDisplay, type SpellDisplay } from '../game/preset';
import type { SpellClass } from './setup/types';
import PlayersTab from './setup/PlayersTab.vue';
import SettingsTab from './setup/SettingsTab.vue';
import LoadoutEditorModal from './setup/LoadoutEditorModal.vue';
import SpellPreviewModal from './setup/SpellPreviewModal.vue';

const emit = defineEmits<{ back: []; start: [] }>();

const {
  config,
  matchRules,
  setPlayerLoadout,
  setBotLoadout,
  setAiCount,
  setAiFlag,
  setCooldownReduction,
  setManaFree,
  resetToDefault,
} = usePregameConfig();

const { isTouchUi, mode: inputMode, setMode: setInputMode } = useTouchUi();

type Tab = 'players' | 'settings';
const activeTab = ref<Tab>('players');

// ------------------------------------------------------------ loadout modal
// Which participant's loadout editor is open, if any. Only one is ever
// mounted at a time — see the file comment above for why that is the point.
type EditTarget = { kind: 'player' } | { kind: 'bot'; index: number } | null;
const editTarget = ref<EditTarget>(null);

const editTitle = computed(() => {
  const target = editTarget.value;
  if (!target) return '';
  return target.kind === 'player' ? 'Tướng Của Bạn' : `Bot ${target.index + 1}`;
});
const editLoadout = computed<ChampionLoadout | null>(() => {
  const target = editTarget.value;
  if (!target) return null;
  return target.kind === 'player' ? config.value.player : config.value.ai.bots[target.index];
});

const openPlayerEditor = (): void => {
  editTarget.value = { kind: 'player' };
};
const openBotEditor = (index: number): void => {
  editTarget.value = { kind: 'bot', index };
};
const closeEditor = (): void => {
  editTarget.value = null;
};
const changeEditingLoadout = (loadout: ChampionLoadout): void => {
  const target = editTarget.value;
  if (!target) return;
  if (target.kind === 'player') setPlayerLoadout(loadout);
  else setBotLoadout(target.index, loadout);
};

const addBot = (): void => setAiCount(Math.min(AI_COUNT_MAX, config.value.ai.count + 1));
const removeBot = (): void => setAiCount(Math.max(AI_COUNT_MIN, config.value.ai.count - 1));

// --------------------------------------------------------- ability preview
// Reachable only from the Players tab's participant list (`ParticipantCard`'s
// kit-icon row), which is never visible while the loadout modal is open —
// see `SpellPreviewModal.vue`'s file comment for why that already guarantees
// "one dialog at a time" without needing to coordinate with `editTarget`.
const previewSpell = ref<SpellDisplay | null>(null);
const openPreview = (spellClass: SpellClass): void => {
  previewSpell.value = getSpellDisplay(spellClass, matchRules.value);
};
const closePreview = (): void => {
  previewSpell.value = null;
};

// "Mặc Định" lives in the footer, which the loadout modal's full-viewport
// backdrop covers whenever it is open — so there is never a stale
// `editTarget` to clean up here; reset only ever runs with the modal closed.
const onReset = (): void => {
  resetToDefault();
};
</script>

<template>
  <div class="pregame-panel">
    <header class="pregame-header">
      <button id="pregame-back-btn" class="pregame-icon-btn" title="Quay lại" @click="emit('back')">
        <i class="fas fa-arrow-left"></i>
      </button>
      <h1>Cấu Hình Trận Đấu</h1>
    </header>

    <div class="pregame-tabs" role="tablist">
      <button
        type="button"
        id="pregame-tab-players"
        class="pregame-tab"
        :class="{ selected: activeTab === 'players' }"
        @click="activeTab = 'players'"
      >
        <i class="fas fa-users"></i> Tướng
      </button>
      <button
        type="button"
        id="pregame-tab-settings"
        class="pregame-tab"
        :class="{ selected: activeTab === 'settings' }"
        @click="activeTab = 'settings'"
      >
        <i class="fas fa-sliders-h"></i> Cấu Hình
      </button>
    </div>

    <div class="pregame-body">
      <PlayersTab
        v-if="activeTab === 'players'"
        :config="config"
        @open-player="openPlayerEditor"
        @open-bot="openBotEditor"
        @add-bot="addBot"
        @remove-bot="removeBot"
        @preview-ability="openPreview"
      />
      <SettingsTab
        v-else
        :config="config"
        :set-ai-flag="setAiFlag"
        :set-cooldown-reduction="setCooldownReduction"
        :set-mana-free="setManaFree"
        :is-touch-ui="isTouchUi"
        :input-mode="inputMode"
        :set-input-mode="setInputMode"
      />
    </div>

    <footer class="pregame-actions">
      <button id="pregame-reset-btn" class="hextech-btn secondary" @click="onReset">Mặc Định</button>
      <button id="pregame-start-btn" class="hextech-btn" @click="emit('start')">Bắt Đầu</button>
    </footer>
  </div>

  <LoadoutEditorModal
    v-if="editLoadout"
    :title="editTitle"
    :loadout="editLoadout"
    :match-rules="matchRules"
    :is-touch-ui="isTouchUi"
    @change="changeEditingLoadout"
    @close="closeEditor"
  />

  <SpellPreviewModal v-if="previewSpell" :display="previewSpell" @close="closePreview" />
</template>
