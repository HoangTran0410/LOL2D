import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Crowd-control buffs (Stun, Root, Slow, Airborne, Charm, Fear, Silence,
// Nearsight, Ground, Stasis, TrueSight, Untargetable, Invisible) already
// default `image` to their own CC icon in src/game/gameObject/buffs/. Many
// spells used to overwrite that default with their own ability art right
// after construction, so a stunned unit showed e.g. spell_ashe_r spinning
// over its head instead of a generic stun icon. This is a static source scan
// (matching the pattern used by
// tests/game/integration/ChampionSpellLifecycle.test.ts's "routes production
// spell replacement..." case) rather than instantiating every spell, since the
// fix here is deletion and the risk is a stray line surviving the sweep or a
// legitimate ability-art override getting deleted by mistake.

const read = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../packs/riot/spells/${relativePath}`, import.meta.url)),
    'utf8'
  );

describe('crowd-control buffs keep their own CC icon', () => {
  const removedOverrides: Array<[file: string, snippet: string]> = [
    ['Zed_E.ts', "slowBuff.image = api.asset('spell_zed_e')"],
    ['Lux_E.ts', "slowBuff.image = api.asset('spell_lux_e')"],
    ['Ashe_Q.ts', "slowBuff.image = api.asset('spell_ashe_q')"],
    ['Rammus_Q.ts', "airborneBuff.image = api.asset('spell_rammus_q')"],
    ['Rammus_Q.ts', "slowBuff.image = api.asset('spell_rammus_q')"],
    ['Ahri_W.ts', "slowBuff.image = api.asset('spell_ahri_w')"],
    ['ChoGath_W.ts', "stunBuff.image = api.asset('spell_chogath_w')"],
    ['Anivia_R.ts', "slow.image = api.asset('spell_anivia_r')"],
    ['Ahri_E.ts', "charmBuff.image = api.asset('spell_ahri_e')"],
    ['Leblanc_E.ts', "rootBuff.image = api.asset('spell_leblanc_e')"],
    ['Blitzcrank_R.ts', "silenceBuff.image = api.asset('spell_blitzcrank_r')"],
    ['Morgana_Q.ts', "rootBuff.image = api.asset('spell_morgana_q')"],
    ['Teemo_Q.ts', "blindBuff.image = api.asset('spell_teemo_q')"],
    ['Blitzcrank_Q.ts', "this.airborneBuff.image = api.asset('spell_blitzcrank_q')"],
    ['Lux_Q.ts', "stunBuff.image = api.asset('spell_lux_q')"],
    ['Zed_Q.ts', "slowBuff.image = api.asset('spell_zed_q')"],
    ['ChoGath_Q.ts', "slowBuff.image = api.asset('spell_chogath_q')"],
    ['Teemo_R.ts', "slowBuff.image = api.asset('spell_teemo_r')"],
    ['LeeSin_R.ts', "airbornBuff.image = api.asset('spell_leesin_r')"],
    ['Anivia_Q.ts', "slowBuff.image = api.asset('spell_anivia_q')"],
    ['Anivia_Q.ts', "stunBuff.image = api.asset('spell_anivia_q')"],
    ['Ashe_W.ts', "slowBuff.image = api.asset('spell_ashe_w')"],
    ['Ahri_Q.ts', "slowBuff.image = api.asset('spell_ahri_q')"],
    ['Veigar_E.ts', "stunBuff.image = api.asset('spell_veigar_e')"],
    ['Janna_Q.ts', "airborneBuff.image = api.asset('spell_janna_q')"],
    ['Ashe_R.ts', "stunBuff.image = api.asset('spell_ashe_r')"],
    ['Fizz_E.ts', "slowBuff.image = api.asset('buff_slow')"],
    ['Amumu_Q.ts', "this.stunBuff.image = api.asset('spell_amumu_q')"],
    ['Olaf_Q.ts', "slowBuff.image = api.asset('spell_olaf_q')"],
    ['Thresh_Q.ts', "this.stunBuff.image = api.asset('spell_thresh_q')"],
  ];

  it.each(removedOverrides)(
    '%s no longer overwrites its CC buff image with ability art (%s)',
    (file, snippet) => {
      expect(read(file)).not.toContain(snippet);
    }
  );

  // Ability state art that is not a CC indicator (a dash, a decoy's own art, a
  // stealth sight ward, Yasuo's Q stack counters, ChoGath's bleed) is
  // deliberately left overriding the default — these must survive the sweep.
  const keptOverrides: Array<[file: string, snippet: string]> = [
    ['ChoGath_E.ts', "bleed.image = api.asset('spell_chogath_e')"],
    ['Leblanc_W.ts', "dashBuff.image = api.asset('spell_leblanc_w1')"],
    ['Olaf_Q.ts', "speedUpBuff.image = api.asset('spell_olaf_q')"],
    ['Lux_W.ts', "shield.image = api.asset('spell_lux_w')"],
    ['Zed_W.ts', "this.image = api.asset('spell_zed_w2')"],
    ['Thresh_Q.ts', "tug.image = api.asset('spell_thresh_q')"],
    ['Shaco_R.ts', "this.image = api.asset('spell_shaco_r2')"],
    // The reveal now goes through `createReveal`, so the art rides in as an
    // option rather than as an assignment. Same override, same reason.
    ['Ashe_E.ts', "image: api.asset('spell_ashe_e')"],
    ['Yasuo_Q.ts', "buff.image = api.asset('spell_yasuo_q1')"],
    ['Amumu_Q.ts', "this.dashBuff.image = api.asset('spell_amumu_q')"],
  ];

  it.each(keptOverrides)(
    '%s still shows its own ability art, not a CC icon (%s)',
    (file, snippet) => {
      expect(read(file)).toContain(snippet);
    }
  );
});
