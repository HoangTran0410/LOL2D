import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Camille_W = InstanceType<ReturnType<typeof makeCamille_W>>;
type Camille_W_Object = InstanceType<ReturnType<typeof makeCamille_W_Object>>;



export const CAMILLE_W_OUTER_DAMAGE = 40;

export const CAMILLE_W_INNER_DAMAGE = 20;

export const CAMILLE_W_HEAL = 30;

export const CAMILLE_W_SLOW_PERCENT = 0.8;

export const CAMILLE_W_SLOW_MS = 2000;

/** The leg draws back for this long before it lands — the window to walk out. */
export const CAMILLE_W_WINDUP_MS = 200;


function __buildCamille_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Camille_W_Object = makeCamille_W_Object(api);
  class Camille_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_camille_w');
    name = 'Đá Quét Chiến Thuật (Camille_W)';
    description =
      'Quét chân theo hình nón trước mặt. Kẻ địch ở viền ngoài chịu <span class="damage">40 sát thương</span>, bị <span class="buff">Làm Chậm 80%</span> trong <span class="time">2 giây</span> và hồi máu cho Camille.';
    coolDown = 10000;
    manaCost = 50;
    range = 400;

    onSpellCast() {
      const angle = VectorUtils.getAngle(this.owner.position, this.aimPoint);

      const obj = new Camille_W_Object(this.owner);
      obj.position = this.owner.position.copy();
      obj.angle = angle;
      this.game.objectManager.addObject(obj);
    }
  }
  return Camille_W;
}
const __cacheCamille_W = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_W>>();
export default function makeCamille_W(api: ContentApi) {
  const cached = __cacheCamille_W.get(api);
  if (cached) return cached;
  const built = __buildCamille_W(api);
  __cacheCamille_W.set(api, built);
  return built;
}


/**
 * The kick itself.
 *
 * Three beats, and the player has to be able to read all three: the leg winds
 * back (a thin telegraph that says *where*, and gives bystanders 200ms to leave),
 * the blade sweeps across the cone (the strike), then the cut hangs in the air
 * and fades. It used to draw the finished cone at full opacity on frame one,
 * which meant the telegraph and the hit were the same picture — nothing to react
 * to, and no sense that a leg had moved.
 *
 * The outer band is where the damage doubles, so it is drawn as its own lit edge
 * rather than a boundary line: whoever is standing in it can see that they are.
 */
