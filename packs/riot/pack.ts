export { data, BUNDLED_PACK_ID } from './data';
export { default } from './code';

/**
 * The riot pack's own entry point — the same shape `packs/reference/pack.ts`
 * gives `src/content/install.ts`: a `data` named export and a default code
 * factory, from one specifier.
 *
 * Unlike the reference pack, the two halves are not authored in this file —
 * they live in `./data.ts` and `./code.ts`, genuinely separate modules, and
 * this file only re-exports them. That split is the point of this task
 * (batch 4 task 7, replacing `src/content/bundledPack.ts`, whose own header
 * called itself "scaffolding with a date on it" since batch 2): the old
 * adapter kept its data and code halves as two objects in *one* file, and
 * `vite.config.ts`'s own chunking notes warned that pattern is only safe at
 * `packs/reference/`'s scale (four spells) — at this pack's scale (237),
 * folding the code half's real spell/monster classes into the same module
 * the menu's picker reads for a roster would risk exactly the regression
 * `packs/reference/`'s own carve-out exists to avoid. `./data.ts` has no
 * import that reaches `@moba2d/core/content/ContentApi` as a value, and `./code.ts` is
 * the only file in this pack that does — a fact `vite.config.ts` now pins
 * both of them against by path, not merely by convention.
 *
 * A re-export this thin costs nothing wherever Rollup places it, so this
 * file itself carries no chunking decision of its own — see
 * `vite.config.ts`'s own comment on the rule that pins `./data.ts`/`./code.ts`.
 */
