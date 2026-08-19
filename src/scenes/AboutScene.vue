<script setup lang="ts">
/**
 * The About screen's content: what LOL2D is, a link to the source, any
 * write-ups about the project, and a player-facing changelog.
 *
 * One scrollable panel rather than a tabbed one (contrast
 * `MatchConfigPanel.vue`): three short, read-only sections fit a single
 * scroll without needing per-section state to survive a re-mount, so a tab
 * bar here would only add a click between them for no control gained.
 *
 * `CHANGELOG` (`./about/changelog.ts`) and `ARTICLES` (`./about/articles.ts`)
 * are plain data — no `src/game/` import, see their own file comments and
 * `tests/scenes/aboutBootPath.test.ts` — and are the two files meant to be
 * edited directly, including by someone who does not read the rest of this
 * component.
 *
 * No hand-rolled touch scrolling here, unlike `MatchConfigPanel`'s tabs: that
 * machinery exists because the practice panel is also mounted *inside*
 * `#game-scene`, under `touch-action: none` (see `styles/game-scene.css`),
 * where a plain scroll container fights the canvas for the gesture. This
 * screen mounts over `#about-scene`, a sibling of `#game-scene` reached only
 * from the menu — no p5 canvas exists yet, `GameScene.syncTouches` only ever
 * claims touches whose target *is* that canvas (see its own comment), and
 * `body { overflow: hidden }` is the only ancestor rule in play. Plain
 * `overflow-y: auto` on `.about-body` is therefore the whole of the fix.
 */
import { CHANGELOG } from './about/changelog';
import { ARTICLES } from './about/articles';

const emit = defineEmits<{ close: [] }>();

const REPO_URL = 'https://github.com/HoangTran0410/LOL2D';
</script>

<template>
  <div class="about-panel">
    <header class="about-header">
      <h1>Giới thiệu</h1>
      <button
        type="button"
        class="about-close"
        id="about-close"
        title="Quay lại"
        @click="emit('close')"
      >
        <i class="fas fa-arrow-left" aria-hidden="true"></i>
      </button>
    </header>

    <div class="about-body">
      <section class="about-section about-intro">
        <p class="about-intro-text">
          <strong>LOL2D</strong> là một game 2D chạy thẳng trên trình duyệt, lấy cảm hứng từ Liên
          Minh Huyền Thoại — dự án fan-made, không chính thức và không liên quan tới Riot Games.
          Chọn tướng, ghép đội hình Xanh/Đỏ, ghép chiêu thức, đẩy lính, hạ trụ và đối đầu với đối thủ ngay
          trên điện thoại hay máy tính, không cần cài thêm gì ngoài trình duyệt.
        </p>
        <div class="about-link-row">
          <a
            class="hextech-btn secondary about-link"
            :href="REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i class="fab fa-github" aria-hidden="true"></i> Xem mã nguồn trên GitHub
          </a>
        </div>
      </section>

      <section class="about-section about-articles">
        <h2>Bài viết</h2>
        <ul v-if="ARTICLES.length" class="about-article-list">
          <li v-for="article in ARTICLES" :key="article.url" class="about-article">
            <a
              class="about-article-title"
              :href="article.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ article.title }}
            </a>
            <p class="about-article-desc">{{ article.description }}</p>
          </li>
        </ul>
        <p v-else class="about-empty">Chưa có bài viết nào ở đây.</p>
      </section>

      <section class="about-section about-changelog">
        <h2>Có gì mới</h2>
        <article
          v-for="release in CHANGELOG"
          :key="release.date + release.title"
          class="about-release"
        >
          <h3 class="about-release-title">
            {{ release.title }}
            <span class="about-release-date">{{ release.date }}</span>
          </h3>
          <ul class="about-release-list">
            <li v-for="item in release.highlights" :key="item">{{ item }}</li>
          </ul>
        </article>
      </section>
    </div>
  </div>
</template>
