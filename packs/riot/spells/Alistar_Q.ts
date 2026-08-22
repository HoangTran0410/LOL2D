import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Alistar_Q = InstanceType<ReturnType<typeof makeAlistar_Q>>;
type Alistar_Q_Ground = InstanceType<ReturnType<typeof makeAlistar_Q_Ground>>;



export const RADIUS = 190;

export const DAMAGE = 22;

export const AIRBORNE_DURATION = 800;

/** How long the split ground stays visible after the hooves land. */
export const CRACK_MS = 620;

/** Cracks radiating out of the hoof strike. Cosmetic only. */
export const CRACK_COUNT = 11;


function __buildAlistar_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AoePulse = api.AoePulse;
  const Airborne = api.buffs.Airborne;
  const Alistar_Q_Ground = makeAlistar_Q_Ground(api);
  class Alistar_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_alistar_q');
    name = 'Nghiền Nát (Alistar_Q)';
    description =
      `Giậm đất, gây <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Hất Tung</span>` +
      ` mọi kẻ địch trong <span>${RADIUS}px</span> trong <span class="time">${AIRBORNE_DURATION / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 30;

    onSpellCast() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(DAMAGE, this.owner);
        enemy.addBuff(new Airborne(AIRBORNE_DURATION, this.owner, enemy));
      });

      // The ground itself, which stays put and is not anchored to Alistar: he is
      // free to walk out of his own crater, and the crater is what tells everyone
      // else how far the stomp reached.
      const ground = new Alistar_Q_Ground(this.owner);
      ground.position = this.owner.position.copy();
      ground.radius = RADIUS;
      this.game.objectManager.addObject(ground);

      // Hooves, not pillars. `columns` had Alistar drawing the same erupting slabs
      // as Annie's bonfire and Garen's ultimate; `stomp` throws its dust *along*
      // the ground in a squashed wedge, which is what a minotaur landing does.
      const dust = new AoePulse(this.owner);
      dust.radius = RADIUS;
      dust.color = [255, 225, 150];
      dust.style = 'stomp';
      dust.spokes = 14;
      dust.lifeTime = 480;
      this.game.objectManager.addObject(dust);
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Alistar_Q;
}
const __cacheAlistar_Q = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_Q>>();
export default function makeAlistar_Q(api: ContentApi) {
  const cached = __cacheAlistar_Q.get(api);
  if (cached) return cached;
  const built = __buildAlistar_Q(api);
  __cacheAlistar_Q.set(api, built);
  return built;
}


/**
 * The split ground under a pulverise.
 *
 * Two cloven hoof stamps at the centre and cracks racing out to the exact hit
 * radius — the boundary is drawn, not implied, because being one pixel outside
 * a 190px knock-up is the difference between a fight and a death and the player
 * has to be able to see where that line was.
 *
 * Deliberately not `castSpec.vfx`: this reaches 190 units past Alistar's body
 * and lives half a second after he can walk away, so it owns its own bounds
 * rather than disappearing the moment its caster is culled.
 */
function __buildAlistar_Q_Ground(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Alistar_Q_Ground extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    lifeTime = CRACK_MS;
    age = 0;
    /** Fixed at construction so the fracture pattern does not reshuffle per frame. */
    seed = Math.random() * Math.PI * 2;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // The fracture runs out fast and then just sits there fading: rock splits at
      // the speed of the impact, it does not creep.
      const split = 1 - Math.pow(1 - constrain(t * 3, 0, 1), 2);
      const flash = 1 - constrain(t / 0.18, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // Cracks: each one kinks once on its way out, so the pattern reads as broken
      // stone rather than as a sunburst.
      stroke(70, 52, 34, 235 * fade);
      strokeWeight(6 * fade + 1.5);
      noFill();
      for (let i = 0; i < CRACK_COUNT; i++) {
        const a = this.seed + (i / CRACK_COUNT) * TWO_PI;
        const reach = this.radius * split * (0.72 + 0.28 * Math.abs(Math.sin(this.seed + i * 2.7)));
        const bend = a + 0.2 * Math.sin(this.seed + i * 1.9);
        beginShape();
        vertex(0, 0);
        vertex(cos(a) * reach * 0.45, sin(a) * reach * 0.45);
        vertex(cos(bend) * reach * 0.8, sin(bend) * reach * 0.8);
        vertex(cos(bend) * reach, sin(bend) * reach);
        endShape();
      }

      // The hit boundary, squashed the same way the dust wedge is: the force went
      // outward along the dirt, so the mark it leaves is not a perfect circle.
      stroke(190, 150, 90, 190 * fade);
      strokeWeight(4 * fade + 1);
      ellipse(0, 0, this.radius * 2 * split, this.radius * 1.7 * split);

      // Two cloven hoof stamps, pressed into the dirt where he landed. This is the
      // signature: nothing else in the game leaves a print shaped like this.
      noStroke();
      for (let side = -1; side <= 1; side += 2) {
        push();
        translate(side * this.radius * 0.11, this.radius * 0.05);
        fill(38, 26, 16, 220 * fade);
        // each half of the cloven print, angled apart
        for (let half = -1; half <= 1; half += 2) {
          push();
          translate(half * this.radius * 0.035, 0);
          rotate(half * 0.22);
          ellipse(0, 0, this.radius * 0.065, this.radius * 0.12);
          pop();
        }
        pop();
      }

      // The moment of contact. Short and low — a flat disc of kicked dirt rather
      // than a ball of light, because nothing here is on fire.
      if (flash > 0) {
        noStroke();
        fill(255, 240, 200, 190 * flash);
        ellipse(0, 0, this.radius * 1.1 * flash + 30, this.radius * 0.6 * flash + 18);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // 1.2x: the longest cracks overshoot the hit ellipse on purpose.
      const span = this.radius * 1.2;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Alistar_Q_Ground;
}
const __cacheAlistar_Q_Ground = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_Q_Ground>>();
export function makeAlistar_Q_Ground(api: ContentApi) {
  const cached = __cacheAlistar_Q_Ground.get(api);
  if (cached) return cached;
  const built = __buildAlistar_Q_Ground(api);
  __cacheAlistar_Q_Ground.set(api, built);
  return built;
}