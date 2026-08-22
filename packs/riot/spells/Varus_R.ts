import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Varus_R = InstanceType<ReturnType<typeof makeVarus_R>>;
type Varus_R_Object = InstanceType<ReturnType<typeof makeVarus_R_Object>>;



export const RANGE = 600;

export const DAMAGE = 35;

export const ROOT_DURATION = 1800;

export const SPREAD_RADIUS = 220;


/**
 * Chain of Corruption: the tendril roots whoever it catches, then jumps from
 * that body to everyone standing near them. Grouping up is the mistake.
 */
function __buildVarus_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Varus_R_Object = makeVarus_R_Object(api);
  class Varus_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_varus_r');
    name = 'Sợi Xích Tội Lỗi (Varus_R)';
    description =
      `Phóng một dây leo: mục tiêu đầu tiên trúng phải nhận <span class="damage">${DAMAGE} sát thương</span>` +
      ` và bị <span class="buff">Trói Chân</span> trong <span class="time">${ROOT_DURATION / 1000} giây</span>,` +
      ` rồi lan sang mọi kẻ địch trong <span>${SPREAD_RADIUS}px</span> quanh nó`;
    coolDown = 10000;
    manaCost = 70;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const chain = new Varus_R_Object(this.owner);
      chain.destination = to;
      this.game.objectManager.addObject(chain);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Varus_R;
}
const __cacheVarus_R = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_R>>();
export default function makeVarus_R(api: ContentApi) {
  const cached = __cacheVarus_R.get(api);
  if (cached) return cached;
  const built = __buildVarus_R(api);
  __cacheVarus_R.set(api, built);
  return built;
}


function __buildVarus_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const MissileSpellObject = api.MissileSpellObject;
  const AoePulse = api.AoePulse;
  const Root = api.buffs.Root;
  const AttackableUnit = api.units.AttackableUnit;
  class Varus_R_Object extends MissileSpellObject {
    speed = 12;
    size = 26;
    maxHitCount = 1;

    onHit(enemy: AttackableUnit) {
      this.corrupt(enemy);

      // ...and on to everyone standing with them.
      const nearby = this.game.objectManager.queryObjects({
        area: new Circle({ x: enemy.position.x, y: enemy.position.y, r: SPREAD_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      nearby.forEach((other: any) => {
        if (other !== enemy) this.corrupt(other);
      });

      const spread = new AoePulse(this.owner);
      spread.position = enemy.position.copy();
      spread.radius = SPREAD_RADIUS;
      spread.lifeTime = 600;
      spread.color = [170, 110, 240];
      spread.style = 'bandage';
      spread.spokes = 14;
      this.game.objectManager.addObject(spread);
    }

    corrupt(victim: AttackableUnit) {
      victim.takeDamage(DAMAGE, this.owner);
      victim.addBuff(new Root(ROOT_DURATION, this.owner, victim));
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      noFill();
      stroke(180, 110, 240, 230);
      strokeWeight(5);
      // a writhing tendril rather than a bolt
      beginShape();
      for (let i = 0; i <= 8; i++) {
        const p = i / 8;
        vertex(-30 + p * 40, Math.sin(p * PI * 3 + frameCount / 4) * 7);
      }
      endShape();
      pop();
    }
  }
  return Varus_R_Object;
}
const __cacheVarus_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVarus_R_Object>>();
export function makeVarus_R_Object(api: ContentApi) {
  const cached = __cacheVarus_R_Object.get(api);
  if (cached) return cached;
  const built = __buildVarus_R_Object(api);
  __cacheVarus_R_Object.set(api, built);
  return built;
}