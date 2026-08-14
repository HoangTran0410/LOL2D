/**
 * Shared across the pregame setup components. A spell class is one of the ~85
 * named exports of `src/game/gameObject/spells/index.ts` — see the comment on
 * `SpellClass` in `game/preset.ts` for why this stays `any` rather than a
 * proper union: `AllSpells` is a namespace of classes, not a discriminated
 * type, and every consumer here only ever calls `new SpellClass(owner)` or
 * passes the reference back to `getSpellDisplay`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpellClass = any;
