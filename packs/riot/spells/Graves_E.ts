import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Graves_E = InstanceType<ReturnType<typeof makeGraves_E>>;



export const DASH_DISTANCE = 250;

export const DASH_SPEED = 20;

export const BUFF_DURATION = 4000;

export const ATTACK_SPEED_PERCENT = 0.4;

export const CRIT_CHANCE = 0.35;


/** Quickdraw: the reposition, and the reload that follows it. */
function __buildGraves_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const StatAmp = api.buffs.StatAmp;
  class Graves_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_graves_e');
    name = 'Rút Súng Nhanh (Graves_E)';
    description =
      `Lướt <span>${DASH_DISTANCE}px</span> theo hướng chỉ định và nhận` +
      ` <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span> và` +
      ` <span class="buff">${CRIT_CHANCE * 100}% tỉ lệ chí mạng</span> trong` +
      ` <span class="time">${BUFF_DURATION / 1000} giây</span>`;
    coolDown = 8000;
    manaCost = 25;

    checkCastCondition() {
      return Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        DASH_DISTANCE
      );

      const dash = new Dash(1500, this.owner, this.owner);
      dash.image = this.image;
      dash.dashDestination = to;
      dash.dashSpeed = DASH_SPEED;
      dash.showTrail = true;
      this.owner.addBuff(dash);

      const amp = new StatAmp(BUFF_DURATION, this.owner, this.owner);
      amp.stackId = 'graves_e';
      amp.image = this.image;
      amp.name = 'Rút Súng Nhanh';
      amp.bonuses = {
        attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
        critChance: { baseBonus: CRIT_CHANCE },
      };
      this.owner.addBuff(amp);
    }

    drawPreview() {
      super.drawPreview(DASH_DISTANCE);
    }
  }
  return Graves_E;
}
const __cacheGraves_E = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_E>>();
export default function makeGraves_E(api: ContentApi) {
  const cached = __cacheGraves_E.get(api);
  if (cached) return cached;
  const built = __buildGraves_E(api);
  __cacheGraves_E.set(api, built);
  return built;
}