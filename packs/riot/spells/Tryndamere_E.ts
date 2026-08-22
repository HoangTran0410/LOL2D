import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Tryndamere_E = InstanceType<ReturnType<typeof makeTryndamere_E>>;
type Tryndamere_E_Object = InstanceType<ReturnType<typeof makeTryndamere_E_Object>>;



export const TRYNDAMERE_E_RANGE = 300;

export const TRYNDAMERE_E_DAMAGE = 28;

/** How wide the whirling blade reaches off his body while he travels. */
export const TRYNDAMERE_E_HIT_RADIUS = 70;

export const TRYNDAMERE_E_DASH_SPEED = 15;

/** Cutting a champion on the way through shortens the next spin. */
export const TRYNDAMERE_E_COOLDOWN_REFUND_MS = 1_000;


function __buildTryndamere_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Champion = api.units.Champion;
  const AttackableUnit = api.units.AttackableUnit;
  const Tryndamere_E_Object = makeTryndamere_E_Object(api);
  class Tryndamere_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_tryndamere_e');
    name = 'Chém Xoáy (Tryndamere_E)';
    description =
      'Xoay kiếm lướt tới vị trí chỉ định, gây <span class="damage">28 sát thương</span> cho mọi kẻ địch trên đường đi ' +
      '(<span class="buff">mỗi mục tiêu chỉ trúng một lần</span>). Mỗi tướng chém trúng giảm <span class="time">1 giây</span> hồi chiêu.';
    coolDown = 9_000;
    manaCost = 0;
    range = TRYNDAMERE_E_RANGE;

    checkCastCondition(): boolean {
      return Dash.CanDash(this.owner);
    }

    onSpellCast(): void {
      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        TRYNDAMERE_E_RANGE
      );

      const spin = new Dash(1_500, this.owner, this.owner);
      spin.image = this.image;
      spin.dashSpeed = TRYNDAMERE_E_DASH_SPEED;
      spin.dashDestination = destination;

      const blades = new Tryndamere_E_Object(this.owner);
      blades.attachTo(this.owner, spin);
      this.game.objectManager.addObject(blades);

      // One pass, one hit each: without the set a slow-moving target takes the
      // full slash on every frame the blade overlaps it.
      const hitTargets = new Set<AttackableUnit>();
      // Never `spin.onUpdate = …`: that replaces the dash's own frame and he
      // spins on the spot. See docs/ADDING_SPELLS.md.
      spin.onDashUpdate = () => {
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.owner.position.x,
            y: this.owner.position.y,
            r: TRYNDAMERE_E_HIT_RADIUS + (this.owner.stats.size.value ?? 0) / 2,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        }) as AttackableUnit[];

        for (const enemy of enemies) {
          if (hitTargets.has(enemy)) continue;
          hitTargets.add(enemy);
          enemy.takeDamage(TRYNDAMERE_E_DAMAGE, this.owner);
          blades.cutAt(enemy.position.x, enemy.position.y);
          if (enemy instanceof Champion) {
            this.currentCooldown = Math.max(
              0,
              this.currentCooldown - TRYNDAMERE_E_COOLDOWN_REFUND_MS
            );
          }
        }
      };

      this.owner.addBuff(spin);
    }
  }
  return Tryndamere_E;
}
const __cacheTryndamere_E = new WeakMap<ContentApi, ReturnType<typeof __buildTryndamere_E>>();
export default function makeTryndamere_E(api: ContentApi) {
  const cached = __cacheTryndamere_E.get(api);
  if (cached) return cached;
  const built = __buildTryndamere_E(api);
  __cacheTryndamere_E.set(api, built);
  return built;
}


interface BladeCut {
  x: number;
  y: number;
  age: number;
}


/**
 * The whirl itself: two sword arcs spinning around him for the length of the
 * dash, and a spark of steel at every body they open.
 *
 * A `SpellObject` rather than caster VFX because the arcs reach 70px past his
 * body and the cuts are left behind him — `Champion.draw` is skipped the moment
 * he is culled, which would take the whole spin with it.
 */
