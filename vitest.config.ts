import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // This config is separate from vite.config.ts (Vitest does not read it),
  // so anything the app's build needs to parse the source has to be repeated
  // here. `.vue` files went unnoticed by this gap for a while: nothing a
  // test imported unmocked reached one. It stopped being invisible the
  // moment `Game.ts` (imported directly, not mocked, by
  // tests/game/integration/SpellAimIntegration.test.ts) started pulling in
  // `InGameHUD.ts` -> `InGameHUD.vue` — Vitest's own esbuild transform can't
  // parse SFC syntax without this plugin.
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    // Agent git worktrees live at .claude/worktrees/<name>/ — full checkouts of
    // this repo nested inside it. Without this, a run in the main tree collects
    // every worktree's copy of every suite too, so the totals balloon and a
    // half-finished edit in someone else's worktree fails the run here.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
