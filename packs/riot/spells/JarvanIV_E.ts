import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type JarvanIV_E = InstanceType<ReturnType<typeof makeJarvanIV_E>>;
type JarvanIV_E_Object = InstanceType<ReturnType<typeof makeJarvanIV_E_Object>>;



export const JARVAN_E_LIFETIME_MS = 8000;

/** How high above the planting point the standard starts its fall. */
export const JARVAN_E_DROP_HEIGHT = 400;


function __buildJarvanIV_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const JarvanIV_E_Object = makeJarvanIV_E_Object(api);
  class JarvanIV_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_jarvaniv_e');
    name = 'Hoàng Kỳ Demacia (JarvanIV_E)';
    description =
      'Cắm lá cờ Demacia tại điểm chỉ định tồn tại <span class="time">8 giây</span>. Kết hợp với chiêu Q để kéo Jarvan IV tới lá cờ và <span class="buff">Hất Tung</span> kẻ địch.';
    coolDown = 10000;
    manaCost = 55;
    range = 400;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const flagObj = new JarvanIV_E_Object(this.owner);
      flagObj.position = to;
      this.game.objectManager.addObject(flagObj);
    }
  }
  return JarvanIV_E;
}
const __cacheJarvanIV_E = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_E>>();
export default function makeJarvanIV_E(api: ContentApi) {
  const cached = __cacheJarvanIV_E.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_E(api);
  __cacheJarvanIV_E.set(api, built);
  return built;
}


/**
 * The Demacian Standard.
 *
 * The drop was already right — the ground ring only lights up once the pole has
 * actually touched down, which is the rule the guidelines call out. What was
 * missing was everything that makes it a *banner*: the cloth was a static
 * triangle, so an 8-second object stood dead still on the field. It now falls
 * with a shadow that tightens as it nears the ground, plants with a dust ring,
 * flies its cloth on a travelling wave, and flashes when a Q calls it in.
 */
