<script setup lang="ts">
/**
 * The one match-configuration panel, mounted in two places.
 *
 * There used to be two: the pregame setup screen (`SetupScene.vue`, over
 * `localStorage`) and the in-game practice panel (`PracticePanel.vue`, over
 * `MatchDirector`). Two backends grew two independent sets of controls over the
 * same settings, and neither ended up a superset of the other — the setup
 * screen alone could pick an input mode, the panel alone could assign sides or
 * switch the jungle off. Every new control landed in whichever component its
 * author was editing.
 *
 * So there is one component, and it talks to `MatchConfigSource`. The host
 * decides which implementation it gets: `SetupScene.ts` hands it
 * `PregameConfigSource`, `InGameHUD.vue` hands it `MatchDirectorSource`.
 * Nothing below this line knows which.
 *
 * ## Three tabs, and why a fourth will not fit
 *
 * `.pregame-tab` is `flex: 1`, and the 390px-tall landscape phone this has to
 * survive holds three plus the close button. So: **Đội** (who is in the match
 * and every knob on each of them), **Trận đấu** (the match itself — rules, the
 * world, and the way out), **Cài đặt** (the device — controls, display, and the
 * debug layers). The old Gian lận tab is gone; its per-unit half is on each
 * champion's own row and its two global switches sit with the other display
 * settings.
 *
 * ## This component owns the shell; the tabs own only their bodies
 *
 * `.match-config-panel` (`.practice-panel`, unchanged) is the fixed, centred,
 * hextech-framed box; each tab body is the flex *item* that scrolls inside it,
 * with a definite height to fill rather than an intrinsic one. That division is
 * load-bearing — a `flex: 1 1 0` body inside a `max-height`-capped, otherwise
 * intrinsic box has no pinned size to grow into, and silently collapses.
 *
 * `v-if` on every tab with nothing kept alive: each reads its state from the
 * source when it mounts, so a re-mount costs nothing and loses nothing.
 *
 * ## The close button belongs to the shell, and means different things
 *
 * In a match the panel covers a paused match, so closing resumes it. On the
 * menu there is nothing underneath, so closing goes back — and the primary
 * action, Bắt đầu, is the *footer*, which exists only out there. Burying "start
 * the match" inside a tab would hide the one control the screen is for.
 *
 * ## Two DOM id prefixes, on purpose
 *
 * Most ids here are `practice-*` and a few are `pregame-*`, which reads as a
 * leftover and is not. Both are selector contracts with the e2e scripts, one
 * from each panel this replaced: `drive-practice-panel.mjs`,
 * `drive-roster-stats.mjs` and `drive-match-config.mjs` address tabs and rows by
 * the first, `drive-kit-builder.mjs` addresses the rules and the input-mode row
 * by the second. Renaming both to something accurate would touch five scripts
 * and buy nothing this comment does not. The *class* names are the honest ones.
 */
import { computed, provide, ref } from 'vue';
import type { MatchConfigSource } from './MatchConfigSource';
import { CONFIG_PANEL } from './panelState';
import { activePanelTab, type PanelTabId } from './panelTab';
import RosterTab from './RosterTab.vue';
import MatchTab from './MatchTab.vue';
import SettingsTab from './SettingsTab.vue';

const props = defineProps<{ source: MatchConfigSource }>();
const emit = defineEmits<{ close: []; start: [] }>();

const version = ref(0);
provide(CONFIG_PANEL, {
  source: props.source,
  version,
  invalidate: () => {
    version.value++;
  },
});

/** No match behind the panel — the menu. Drives the footer and every live-only control. */
const pregame = computed(() => props.source.live === null);

const TABS: { id: PanelTabId; label: string }[] = [
  { id: 'roster', label: 'Đội' },
  { id: 'rules', label: 'Trận đấu' },
  { id: 'settings', label: 'Cài đặt' },
];

const tab = activePanelTab;

const roster = ref<InstanceType<typeof RosterTab> | null>(null);

/**
 * Escape closes the innermost layer first — the loadout editor over a tab, not
 * the panel under it. In a match the key never reaches the DOM (p5 binds
 * `keydown` on `window` and `GameScene` routes it), so the host wires this to
 * `HudInteractions.onEscapeInner`; returning `false` lets Escape fall through
 * to the panel.
 */
defineExpose({ closeInnerLayer: (): boolean => roster.value?.closeEditor() ?? false });
</script>

<template>
  <div class="practice-panel match-config-panel" :class="{ 'is-pregame': pregame }">
    <div class="pregame-tabs practice-tabs">
      <button
        v-for="item of TABS"
        :key="item.id"
        type="button"
        class="pregame-tab practice-tab"
        :class="{ selected: tab === item.id }"
        :id="`practice-tab-${item.id}`"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>

      <!-- The shell's own way out, on every tab: no tab owns an exit from a
           panel that covers a paused match. -->
      <button
        type="button"
        class="practice-close"
        id="practice-close"
        :title="pregame ? 'Quay lại' : 'Đóng'"
        @click="emit('close')"
      >
        <i :class="pregame ? 'fas fa-arrow-left' : 'fas fa-times'"></i>
      </button>
    </div>

    <RosterTab v-if="tab === 'roster'" ref="roster" />
    <MatchTab v-if="tab === 'rules'" @close="emit('close')" />
    <SettingsTab v-if="tab === 'settings'" />

    <!-- Only outside a match, and only here: the one control the menu opened
         this panel to reach must not be inside a tab. -->
    <footer v-if="pregame" class="match-config-actions">
      <button id="pregame-start-btn" class="hextech-btn" @click="emit('start')">Bắt Đầu</button>
    </footer>
  </div>
</template>
