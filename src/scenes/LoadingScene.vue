<script setup lang="ts">
/**
 * The loading screen, as a component.
 *
 * The reference conversion for this codebase: it shows what replaces the
 * `document.querySelector` handles the scenes were built on, and how a Vue
 * component sits under the custom `SceneManager` rather than a router.
 *
 * The rule the whole migration follows: **the component owns its own markup
 * and its own state, and the `Scene` subclass owns only the lifecycle**. The
 * scene mounts on `enter`, unmounts on `exit`, and never reaches into the DOM
 * the component rendered. Nothing here touches a p5 global, which is what
 * keeps this safe to construct at module load — p5 lives on the canvas, Vue
 * lives on the overlay, and the two never share an element.
 */
import { ref } from 'vue';
import AssetManager from '@/managers/AssetManager';

const logo = AssetManager.get('other_logo').url;

/** Reactive state, in place of writing `.style` and `.innerHTML` by hand. */
const message = ref('Đang tải tài nguyên game...');
const error = ref('');
const progress = ref(0);
const showProgress = ref(true);

/**
 * Exposed so `LoadingScene.ts` can drive the screen without a DOM handle. The
 * asset loading itself deliberately stays in the scene: it decides which scene
 * comes next, which is lifecycle, not presentation.
 */
defineExpose({
  setMessage: (text: string) => (message.value = text),
  setProgress: (percent: number) => (progress.value = percent),
  fail: (text: string) => {
    error.value = text;
    showProgress.value = false;
  },
  reset: () => {
    message.value = 'Đang tải tài nguyên game...';
    error.value = '';
    progress.value = 0;
    showProgress.value = true;
  },
});
</script>

<!-- Renders the *inside* of #loading-scene, not the element itself: the
     container stays in index.html and is the mount host. Keeping the wrapper
     where it was means the rendered DOM is identical to the hand-built one, so
     no stylesheet had to move with this conversion. -->
<template>
  <img id="loading-logo" class="logo" :src="logo" alt="" />
  <div class="progress" v-show="showProgress">
    <div class="progress-bar" :style="{ width: progress + '%' }"></div>
  </div>
  <div class="loading-text">{{ message }}</div>
  <!-- v-html because the failure text carries a <br/> between the sentence
       and the underlying error message -->
  <h2 class="error-text" v-html="error"></h2>
</template>
