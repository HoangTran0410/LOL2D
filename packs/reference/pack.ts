import type { ContentApi } from '@/content/ContentApi';
import type { ContentPack } from '@/content/ContentPack';
import makeVeraQ, { VERA_Q_COOLDOWN_MS, VERA_Q_DAMAGE, VERA_Q_MANA } from './spells/Vera_Q';
import makeVeraW, {
  VERA_W_COOLDOWN_MS,
  VERA_W_DURATION_MS,
  VERA_W_MANA,
  VERA_W_SHIELD,
} from './spells/Vera_W';
import makeVeraE, { VERA_E_COOLDOWN_MS, VERA_E_MANA } from './spells/Vera_E';
import makeVeraR, { VERA_R_COOLDOWN_MS, VERA_R_DAMAGE, VERA_R_MANA } from './spells/Vera_R';

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
  // Every number interpolated below is imported from the spell file it
  // describes, never restated by hand, so a description can never disagree
  // with the spell it describes. `specCoolDownMs` equals `coolDownMs` for
  // all four: none of these spells overrides `castSpec`, so the runtime's
  // countdown runs off `legacyCastSpec(this.coolDown)` — the same number.
  spellDisplay: {
    Vera_Q: {
      name: 'Tia Lam (Vera_Q)',
      description: `Bắn một tia năng lượng thẳng, gây <span class="damage">${VERA_Q_DAMAGE} sát thương</span> cho kẻ địch đầu tiên trúng.`,
      iconKey: 'reference_vera_q',
      coolDownMs: VERA_Q_COOLDOWN_MS,
      manaCost: VERA_Q_MANA,
      specCoolDownMs: VERA_Q_COOLDOWN_MS,
    },
    Vera_W: {
      name: 'Vỏ Sáng (Vera_W)',
      description: `Tự khoác một <span class="buff">Lá Chắn ${VERA_W_SHIELD}</span> trong <span class="time">${VERA_W_DURATION_MS / 1000} giây</span>.`,
      iconKey: 'reference_vera_w',
      coolDownMs: VERA_W_COOLDOWN_MS,
      manaCost: VERA_W_MANA,
      specCoolDownMs: VERA_W_COOLDOWN_MS,
    },
    Vera_E: {
      name: 'Bước Chớp (Vera_E)',
      description: 'Lướt nhanh một đoạn ngắn theo hướng chỉ định.',
      iconKey: 'reference_vera_e',
      coolDownMs: VERA_E_COOLDOWN_MS,
      manaCost: VERA_E_MANA,
      specCoolDownMs: VERA_E_COOLDOWN_MS,
    },
    Vera_R: {
      name: 'Vòng Tận (Vera_R)',
      description: `Gọi một vòng sáng tại vị trí chỉ định, gây <span class="damage">${VERA_R_DAMAGE} sát thương</span> cho mọi kẻ địch bên trong.`,
      iconKey: 'reference_vera_r',
      coolDownMs: VERA_R_COOLDOWN_MS,
      manaCost: VERA_R_MANA,
      specCoolDownMs: VERA_R_COOLDOWN_MS,
    },
  },
  champions: [
    {
      id: 'vera',
      name: 'Vera',
      image: 'reference_champ_vera',
      playable: true,
      attack: { damage: 14, attacksPerSecond: 1.1, range: 300 },
      spells: ['Vera_Q', 'Vera_W', 'Vera_E', 'Vera_R'],
    },
  ],
});

export default referencePack;
