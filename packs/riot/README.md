# @moba2d/content-riot

The Riot-champion content pack: 58 champions' worth of spells, monsters and
the Summoner's Rift map, built against `@moba2d/core`'s public `ContentApi`.

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
