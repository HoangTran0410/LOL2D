# @moba2d/content-riot

The Riot-champion content pack: 58 playable champions' worth of spells,
monsters and the Summoner's Rift map, built against `@moba2d/core`'s public
`ContentApi`. (Checked, not rounded: `packs/riot/data.ts`'s own
`ROSTER`/`championEntries()` produces exactly 58 entries with `playable:
true`, one per file-name prefix under `spells/` that carries a `_Q`/`_W`/
`_E`/`_R` suffix — the same count `vite.config.ts`'s per-champion chunking
groups by. The pack's spell files total more than that: a handful — `Flash`,
`Ghost`, `Heal`, `Ignite`, `StealthWard` — carry no champion prefix at all
and share one `spell-common` chunk, which is why "champions" and "spell
chunks" are two different, both-correct numbers.)

`@moba2d/core` is listed under `devDependencies`, not `dependencies`, on
purpose: every crossing this pack makes into core is `import type` — three
modules (`@moba2d/core/content/ContentApi`, `@moba2d/core/content/ContentPack`,
`@moba2d/core/content/types`), never a value. At runtime the pack needs
nothing of core; it receives a fully-built `ContentApi` object as the
argument to its own factory function and calls methods on that object, never
on an import. `tests/content/packBoundary.test.ts` enforces this — a value
import of any of the three, or an import of anything else core exposes, both
fail that scan. `package.json` cannot hold a comment, which is why this
explanation lives here instead of beside the `devDependencies` block itself.
`packs/reference/README.md` points back here rather than repeating this
paragraph — the reasoning is identical for both packs, so it has one home.
