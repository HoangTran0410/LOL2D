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
</template>
