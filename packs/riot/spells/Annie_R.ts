import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Pet = InstanceType<ContentApi['units']['Pet']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Annie_R = InstanceType<ReturnType<typeof makeAnnie_R>>;
type Tibbers = InstanceType<ReturnType<typeof makeTibbers>>;



export const MAX_RANGE = 450;

export const SUMMON_DAMAGE = 34;

export const SUMMON_RADIUS = 200;

export const TIBBERS_LIFETIME_MS = 20_000;

export const TIBBERS_HEALTH = 180;

export const TIBBERS_DAMAGE = 12;

export const TIBBERS_ATTACK_RANGE = 130;

export const AURA_RADIUS = 150;

export const AURA_DAMAGE_PER_TICK = 3;

/** Tongues of flame drawn around the burn radius. Cosmetic only. */
export const AURA_TONGUES = 14;


/**
 * Summon: Tibbers.
 *
 * The pet ultimate the whole `Pet` class was written for — and the first one
 * in this game that is a *big* pet rather than a trap: 180 health, hits for 12,
 * burns everything standing next to him, and lasts 20 seconds. Killing him is
 * a real play, which is the entire difference between a summon and an effect.
 *
 * `docs/abilities/annie/r.json`: location-targeted, damages enemies near him
 * on arrival, *"remains on the field as a controllable pet"*, and recasting
 * directs him to a point. The recast is `checkCastCondition` returning false
 * while he is alive — the same shape Shaco's clone uses to be steered.
 */
function __buildAnnie_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Tibbers = makeTibbers(api);
  class Annie_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_annie_r');
    name = 'Triệu Hồi: Tibbers (Annie_R)';
    description =
      `Triệu hồi Tibbers tại vị trí chỉ định trong <span class="time">${TIBBERS_LIFETIME_MS / 1000} giây</span>:` +
      ` vụ lửa xuất hiện gây <span class="damage">${SUMMON_DAMAGE} sát thương</span> trong <span>${SUMMON_RADIUS}px</span>.` +
      ` Tibbers có <span class="buff">${TIBBERS_HEALTH} máu</span>, tự đánh kẻ địch gần nhất và thiêu` +
      ` <span class="damage">${AURA_DAMAGE_PER_TICK} sát thương</span> mỗi nhịp quanh mình.` +
      ` <span class="buff">Bấm lại</span> để điều Tibbers tới vị trí mới`;
    coolDown = 10000;
    manaCost = 100;

    maxRange = MAX_RANGE;
    tibbers: Tibbers | null = null;

    /** While he is out, the key is a move order for him rather than a new summon. */
    checkCastCondition() {
      if (this.tibbers && !this.tibbers.toRemove) {
        const aim = this.aimPoint;
        this.tibbers.commandTo(aim);
        return false;
      }
      return true;
    }

    onUpdate() {
      if (!this.tibbers?.toRemove) return;
      // He is gone: the key goes back to being a summon, on its real cooldown.
      this.tibbers = null;
      this.currentCooldown = this.reducedCooldown(this.coolDown);
    }

    onSpellCast() {
      const aim = this.aimPoint;
      const spot = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: spot.x, y: spot.y, r: SUMMON_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(SUMMON_DAMAGE, this.owner));

      // Tibbers arrives in a pillar of fire, so the impact has to be fire-shaped:
      // tongues that lick outward and taper, not slabs of rock heaved out of the
      // ground. `columns` was doing duty for Alistar and Garen as well, which is
      // exactly the confusion the styles exist to prevent.
      const burst = new AoePulse(this.owner);
      burst.position = spot.copy();
      burst.radius = SUMMON_RADIUS;
      burst.lifeTime = 550;
      burst.color = [255, 150, 60];
      burst.style = 'flame';
      burst.spokes = 14;
      // Hotter fill than the default: this is a bonfire, not a shockwave.
      burst.fillAlpha = 80;
      this.game.objectManager.addObject(burst);

      const tibbers = new Tibbers({
        game: this.game,
        position: spot,
        teamId: this.owner.teamId,
        ownerUnit: this.owner,
        lifeTimeMs: TIBBERS_LIFETIME_MS,
        aggroRadius: 400,
        // He is steered by the recast, so he must not walk himself back to Annie.
        followsOwner: false,
        preset: {
          name: 'Tibbers',
          spells: [],
          attack: {
            damage: TIBBERS_DAMAGE,
            attacksPerSecond: 0.9,
            range: TIBBERS_ATTACK_RANGE,
          },
        },
      });
      this.game.objectManager.addObject(tibbers);
      this.tibbers = tibbers;
      // The recast is the whole second half of the ability, and a spell sitting
      // in COOLDOWN never reaches `checkCastCondition` — so every R press while
      // Tibbers was out was rejected by the runtime before the move order could
      // be read. Cleared here so the key stays live for as long as he is; put
      // back in `onUpdate` the moment he is not. (Shaco R does the same.)
      this.resetCoolDown();
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Annie_R;
}
const __cacheAnnie_R = new WeakMap<ContentApi, ReturnType<typeof __buildAnnie_R>>();
export default function makeAnnie_R(api: ContentApi) {
  const cached = __cacheAnnie_R.get(api);
  if (cached) return cached;
  const built = __buildAnnie_R(api);
  __cacheAnnie_R.set(api, built);
  return built;
}