function __buildCamille_W_Object(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Camille_W_Object extends SpellObject {
    angle = 0;
    arcSpan = HALF_PI; // 90 deg
    range = 280;
    outerMinRange = 150;
    lifeTime = 620;
    timer = 0;
    hasStruck = false;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffaa00');

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    update() {
      this.timer += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      if (!this.hasStruck && this.timer >= CAMILLE_W_WINDUP_MS) {
        this.hasStruck = true;
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({ x: this.position.x, y: this.position.y, r: this.range }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        for (const enemy of enemies) {
          const d = this.position.dist(enemy.position);
          const enemyAngle = VectorUtils.getAngle(this.position, enemy.position);
          let angleDiff = Math.abs(enemyAngle - this.angle);
          if (angleDiff > PI) angleDiff = TWO_PI - angleDiff;

          if (angleDiff <= this.arcSpan / 2) {
            if (d >= this.outerMinRange) {
              enemy.takeDamage(CAMILLE_W_OUTER_DAMAGE, this.owner);
              const slow = new Slow(CAMILLE_W_SLOW_MS, this.owner, enemy);
              slow.percent = CAMILLE_W_SLOW_PERCENT;
              enemy.addBuff(slow);

              this.owner.stats.health.baseValue = Math.min(
                this.owner.stats.maxHealth.value,
                this.owner.stats.health.baseValue + CAMILLE_W_HEAL
              );
              // the outer band is the whole point of the spell: make it obvious
              // which side of it the victim was standing on
              for (let i = 0; i < 8; i++) {
                this.particleSystem.addParticle({
                  x: enemy.position.x + random(-16, 16),
                  y: enemy.position.y + random(-16, 16),
                  r: random(7, 14),
                });
              }
            } else {
              enemy.takeDamage(CAMILLE_W_INNER_DAMAGE, this.owner);
              for (let i = 0; i < 3; i++) {
                this.particleSystem.addParticle({
                  x: enemy.position.x + random(-10, 10),
                  y: enemy.position.y + random(-10, 10),
                  r: random(4, 8),
                });
              }
            }
          }
        }

        // dust kicked along the outer band where the blade actually bit
        for (let i = 0; i < 14; i++) {
          const a = this.angle + random(-this.arcSpan / 2, this.arcSpan / 2);
          const r = random(this.outerMinRange, this.range);
          this.particleSystem.addParticle({
            x: this.position.x + cos(a) * r,
            y: this.position.y + sin(a) * r,
            r: random(5, 11),
          });
        }
      }

      if (this.timer >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    draw() {
      const half = this.arcSpan / 2;
      push();
      translate(this.position.x, this.position.y);
      rotate(this.angle);

      if (!this.hasStruck) {
        // WINDUP — a thin outline of exactly what is about to be hit, and a leg
        // cocking back to the far edge of it
        const t = constrain(this.timer / CAMILLE_W_WINDUP_MS, 0, 1);
        noFill();
        stroke(255, 180, 60, 90 + 70 * t);
        strokeWeight(2);
        arc(0, 0, this.range * 2, this.range * 2, -half, half);
        line(0, 0, cos(-half) * this.range, sin(-half) * this.range);
        line(0, 0, cos(half) * this.range, sin(half) * this.range);
        // the band that will deal the big hit, dashed so it reads as a warning
        stroke(255, 90, 70, 120 + 90 * t);
        strokeWeight(3);
        for (let i = 0; i < 7; i += 2) {
          const a1 = -half + (this.arcSpan * i) / 7;
          const a2 = -half + (this.arcSpan * (i + 1)) / 7;
          arc(0, 0, this.outerMinRange * 2, this.outerMinRange * 2, a1, a2);
        }
        // the leg, drawn back further the closer the strike gets
        stroke(180, 235, 255, 200);
        strokeWeight(5);
        const cock = -half - t * 0.5;
        line(0, 0, cos(cock) * this.range * 0.42, sin(cock) * this.range * 0.42);
        pop();
        return;
      }

      // STRIKE — the blade sweeps from one edge to the other, and the filled cone
      // is only as wide as the sweep has got, so the arc reads as motion
      const swept = constrain((this.timer - CAMILLE_W_WINDUP_MS) / 180, 0, 1);
      const ease = 1 - (1 - swept) * (1 - swept);
      const fade =
        1 -
        constrain((this.timer - CAMILLE_W_WINDUP_MS) / (this.lifeTime - CAMILLE_W_WINDUP_MS), 0, 1);
      const edge = -half + this.arcSpan * ease;

      noStroke();
      // inner half of the cone: the weak zone
      fill(255, 170, 60, 55 * fade);
      arc(0, 0, this.outerMinRange * 2, this.outerMinRange * 2, -half, edge, PIE);
      // outer band: hotter, because it hits twice as hard and heals her
      fill(255, 95, 45, 95 * fade);
      arc(0, 0, this.range * 2, this.range * 2, -half, edge, PIE);
      fill(20, 20, 30, 60 * fade);
      arc(0, 0, this.outerMinRange * 2, this.outerMinRange * 2, -half, edge, PIE);

      // the cutting edge itself, riding the leading angle of the sweep
      if (swept < 1) {
        stroke(255, 255, 235, 245 * fade);
        strokeWeight(6);
        line(cos(edge) * 25, sin(edge) * 25, cos(edge) * this.range, sin(edge) * this.range);
        stroke(255, 210, 120, 200 * fade);
        strokeWeight(14);
        line(
          cos(edge) * this.range * 0.45,
          sin(edge) * this.range * 0.45,
          cos(edge) * this.range,
          sin(edge) * this.range
        );
      }

      // lit rim on the damage boundary, so the band keeps its shape while it fades
      noFill();
      stroke(255, 240, 200, 230 * fade);
      strokeWeight(3);
      arc(0, 0, this.range * 2, this.range * 2, -half, edge);
      stroke(255, 70, 60, 200 * fade);
      strokeWeight(3);
      arc(0, 0, this.outerMinRange * 2, this.outerMinRange * 2, -half, edge);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.range + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Camille_W_Object;
}
const __cacheCamille_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_W_Object>>();
export function makeCamille_W_Object(api: ContentApi) {
  const cached = __cacheCamille_W_Object.get(api);
  if (cached) return cached;
  const built = __buildCamille_W_Object(api);
  __cacheCamille_W_Object.set(api, built);
  return built;
}