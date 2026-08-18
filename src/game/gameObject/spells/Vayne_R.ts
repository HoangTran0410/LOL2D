import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Buff from '../Buff';
import StatAmp from '../buffs/StatAmp';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

/** How long the night stays closed in. */
export const VAYNE_R_DURATION_MS = 10_000;
/** Flat attack damage while it lasts — the whole payload of the ultimate. */
export const VAYNE_R_AD = 12;
/** Multiplier applied to Vayne_Q's cooldown while Final Hour is up. */
export const VAYNE_R_Q_CDR = 0.5;
/** How long a tumble hides her, once the night is hers. */
export const VAYNE_R_STEALTH_MS = 1_000;
/** Radius of the vignette. Art only — nothing is queried at this distance. */
export const VAYNE_R_RADIUS = 300;

/** One pulse of the vignette per second, exactly as the design asks. */
const PULSE_MS = 1_000;
/** How far past the ring the paint reaches, for the display box. */
const RING_BLEED = 26;

/**
 * Final Hour — a pure buff, no damage anywhere in it, which is correct for a
 * marksman whose whole kit is basic attacks. It hands Vayne_Q the two things it
 * reads off her (`Vayne_R_Buff` presence and `VAYNE_R_Q_CDR`) and otherwise just
 * turns the lights down.
 *
 * The attack damage rides a `StatAmp` with its own `stackId`, because the class
 * is generic and two champions sharing it would evict each other. The marker
 * buff is separate so `hasBuff` has something Vayne-specific to ask about, and
 * so the vignette has a lifetime to hang off.
 */
export default class Vayne_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_vayne_r');
  name = 'Giờ Khắc Cuối Cùng (Vayne_R)';
  description = `Trong ${VAYNE_R_DURATION_MS / 1000} giây, Vayne nhận
    <span class="damage">+${VAYNE_R_AD} sát thương đánh thường</span>, hồi chiêu Nhào Lộn giảm
    một nửa, và mỗi lần Nhào Lộn khiến cô tàng hình ${VAYNE_R_STEALTH_MS / 1000} giây.`;
  coolDown = 10_000;
  manaCost = 100;

  onSpellCast(): void {
    const nightfall = new Vayne_R_Buff(VAYNE_R_DURATION_MS, this.owner, this.owner);
    this.owner.addBuff(nightfall);

    const edge = new StatAmp(VAYNE_R_DURATION_MS, this.owner, this.owner);
    edge.bonuses = { attackDamage: { baseBonus: VAYNE_R_AD } };
    edge.stackId = 'vayne_final_hour_ad';
    this.owner.addBuff(edge);

    // The vignette reaches 300px past her body, so it is an object in the world
    // and not caster VFX — otherwise it blinks out whenever she is culled.
    this.game.objectManager.addObject(new Vayne_R_Aura(this.owner, nightfall));
  }
}

/**
 * The marker. Carries no stats of its own: it exists so `Vayne_Q` can ask "is
 * the night hers right now" through `hasBuff` without importing a stat bonus.
 */
export class Vayne_R_Buff extends Buff {
  name = 'Giờ Khắc Cuối Cùng';
  description = 'Đêm đã thuộc về cô.';
  buffAddType = BuffAddType.REPLACE_EXISTING;
}

/**
 * The night closing in: one dark ring at `VAYNE_R_RADIUS` that breathes once a
 * second, and a thin silver rim on it so her own colour still reads inside the
 * dark. Two layers, deliberately — a particle field on top of this would hide
 * both of them.
 *
 * Ground art, so `zIndex = 2`: `Z_INDEX_MAP` is keyed by exact constructor and a
 * `SpellObject` subclass otherwise falls through to 99, painting a 600px disc
 * over the feet of everyone standing in it.
 */
export class Vayne_R_Aura extends SpellObject {
  zIndex = 2;
  age = 0;
  private host: AttackableUnit;

  constructor(owner: AttackableUnit, nightfall: Buff) {
    super(owner);
    this.host = owner;
    this.attachTo(owner, nightfall);
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.position.set(this.host.position.x, this.host.position.y);
    this.age += deltaTime;
  }

  draw(): void {
    // One clock. The pulse is a full breath per PULSE_MS, so the player can
    // count the ultimate down off the ring itself.
    const breath = (this.age % PULSE_MS) / PULSE_MS;
    const swell = sin(breath * TWO_PI) * 0.04;
    const reach = VAYNE_R_RADIUS * (1 + swell);

    push();
    noFill();
    // The dark that closes in: deep indigo, heaviest at the rim.
    stroke(44, 62, 80, 150);
    strokeWeight(26);
    circle(this.position.x, this.position.y, reach * 2);
    // The silver rim, so her bolts read bright against the dark edge.
    stroke(236, 240, 241, 120 + 60 * (1 - breath));
    strokeWeight(2);
    circle(this.position.x, this.position.y, reach * 2 - 12);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((VAYNE_R_RADIUS + RING_BLEED) * 2);
  }
}
