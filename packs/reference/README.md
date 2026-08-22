# @moba2d/content-reference

Core's own content pack: one champion (Vera) and the Proving Grounds map,
shipped from inside this repository to prove core ships real content of its
own rather than existing only to host the Riot pack.

`@moba2d/core` is listed under `devDependencies`, not `dependencies`, for the
same reason `@moba2d/content-riot` lists it there: every crossing this pack
makes into core is `import type` — three modules
(`@moba2d/core/content/ContentApi`, `@moba2d/core/content/ContentPack`,
`@moba2d/core/content/types`), never a value. At runtime the pack needs
nothing of core; it receives a fully-built `ContentApi` object as the
argument to its own factory function and calls methods on that object, never
on an import. `tests/content/packBoundary.test.ts` enforces this — a value
import of any of the three, or an import of anything else core exposes, both
fail that scan. `package.json` cannot hold a comment, which is why this
explanation lives here instead of beside the `devDependencies` block itself.