function __buildTryndamere_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Tryndamere_E_Object extends SpellObject {
    age = 0;
    spinning = true;
    fade = 1;
    cuts: BladeCut[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffd8d8', 0.5);

    onAdded(): void {
      this.useParticles(this.particleSystem);
    }

    cutAt(x: number, y: number): void {
      this.cuts.push({ x, y, age: 0 });
      for (let i = 0; i < 6; i++) {
        this.particleSystem.addParticle({
          x: x + random(-12, 12),
          y: y + random(-12, 12),
          r: random(3, 8),
        });
      }
    }

    update(): void {
      if (this.attachmentLost) this.spinning = false;
      if (this.spinning) {
        this.position.set(this.owner.position.x, this.owner.position.y);
        this.age += deltaTime;
      } else {
        this.fade -= deltaTime / 260;
      }

      let write = 0;
      for (let i = 0; i < this.cuts.length; i++) {
        this.cuts[i].age += deltaTime;
        if (this.cuts[i].age < 300) this.cuts[write++] = this.cuts[i];
      }
      this.cuts.length = write;

      if (!this.spinning && this.fade <= 0 && this.cuts.length === 0) this.toRemove = true;
    }

    draw(): void {
      if (this.spinning || this.fade > 0) {
        const alpha = this.spinning ? 1 : Math.max(0, this.fade);
        const spin = this.age * 0.03;
        const reach = TRYNDAMERE_E_HIT_RADIUS;

        push();
        translate(this.position.x, this.position.y);
        noFill();
        // two blades on opposite sides, on the real hit radius so the reach reads
        for (let i = 0; i < 2; i++) {
          const angle = spin + Math.PI * i;
          stroke(255, 240, 240, 235 * alpha);
          strokeWeight(4);
          arc(0, 0, reach * 2, reach * 2, angle - 0.9, angle);
          // the sword itself at the leading edge of its own arc
          stroke(220, 230, 255, 245 * alpha);
          strokeWeight(6);
          line(
            cos(angle) * reach * 0.35,
            sin(angle) * reach * 0.35,
            cos(angle) * reach,
            sin(angle) * reach
          );
        }
        // a dim ghost arc trailing behind, so the spin has a direction
        stroke(200, 120, 120, 110 * alpha);
        strokeWeight(3);
        circle(0, 0, reach * 2);
        pop();
      }

      for (const cut of this.cuts) {
        const t = constrain(cut.age / 300, 0, 1);
        push();
        translate(cut.x, cut.y);
        rotate(t * 1.2);
        stroke(255, 235, 235, 235 * (1 - t));
        strokeWeight(4 * (1 - t) + 1);
        noFill();
        // a slash mark, not a ring: this is a sword cut
        arc(0, 0, 40 + 40 * t, 40 + 40 * t, -0.9, 0.9);
        arc(0, 0, 40 + 40 * t, 40 + 40 * t, Math.PI - 0.9, Math.PI + 0.9);
        pop();
      }
    }

    getDisplayBoundingBox(): Rectangle {
      let minX = this.position.x;
      let minY = this.position.y;
      let maxX = this.position.x;
      let maxY = this.position.y;
      for (const cut of this.cuts) {
        minX = Math.min(minX, cut.x);
        minY = Math.min(minY, cut.y);
        maxX = Math.max(maxX, cut.x);
        maxY = Math.max(maxY, cut.y);
      }
      const pad = TRYNDAMERE_E_HIT_RADIUS + 60;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return Tryndamere_E_Object;
}
const __cacheTryndamere_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTryndamere_E_Object>>();
export function makeTryndamere_E_Object(api: ContentApi) {
  const cached = __cacheTryndamere_E_Object.get(api);
  if (cached) return cached;
  const built = __buildTryndamere_E_Object(api);
  __cacheTryndamere_E_Object.set(api, built);
  return built;
}