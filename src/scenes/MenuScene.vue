<script setup lang="ts">
/**
 * The main menu: cycling background, logo, and the three buttons. Scene
 * transitions ("Chơi", "Cấu Hình Trận Đấu") are lifecycle, not presentation,
 * so this only emits — `MenuScene.ts` maps `play`/`openConfig` onto
 * `sceneManager.showScene`, the same split `LoadingScene.vue` uses for its
 * own scene handover.
 *
 * The background carousel and the fullscreen toggle are pure view state with
 * no scene-transition involved, so — unlike the two buttons above — they stay
 * entirely local to this component instead of being driven from `MenuScene.ts`.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import AssetManager, { type AssetKey } from '../managers/AssetManager';
import DomUtils from '../utils/dom.utils';
import { applyUpdate, offlineReady, updateReady } from '../pwa/updates';

const MENU_BACKGROUNDS: AssetKey[] = [
  'other_menu_bg_1',
  'other_menu_bg_2',
  'other_menu_bg_3',
  'other_menu_bg_4',
  'other_menu_bg_5',
  'other_menu_bg_6',
];

const emit = defineEmits<{ play: []; openConfig: [] }>();

const logo = AssetManager.get('other_newlogo_vi').url;
const backgroundUrl = ref('');
// Reads real document state rather than always starting from "not
// fullscreen": this component remounts on every menu entry (see
// MenuScene.ts), but the browser's actual fullscreen state does not reset
// just because the player visited the pregame screen and came back.
const isFullscreen = ref(!!document.fullscreenElement);

let currentBgIndex: number | undefined;
let interval: ReturnType<typeof setInterval> | null = null;

const nextBackground = (): void => {
  const maxIndex = MENU_BACKGROUNDS.length;
  if (currentBgIndex === undefined) {
    currentBgIndex = Math.floor(Math.random() * maxIndex) + 1;
  } else {
    currentBgIndex += 1;
    if (currentBgIndex > maxIndex) currentBgIndex = 1;
  }
  backgroundUrl.value = AssetManager.get(MENU_BACKGROUNDS[currentBgIndex - 1]).url;
};

onMounted(() => {
  nextBackground();
  interval = setInterval(nextBackground, 5000);
});
onUnmounted(() => {
  if (interval !== null) clearInterval(interval);
});

const toggleFullscreen = (): void => {
  isFullscreen.value = DomUtils.toggleFullscreen();
};

/**
 * ## The version stamp, and the update offer beside it
 *
 * `__APP_VERSION__` is `package.json`'s version, replaced at build time (see
 * `vite.config.ts`). It is on the menu rather than anywhere else for the
 * reason a version number is ever shown: so a player reporting "spell X is
 * broken" can say *which build* they are on. An installed PWA makes that
 * question real — it serves whatever it cached until it is told otherwise, so
 * two players can be on different builds of the same URL.
 *
 * Which is also why the update lives here. `src/pwa/updates.ts` holds the new
 * build back rather than swapping it in, and this is the screen where taking
 * the reload costs nothing: no match is running.
 *
 * The refs are module state, not component state — this component remounts on
 * every return to the menu, and a worker that finished installing while the
 * player was in a match must still be offered when they come back out.
 */
const appVersion = __APP_VERSION__;
const updating = ref(false);

const installUpdate = async (): Promise<void> => {
  updating.value = true;
  await applyUpdate();
};
</script>

<template>
  <div class="background" :style="{ backgroundImage: `url(${backgroundUrl})` }"></div>

  <div class="logo">
    <div class="shiny">
      <img id="menu-logo" alt="logo" class="logo" :src="logo" />
    </div>
    <p class="p2d slide-bck-center">2D</p>
  </div>

  <button id="play-btn" class="hextech-btn" @click="emit('play')">Chơi</button>
  <button id="config-btn" class="hextech-btn secondary" @click="emit('openConfig')">Cấu Hình Trận Đấu</button>

  <button id="fullscreen-btn" @click="toggleFullscreen">
    <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i>
  </button>

  <!-- Bottom corner, dim: findable when someone asks "what version are you
       on", invisible the rest of the time. -->
  <p id="menu-version" class="menu-version">
    v{{ appVersion }}
    <span v-if="offlineReady" class="menu-version-offline" title="Đã lưu để chơi offline">
      <i class="fas fa-circle-check" aria-hidden="true"></i> offline
    </span>
  </p>

  <!-- Only ever on the menu, and only when a build is already downloaded and
       waiting — so pressing it is a reload, not a download that might fail. -->
  <button
    v-if="updateReady"
    id="menu-update-btn"
    class="menu-update"
    :disabled="updating"
    @click="installUpdate"
  >
    <i class="fas fa-arrow-rotate-right" aria-hidden="true"></i>
    <span>{{ updating ? 'Đang cập nhật…' : 'Có bản mới — cập nhật' }}</span>
  </button>
</template>