function __buildJarvanIV_E_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class JarvanIV_E_Object extends SpellObject {
    isDemacianStandard = true;
    lifeTime = JARVAN_E_LIFETIME_MS;
    timer = 0;
    dropOffsetY = -JARVAN_E_DROP_HEIGHT; // Flag drops from sky
    hasLanded = false;
    /** Counts down from 1 when a Q latches onto this flag. */
    chargeFlare = 0;
    /** Squash on impact, eased out over the first moments after landing. */
    landRecoil = 0;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffd700');

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    /** Jarvan's Q found this flag: light it up as the anchor it has become. */
    onCharged() {
      this.chargeFlare = 1;
      for (let i = 0; i < 14; i++) {
        const a = (TWO_PI / 14) * i;
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * 34,
          y: this.position.y + sin(a) * 34,
          r: random(6, 12),
        });
      }
    }

    update() {
      this.timer += deltaTime;

      if (this.chargeFlare > 0) this.chargeFlare = Math.max(0, this.chargeFlare - deltaTime / 400);
      if (this.landRecoil > 0) this.landRecoil = Math.max(0, this.landRecoil - deltaTime / 260);

      if (this.dropOffsetY < 0) {
        this.dropOffsetY = Math.min(0, this.dropOffsetY + deltaTime * 2.2);
        if (this.dropOffsetY === 0 && !this.hasLanded) {
          this.hasLanded = true;
          this.landRecoil = 1;
          // On-hit ground landing impact particles ONLY upon touching ground!
          for (let i = 0; i < 20; i++) {
            this.particleSystem.addParticle({
              x: this.position.x + random(-40, 40),
              y: this.position.y + random(-40, 40),
              r: random(6, 14),
            });
          }
        }
      } else if (this.hasLanded && frameCount % 12 === 0) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-30, 30),
          y: this.position.y + random(-30, 30),
          r: random(4, 9),
        });
      }

      if (this.timer >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    draw() {
      const falling = this.dropOffsetY < 0;
      // how close to the ground, 0 at the top of the drop and 1 on contact
      const closeness = 1 - constrain(-this.dropOffsetY / JARVAN_E_DROP_HEIGHT, 0, 1);
      // the last stretch of the life, so its expiry is telegraphed
      const expiring = this.timer > this.lifeTime - 800;
      const dim = expiring ? (sin(frameCount * 0.5) * 0.5 + 0.5) * 0.5 + 0.5 : 1;

      push();

      // GROUND — the shadow exists during the fall too, tightening as it nears:
      // it is what tells you where the pole is going to land
      if (falling) {
        noStroke();
        fill(10, 10, 15, 60 + 90 * closeness);
        const shadow = 90 - 55 * closeness;
        ellipse(this.position.x, this.position.y, shadow, shadow * 0.45);
      }

      translate(this.position.x, this.position.y + this.dropOffsetY);

      // Golden beam and ground aura ring ONLY trigger AFTER landing on ground!
      if (this.hasLanded) {
        const pulse = sin(frameCount * 0.08) * 10;
        noFill();
        stroke(255, 215, 0, 160 * dim);
        strokeWeight(3);
        ellipse(0, 0, 150 + pulse, 75 + pulse * 0.5);

        noStroke();
        fill(255, 215, 0, 50 * dim);
        ellipse(0, 0, 140, 70);
        fill(255, 235, 120, 30 * dim);
        ellipse(0, 0, 180, 90);

        // the dust ring thrown out by the plant, in its first quarter second
        if (this.landRecoil > 0) {
          const k = 1 - this.landRecoil;
          noFill();
          stroke(215, 185, 120, 220 * this.landRecoil);
          strokeWeight(5 * this.landRecoil + 1);
          ellipse(0, 0, 60 + 190 * k, (60 + 190 * k) * 0.45);
        }
      }

      // the pole compresses on impact and springs back
      const squash = 1 - this.landRecoil * 0.25;

      // Flag pole
      push();
      scale(1, squash);
      fill(210, 170, 40, 255 * dim);
      stroke(255, 235, 120, 255 * dim);
      strokeWeight(3);
      rect(-4, -45, 8, 50);

      // Demacian flag cloth, flying on a travelling wave rather than sitting still
      noStroke();
      const segments = 5;
      for (let i = 0; i < segments; i++) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        // the wave grows towards the free edge of the cloth
        const w0 = sin(frameCount * 0.12 - t0 * 3.2) * 4 * t0;
        const w1 = sin(frameCount * 0.12 - t1 * 3.2) * 4 * t1;
        const topY = -45 + w0;
        const nextTopY = -45 + w1;
        const botY = -15 + w0 * 0.6;
        const nextBotY = -15 + w1 * 0.6;
        const x0 = 4 + 28 * t0;
        const x1 = 4 + 28 * t1;
        // the cloth tapers to a point, so each strip is shorter than the last
        const taper0 = 1 - t0 * 0.55;
        const taper1 = 1 - t1 * 0.55;
        fill(200, 40, 40, 255 * dim);
        beginShape();
        vertex(x0, topY);
        vertex(x1, nextTopY);
        vertex(x1, nextTopY + (nextBotY - nextTopY) * taper1);
        vertex(x0, topY + (botY - topY) * taper0);
        endShape(CLOSE);
      }
      // gold trim along the top edge
      noFill();
      stroke(255, 215, 0, 240 * dim);
      strokeWeight(2);
      beginShape();
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        vertex(4 + 28 * t, -45 + sin(frameCount * 0.12 - t * 3.2) * 4 * t);
      }
      endShape();

      // the finial catching the light
      noStroke();
      fill(255, 245, 190, 240 * dim);
      circle(0, -48, 7);
      pop();

      // Q has called this flag: a hard golden ring saying it is the anchor
      if (this.chargeFlare > 0) {
        const k = 1 - this.chargeFlare;
        noFill();
        stroke(255, 245, 190, 245 * this.chargeFlare);
        strokeWeight(5 * this.chargeFlare + 1);
        ellipse(0, 0, 40 + 150 * k, (40 + 150 * k) * 0.5);
        stroke(255, 210, 90, 200 * this.chargeFlare);
        strokeWeight(3);
        line(0, -60, 0, -60 - 30 * this.chargeFlare);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // the pole starts its fall 400px above the planting point, and the ground
      // ring spreads ~120px around it once it lands
      const top = this.position.y - JARVAN_E_DROP_HEIGHT - 60;
      const bottom = this.position.y + 120;
      const r = 130;
      return new Rectangle({
        x: this.position.x - r,
        y: top,
        w: r * 2,
        h: bottom - top,
        data: this,
      });
    }
  }
  return JarvanIV_E_Object;
}
const __cacheJarvanIV_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_E_Object>>();
export function makeJarvanIV_E_Object(api: ContentApi) {
  const cached = __cacheJarvanIV_E_Object.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_E_Object(api);
  __cacheJarvanIV_E_Object.set(api, built);
  return built;
}