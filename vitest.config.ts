import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
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
