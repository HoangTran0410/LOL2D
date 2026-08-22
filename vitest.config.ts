import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
// @ts-expect-error — plain .mjs helpers shared with the build scripts, which
// have no types of their own and are not part of any TypeScript program.
import { installedContentPackages } from './scripts/installed-packs.mjs';
// @ts-expect-error — same.
import { packDependentTests } from './scripts/pack-dependent-tests.mjs';

/**
 * Test files whose subject is a content pack this checkout does not have.
 *
 * Empty in every ordinary checkout — both packs are here, so nothing is
 * excluded and all 281 files run. It is only ever non-empty inside
 * `npm run verify:without-packs`, the drill that moves `packs/riot/` out of
 * the tree and requires core to still build, boot and pass. Without this the
 * drill cannot even start: Vitest resolves every collected file's imports
 * before running anything, so one unresolvable `packs/riot/spells/Yasuo_Q`
 * fails the whole run rather than the file that named it.
 *
 * Derived, never listed: see `scripts/pack-dependent-tests.mjs` for why a glob
 * would have caught 69 of the 138 and why the closure is over `tests/`'s own
 * import graph.
 */
const installed = installedContentPackages(__dirname).map((pack: { name: string }) => pack.name);
const packDependent: string[] = packDependentTests(__dirname, installed);

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
    exclude: [...configDefaults.exclude, '**/.claude/**', ...packDependent],
  },
});
