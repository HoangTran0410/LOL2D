import type { ContentApi } from '@/content/ContentApi';
import type { ContentPack } from '@/content/ContentPack';
import makeVeraQ from './spells/Vera_Q';
import makeVeraW from './spells/Vera_W';
import makeVeraE from './spells/Vera_E';
import makeVeraR from './spells/Vera_R';

/**
 * The pack core ships with — proof the content-pack seam works, not yet a
 * playable game. Nothing in `src/` imports `src/content/install.ts` today, so
 * shipping this pack does not make this champion selectable; wiring the
 * registry into the boot path is batch 2's first step.
 *
 * It is three things at once and each one matters: the smoke test that the
 * seam works end to end, the living documentation an author reads to learn
 * `ContentApi`, and the second consumer that keeps the API from being shaped
 * around the Riot pack alone.
 *
 * Every id here is local. `PackRegistry` prefixes them with `reference:`.
 */
const referencePack = (api: ContentApi): ContentPack => ({
  manifest: { id: 'reference', version: '1.0.0', coreRange: '^1' },
  spells: {
    Vera_Q: makeVeraQ(api),
    Vera_W: makeVeraW(api),
    Vera_E: makeVeraE(api),
    Vera_R: makeVeraR(api),
  },
  champions: [
    {
      id: 'vera',
      name: 'Vera',
      image: null,
      spells: ['Vera_Q', 'Vera_W', 'Vera_E', 'Vera_R'],
    },
  ],
});

export default referencePack;