function __buildTibbers(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Pet = api.units.Pet;
  const DamageOverTime = api.buffs.DamageOverTime;
  class Tibbers extends Pet {
    auraTick = 0;

    constructor(options: ConstructorParameters<typeof Pet>[0]) {
      super(options);
      this.stats.maxHealth.baseValue = TIBBERS_HEALTH;
      this.stats.health.baseValue = TIBBERS_HEALTH;
      this.stats.size.baseValue = this.stats.size.baseValue * 1.25;
    }

    update(): void {
      super.update();
      if (this.toRemove || this.isDead) return;

      this.auraTick += deltaTime;
      if (this.auraTick < 500) return;
      this.auraTick -= 500;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: AURA_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      });
      enemies.forEach((enemy: any) => {
        enemy.takeDamage(AURA_DAMAGE_PER_TICK, this.ownerUnit);
        const burn = new DamageOverTime(600, this.ownerUnit, enemy);
        burn.stackId = 'tibbers_burn';
        burn.name = 'Cháy';
        burn.damagePerTick = 1;
        burn.tickInterval = 300;
        enemy.addBuff(burn);
      });
    }

    drawAvatar(): void {
      const size = this.animatedValues?.displaySize ?? 60;
      // One clock for the whole bear, so the fur, the flames and the eyes breathe
      // together instead of each running on its own loop.
      const beat = this.age / 1000;
      const flare = 0.7 + 0.3 * Math.sin(beat * 6);

      push();
      translate(this.position.x, this.position.y);
      noStroke();

      // The burn radius, drawn as the thing that is actually dangerous. Eight
      // beads on a circle said "a decoration orbits him"; a ring of licking
      // tongues says "do not stand here", which is the only reason to draw it.
      blendMode(ADD);
      for (let i = 0; i < AURA_TONGUES; i++) {
        const a = (i / AURA_TONGUES) * TWO_PI + beat * 0.55;
        // Each tongue has its own phase, so the rim churns rather than pulsing
        // as one solid band.
        const lick = 0.62 + 0.38 * Math.sin(beat * 7 + i * 1.7);
        for (let k = 0; k < 4; k++) {
          const p = k / 3;
          const reach = AURA_RADIUS * (0.86 + 0.16 * lick * p);
          fill(255, 120 + 110 * (1 - p), 40, (90 - 60 * p) * flare);
          circle(cos(a) * reach, sin(a) * reach, (16 - 9 * p) * lick + 4);
        }
      }
      // A dim boundary line under the tongues: the tongues wander, the edge does
      // not, and the player needs the edge to judge a step backwards.
      noFill();
      stroke(255, 130, 50, 55 + 30 * flare);
      strokeWeight(2);
      circle(0, 0, AURA_RADIUS * 2);
      blendMode(BLEND);

      // Shaggy silhouette: an irregular outline is what separates a bear from a
      // brown ball, and it costs one loop.
      noStroke();
      fill(58, 32, 18);
      beginShape();
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * TWO_PI;
        const shag = 1 + 0.09 * Math.sin(i * 3.1 + beat * 2) + 0.05 * Math.sin(i * 7.3);
        const rr = size * 0.56 * shag;
        vertex(cos(a) * rr, sin(a) * rr);
      }
      endShape(CLOSE);

      // Ears, sitting proud of the shag line.
      fill(78, 44, 24);
      circle(-size * 0.36, -size * 0.38, size * 0.3);
      circle(size * 0.36, -size * 0.38, size * 0.3);
      fill(150, 66, 40);
      circle(-size * 0.36, -size * 0.37, size * 0.14);
      circle(size * 0.36, -size * 0.37, size * 0.14);

      // Body, lit from the fire he is standing in — warm on top, dark underneath.
      fill(112, 64, 34);
      circle(0, 0, size * 0.96);
      fill(140, 82, 42);
      arc(0, 0, size * 0.96, size * 0.96, PI, TWO_PI, CHORD);

      // Muzzle and jaw.
      fill(74, 42, 22);
      ellipse(0, size * 0.2, size * 0.42, size * 0.3);
      fill(26, 14, 10);
      ellipse(0, size * 0.12, size * 0.12, size * 0.09);
      fill(250, 246, 240);
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * size * 0.1;
        triangle(x - size * 0.03, size * 0.24, x + size * 0.03, size * 0.24, x, size * 0.32);
      }

      // Eyes: embers, and they brighten on the same beat as the aura, so the pet
      // visibly *burns* rather than merely standing in a fire.
      blendMode(ADD);
      fill(255, 200, 90, 200 * flare);
      circle(-size * 0.18, -size * 0.1, size * 0.22 * flare + 4);
      circle(size * 0.18, -size * 0.1, size * 0.22 * flare + 4);
      blendMode(BLEND);
      fill(255, 236, 170);
      circle(-size * 0.18, -size * 0.1, size * 0.13);
      circle(size * 0.18, -size * 0.1, size * 0.13);
      fill(120, 20, 10);
      circle(-size * 0.18, -size * 0.1, size * 0.06);
      circle(size * 0.18, -size * 0.1, size * 0.06);

      // Claws on the near paws, rising and falling as he lumbers.
      fill(238, 232, 220);
      for (let side = -1; side <= 1; side += 2) {
        const paw = size * 0.4 * side;
        const step = Math.sin(beat * 5 + (side > 0 ? PI : 0)) * size * 0.04;
        for (let i = 0; i < 3; i++) {
          const x = paw + (i - 1) * size * 0.07;
          triangle(
            x - size * 0.02,
            size * 0.4 + step,
            x + size * 0.02,
            size * 0.4 + step,
            x,
            size * 0.5 + step
          );
        }
      }
      pop();
    }
  }
  return Tibbers;
}
const __cacheTibbers = new WeakMap<ContentApi, ReturnType<typeof __buildTibbers>>();
export function makeTibbers(api: ContentApi) {
  const cached = __cacheTibbers.get(api);
  if (cached) return cached;
  const built = __buildTibbers(api);
  __cacheTibbers.set(api, built);
  return built;
}