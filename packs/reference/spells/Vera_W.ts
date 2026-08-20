import type { ContentApi } from '@/content/ContentApi';

/** Vera's W — a self shield. Exercises `api.buffs` and a SELF cast. */
export const VERA_W_SHIELD = 30;
export const VERA_W_DURATION_MS = 3_000;
export const VERA_W_COOLDOWN_MS = 12_000;
export const VERA_W_MANA = 50;

export default function makeVeraW(api: ContentApi) {
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
      // other bare Shield applied in the match — see Malphite_W's own comment
      // on the same line.
      shield.stackId = 'reference_vera_w_shield';
      this.owner.addBuff(shield);
    }
  };
}
