import type { ContentApi } from '@moba2d/core/content/ContentApi';

/** Vera's W — a self shield. Exercises `api.buffs` and a SELF cast. */
export const VERA_W_SHIELD = 30;
export const VERA_W_DURATION_MS = 3_000;
export const VERA_W_COOLDOWN_MS = 12_000;
export const VERA_W_MANA = 50;

/**
 * Memoized, like every pack factory must be: a bare `return class ...` here
 * would hand two independent callers (the real game's `spellRegistry.ts`,
 * an e2e script or a test building its own comparison value) two different,
 * `instanceof`-incompatible classes with the same name. See
 * `packs/riot/spells/_EmptyExample.ts`'s header for the full reasoning.
 */
function __buildVeraW(api: ContentApi) {
  return class Vera_W extends api.Spell {
    name = 'Vỏ Sáng (Vera_W)';
    image = api.asset('reference_vera_w');
    description =
      'Tự khoác một <span class="buff">Lá Chắn 30</span> trong <span class="time">3 giây</span>.';
    coolDown = VERA_W_COOLDOWN_MS;
    manaCost = VERA_W_MANA;
    targetingMode = 'SELF' as const;

    onSpellCast(): void {
      const shield = new api.buffs.Shield(VERA_W_DURATION_MS, this.owner, this.owner);
      shield.amount = VERA_W_SHIELD;
      shield.image = this.image;
      // Without its own id a bare Shield shares one stack pool with every
      // other bare Shield applied in the match — see the buff catalogue's own comment
      // on the same line.
      shield.stackId = 'reference_vera_w_shield';
      this.owner.addBuff(shield);
    }
  };
}
const __cacheVeraW = new WeakMap<ContentApi, ReturnType<typeof __buildVeraW>>();
export default function makeVeraW(api: ContentApi) {
  const cached = __cacheVeraW.get(api);
  if (cached) return cached;
  const built = __buildVeraW(api);
  __cacheVeraW.set(api, built);
  return built;
}
