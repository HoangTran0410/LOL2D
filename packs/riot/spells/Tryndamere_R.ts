import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Invulnerable = InstanceType<ContentApi['buffs']['Invulnerable']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Tryndamere_R = InstanceType<ReturnType<typeof makeTryndamere_R>>;
type Tryndamere_R_Object = InstanceType<ReturnType<typeof makeTryndamere_R_Object>>;



/**
 * Much shorter than the PC ultimate's 5 seconds. Two reasons: LOL2D has no
 * minimum-health threshold, so this is *flat* invulnerability rather than a
 * floor of 1 health, and this game's cooldown ceiling is ten seconds — a window
 * that comes back that often has to be one an enemy can wait out.
 */
export const TRYNDAMERE_R_DURATION_MS = 5000;

export const TRYNDAMERE_R_ATTACK_SPEED_BONUS = 0.3;

export const TRYNDAMERE_R_ATTACK_DAMAGE_BONUS = 8;

export const TRYNDAMERE_R_STACK_ID = 'tryndamere-undying-rage';


function __buildTryndamere_R(api: ContentApi) {
  const Spell = api.Spell;
  const Invulnerable = api.buffs.Invulnerable;
  const StatAmp = api.buffs.StatAmp;
  const Tryndamere_R_Object = makeTryndamere_R_Object(api);
  class Tryndamere_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_tryndamere_r');
    name = 'Từ Chối Tử Thần (Tryndamere_R)';
    description =
      'Nổi cơn thịnh nộ: <span class="buff">bất tử</span> trong <span class="time">2.5 giây</span>, ' +
      'đồng thời nhận <span class="buff">30% tốc đánh</span> và <span class="buff">8 sát thương đánh</span>.';
    // Ten seconds is this game's ceiling for every spell, ultimates included
    // (tests/game/spells/cooldowns.test.ts), which is why the window is short.
    coolDown = 10_000;
    manaCost = 0;

    onSpellCast(): void {
      const rage = new Invulnerable(TRYNDAMERE_R_DURATION_MS, this.owner, this.owner);
      // Its own slot rather than the class default: the practice panel's
      // invulnerability cheat is the same buff class, and a 3.5s ultimate must
      // not replace — or be replaced by — a switch the player left on.
      rage.stackId = TRYNDAMERE_R_STACK_ID;
      rage.name = 'Từ Chối Tử Thần';
      this.owner.addBuff(rage);

      const fury = new StatAmp(TRYNDAMERE_R_DURATION_MS, this.owner, this.owner);
      fury.stackId = `${TRYNDAMERE_R_STACK_ID}-fury`;
      fury.name = 'Từ Chối Tử Thần';
      fury.image = this.image;
      fury.bonuses = {
        attackSpeed: { percentBaseBonus: TRYNDAMERE_R_ATTACK_SPEED_BONUS },
        attackDamage: { flatBonus: TRYNDAMERE_R_ATTACK_DAMAGE_BONUS },
      };
      this.owner.addBuff(fury);

      const aura = new Tryndamere_R_Object(this.owner);
      aura.attachTo(this.owner, rage);
      this.game.objectManager.addObject(aura);
    }
  }
  return Tryndamere_R;
}
const __cacheTryndamere_R = new WeakMap<ContentApi, ReturnType<typeof __buildTryndamere_R>>();
export default function makeTryndamere_R(api: ContentApi) {
  const cached = __cacheTryndamere_R.get(api);
  if (cached) return cached;
  const built = __buildTryndamere_R(api);
  __cacheTryndamere_R.set(api, built);
  return built;
}


/**
 * The rage: a ring of blood held around him for exactly as long as the buff,
 * pulsing faster as it runs out.
 *
 * The countdown *is* the spell — an enemy needs to know how long he still
 * cannot be killed, so the effect tightens and reddens toward the end instead
 * of looking the same on the first frame and the last.
 */
function __buildTryndamere_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  class Tryndamere_R_Object extends SpellObject {
    age = 0;
    lifeTime = TRYNDAMERE_R_DURATION_MS;
    /** Wisp phases, seeded once — rolled per frame they strobe. */
    private wisps: number[] = [];

    particleSystem = PredefinedParticleSystems.smoke([170, 30, 40], 0.25, 4);
    private nextEmitAt = 0;

    constructor(owner: AttackableUnit) {
      super(owner);
    }

    onAdded(): void {
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 7; i++) this.wisps.push(random(0, TWO_PI));
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;

      // a slow drip of blood smoke for the whole duration, not one burst at cast
      if (this.age >= this.nextEmitAt) {
        this.nextEmitAt = this.age + 90;
        const angle = random(0, TWO_PI);
        this.particleSystem.addParticle({
          x: this.position.x + cos(angle) * 26,
          y: this.position.y + sin(angle) * 26,
          size: random(10, 22),
          opacity: 170,
        });
      }

      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // the pulse accelerates as the window closes: the clock is the effect
      const urgency = 0.06 + 0.16 * t;
      const pulse = 1 + sin(this.age * urgency) * 0.09;
      const radius = 44 * pulse;

      push();
      translate(this.position.x, this.position.y);
      noFill();
      stroke(210, 40, 50, 210 - 60 * t);
      strokeWeight(4);
      circle(0, 0, radius * 2);
      stroke(255, 150, 150, 150 - 60 * t);
      strokeWeight(2);
      circle(0, 0, radius * 2 + 12);

      // wisps of blood dragged up around him
      strokeWeight(3);
      for (const phase of this.wisps) {
        const angle = phase + this.age * 0.004;
        const inner = radius * 0.7;
        const outer = radius * (1.05 + 0.25 * sin(phase + this.age * 0.01));
        stroke(230, 60, 70, 190 - 70 * t);
        line(cos(angle) * inner, sin(angle) * inner, cos(angle) * outer, sin(angle) * outer);
      }

      // opening flare, gone in the first fifth — the ultimate must announce itself
      if (t < 0.2) {
        const flash = 1 - t / 0.2;
        stroke(255, 220, 220, 230 * flash);
        strokeWeight(5 * flash + 1);
        circle(0, 0, radius * 2 + 70 * (1 - flash));
      }
      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      const r = 130;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Tryndamere_R_Object;
}
const __cacheTryndamere_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTryndamere_R_Object>>();
export function makeTryndamere_R_Object(api: ContentApi) {
  const cached = __cacheTryndamere_R_Object.get(api);
  if (cached) return cached;
  const built = __buildTryndamere_R_Object(api);
  __cacheTryndamere_R_Object.set(api, built);
  return built;
}