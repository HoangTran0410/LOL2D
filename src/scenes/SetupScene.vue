<script setup lang="ts">
/**
 * The pregame setup screen: pick a champion (bundled Q/W/E/R kit) or build a
 * kit slot by slot from the whole spell catalogue, pick summoner spells,
 * configure each AI bot's champion/kit individually (plus the AI behaviour
 * flags shared by all of them), and set match-wide rules (cooldown
 * reduction, URF).
 *
 * All state lives here, in `usePregameConfig` — every control writes
 * straight through to `localStorage` on change (no separate "Save" step) via
 * the same `savePregameConfig` the pre-Vue version used. `SetupScene.ts`
 * owns only the two scene transitions ("Quay lại" and "Bắt Đầu"/"Mặc Định"
 * doesn't transition), passed in as `onBack`/`onStart` props — a running game
 * never reaches back into this screen, and this screen never reaches into
 * `sceneManager` directly.
 *
 * Decomposed along the seams the original hand-built version already named
 * in its own comments: the champion grid (`ChampionGrid`/`ChampionCard`),
 * the loadout/slot editor shared by the player and every bot
 * (`LoadoutEditor`, `SummonerSlot`, `CustomSlotButton`), the spell catalogue
 * picker (`SpellCatalogPicker`) and spell detail panel (`SpellDetailPanel`)
 * — both singletons shared across the whole tree via `usePregameOverlays` —
 * the per-bot accordion (`BotAccordion`/`BotRow`), and the match-rules /
 * AI-config sliders (`MatchRulesPanel`/`AiConfigPanel`).
 */
import { ref } from 'vue';
import { usePregameConfig } from './setup/usePregameConfig';
import { providePregameOverlays } from './setup/pregameOverlays';
import type { SpellClass } from './setup/types';
import LoadoutEditor from './setup/LoadoutEditor.vue';
import AiConfigPanel from './setup/AiConfigPanel.vue';
import MatchRulesPanel from './setup/MatchRulesPanel.vue';
import BotAccordion from './setup/BotAccordion.vue';
import SpellCatalogPicker from './setup/SpellCatalogPicker.vue';
import SpellDetailPanel from './setup/SpellDetailPanel.vue';

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

// ------------------------------------------------------------ shared overlays
// One spell-detail panel and one catalogue picker, opened from anywhere in
// the tree below (see pregameOverlays.ts for why this is provide/inject
// rather than an emit relayed through every intermediate component).

const detailSpellClass = ref<SpellClass | null>(null);
let catalogOnPick: ((choice: string) => void) | null = null;
const catalogOpen = ref(false);

providePregameOverlays({
  openSpellDetail(spellClass) {
    detailSpellClass.value = spellClass;
  },
  openCatalogPicker(onPick) {
    catalogOnPick = onPick;
    catalogOpen.value = true;
  },
});

const closeSpellDetail = (): void => {
  detailSpellClass.value = null;
};
const closeCatalogPicker = (): void => {
  catalogOpen.value = false;
};
const pickFromCatalog = (choice: string): void => {
  catalogOnPick?.(choice);
  catalogOnPick = null;
  catalogOpen.value = false;
};

// ------------------------------------------------------------ reset
// `resetToken` forces BotAccordion to remount (via :key) so the accordion
// collapses along with the config, matching the old
// `this.expandedBotIndex = null` in the reset handler.
const resetToken = ref(0);
const onReset = (): void => {
  resetToDefault();
  resetToken.value += 1;
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

    <div class="pregame-body">
      <section class="pregame-section">
        <h2>Tướng Của Bạn</h2>
        <div class="loadout-editor" id="pregame-player-editor">
          <LoadoutEditor :loadout="config.player" @change="setPlayerLoadout" />
        </div>
      </section>

      <section class="pregame-section pregame-columns">
        <AiConfigPanel
          :count="config.ai.count"
          :auto-move="config.ai.autoMove"
          :auto-attack="config.ai.autoAttack"
          :auto-cast="config.ai.autoCast"
          @update:count="setAiCount"
          @update:auto-move="v => setAiFlag('autoMove', v)"
          @update:auto-attack="v => setAiFlag('autoAttack', v)"
          @update:auto-cast="v => setAiFlag('autoCast', v)"
        />
        <MatchRulesPanel
          :cooldown-reduction-percent="config.rules.cooldownReductionPercent"
          :mana-free="config.rules.manaFree"
          @update:cooldown-reduction-percent="setCooldownReduction"
          @update:mana-free="setManaFree"
        />
      </section>

      <section class="pregame-section">
        <h2>Cấu Hình Từng Bot AI</h2>
        <p class="pregame-hint">
          Mỗi bot mặc định Ngẫu Nhiên — bấm vào một bot để đổi tướng/chiêu riêng cho nó.
        </p>
        <BotAccordion :key="resetToken" :bots="config.ai.bots" :count="config.ai.count" @change="setBotLoadout" />
      </section>
    </div>

    <footer class="pregame-actions">
      <button id="pregame-reset-btn" class="hextech-btn secondary" @click="onReset">Mặc Định</button>
      <button id="pregame-start-btn" class="hextech-btn" @click="emit('start')">Bắt Đầu</button>
    </footer>
  </div>

  <SpellCatalogPicker :open="catalogOpen" @close="closeCatalogPicker" @pick="pickFromCatalog" />
  <SpellDetailPanel :spell-class="detailSpellClass" :match-rules="matchRules" @close="closeSpellDetail" />
</template>
