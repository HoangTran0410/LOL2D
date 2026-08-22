import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Invulnerable = InstanceType<ContentApi['buffs']['Invulnerable']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Camille_R = InstanceType<ReturnType<typeof makeCamille_R>>;
type Camille_R_Object = InstanceType<ReturnType<typeof makeCamille_R_Object>>;



export const CAMILLE_R_RADIUS = 220;

export const CAMILLE_R_DURATION_MS = 4000;

/** The field slams shut over this long — the window to be outside when it does. */
export const CAMILLE_R_SEAL_MS = 320;

/** How far past the wall the field still looks for escapees, so a Flash is caught. */
export const CAMILLE_R_REACH = 400;

/** How far inside the wall an escapee is dragged back to. */
export const CAMILLE_R_PULL_DEPTH = 30;

export const CAMILLE_R_PULL_SPEED = 22;

export const CAMILLE_R_PULL_MS = 600;


function __buildCamille_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Invulnerable = api.buffs.Invulnerable;
  const Untargetable = api.buffs.Untargetable;
  const Camille_R_Object = makeCamille_R_Object(api);
  class Camille_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_camille_r');
    name = 'Tối Hậu Thư (Camille_R)';
    description =
      'Nhảy vào mục tiêu, tạo một trường trọng lực nhốt chặt kẻ địch bên trong <span class="time">4 giây</span>, không thể thoát ra bằng bất kỳ cách nào và đẩy văng các kẻ địch khác ra ngoài.';
    coolDown = 10000;
    manaCost = 100;
    range = 475;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      this.owner.addBuff(new Invulnerable(600, this.owner, this.owner));
      this.owner.addBuff(new Untargetable(600, this.owner, this.owner));

      const dashBuff = new Dash(600, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = to;
      dashBuff.dashSpeed = 16;
      dashBuff.onReachedDestination = () => {
        const obj = new Camille_R_Object(this.owner);
        obj.position = to.copy();
        this.game.objectManager.addObject(obj);
      };
      this.owner.addBuff(dashBuff);
    }
  }
  return Camille_R;
}
const __cacheCamille_R = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_R>>();
export default function makeCamille_R(api: ContentApi) {
  const cached = __cacheCamille_R.get(api);
  if (cached) return cached;
  const built = __buildCamille_R(api);
  __cacheCamille_R.set(api, built);
  return built;
}


interface WallSpark {
  angle: number;
  age: number;
}


/**
 * The hextech cage.
 *
 * It used to appear at full size on the frame it was created, which for a
 * four-second lockdown is the one moment that matters: whether you were inside
 * when it closed is the entire decision, and the old version gave nobody a frame
 * to see it coming. Now it slams shut from wide open, and the wall lights up
 * where a body is actually being held against it — so the prisoner can see the
 * cage working rather than just failing to walk.
 */
function __buildCamille_R_Object(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const SpellObject = api.SpellObject;
  const Dash = api.buffs.Dash;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  class Camille_R_Object extends SpellObject {
    radius = CAMILLE_R_RADIUS;
    lifeTime = CAMILLE_R_DURATION_MS;
    timer = 0;

    /** Bright flashes on the perimeter where someone just hit the wall. */
    sparks: WallSpark[] = [];

    /** Everyone the field has ever held. Only these are pulled back. */
    captured = new Set<AttackableUnit>();
    /** The pull currently dragging each escapee, so one is not stacked per frame. */
    pulls = new Map<AttackableUnit, Dash>();

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffd700');

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      // the slam: a ring of sparks along the perimeter as the cage bites down
      for (let i = 0; i < 18; i++) {
        const angle = (TWO_PI / 18) * i;
        this.particleSystem.addParticle({
          x: this.position.x + cos(angle) * this.radius,
          y: this.position.y + sin(angle) * this.radius,
          r: random(7, 14),
        });
      }
    }

    /** How far in the wall has closed: >1 while it is still coming down. */
    get sealScale(): number {
      const t = constrain(this.timer / CAMILLE_R_SEAL_MS, 0, 1);
      // ease-out from 1.9x down to 1x, so it reads as slamming rather than sliding
      return 1 + 0.9 * (1 - t) * (1 - t);
    }

    update() {
      this.timer += deltaTime;
      if (this.timer >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      if (frameCount % 10 === 0) {
        const angle = random(TWO_PI);
        this.particleSystem.addParticle({
          x: this.position.x + cos(angle) * this.radius,
          y: this.position.y + sin(angle) * this.radius,
          r: random(6, 12),
        });
      }

      let write = 0;
      for (let i = 0; i < this.sparks.length; i++) {
        this.sparks[i].age += deltaTime;
        if (this.sparks[i].age < 260) this.sparks[write++] = this.sparks[i];
      }
      this.sparks.length = write;

      // The wall only holds once it has finished closing; until then it is a
      // telegraph, and walking out of it is the counterplay.
      if (this.timer < CAMILLE_R_SEAL_MS) return;

      // The duel is hers to hold: step out of your own cage and it is over. Without
      // this the field outlived her, which made it a zone-control ultimate rather
      // than the 1v1 lock it is supposed to be.
      if (this.owner.position.dist(this.position) > this.radius) {
        this.toRemove = true;
        return;
      }

      const units = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.radius + CAMILLE_R_REACH,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      for (const u of units) {
        const dist = this.position.dist(u.position);
        const inside = dist <= this.radius - u.stats.size.value / 2;

        // Membership is earned by being inside, never by standing near. The old
        // test was a distance band around the wall, so a bystander who had never
        // entered got grabbed by a cage they were merely walking past.
        if (inside) {
          this.captured.add(u);
          continue;
        }
        if (!this.captured.has(u)) continue;

        // A captured unit outside the wall is escaping. Pull it back with a real
        // displacement rather than writing its position: a clamp pins the victim
        // against the rim so it cannot move at all, and any teleport that clears
        // the rim in one frame lands outside the band and escapes cleanly — which
        // is exactly backwards. A dash lets it move, and follows a Flash.
        const existing = this.pulls.get(u);
        if (existing && !existing.toRemove) continue;

        const back = VectorUtils.getVectorWithRange(
          this.position,
          u.position,
          this.radius - CAMILLE_R_PULL_DEPTH
        ).to;
        const pull = new Dash(CAMILLE_R_PULL_MS, this.owner, u);
        pull.image = api.asset('spell_camille_r');
        pull.dashDestination = back;
        pull.dashSpeed = CAMILLE_R_PULL_SPEED;
        pull.showTrail = false;
        // Her cage is not cancelled by her own crowd control, and a prisoner
        // cannot root itself free of it either.
        pull.cancelable = false;
        u.addBuff(pull);
        this.pulls.set(u, pull);

        // light the wall where it just caught someone
        this.sparks.push({
          angle: VectorUtils.getAngle(this.position, u.position),
          age: 0,
        });
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      const seal = this.sealScale;
      const closing = this.timer < CAMILLE_R_SEAL_MS;
      const life = constrain(this.timer / this.lifeTime, 0, 1);
      // the last half-second it starts to give out, so the escape is telegraphed too
      const failing = life > 0.88 ? (sin(frameCount * 0.6) * 0.5 + 0.5) * 0.6 + 0.4 : 1;
      const alpha = 200 * failing;
      const r = this.radius * seal;

      // interior field
      noStroke();
      fill(255, 200, 0, (closing ? 12 : 32) * failing);
      circle(0, 0, r * 2);

      // the wall: heavy outer ring, thin inner ring
      noFill();
      stroke(255, 215, 0, alpha);
      strokeWeight(closing ? 8 : 4);
      circle(0, 0, r * 2);
      stroke(255, 240, 140, alpha * 0.7);
      strokeWeight(2);
      circle(0, 0, (r - 15) * 2);

      // hex cells running around the inside of the wall — Camille's motif, and
      // they make the boundary read as built rather than drawn
      push();
      rotate(frameCount * 0.006);
      stroke(255, 225, 90, alpha * 0.55);
      strokeWeight(2);
      const cells = 14;
      for (let i = 0; i < cells; i++) {
        push();
        rotate((TWO_PI / cells) * i);
        translate(r - 26, 0);
        beginShape();
        for (let k = 0; k < 6; k++) {
          const a = (TWO_PI / 6) * k;
          vertex(cos(a) * 15, sin(a) * 15);
        }
        endShape(CLOSE);
        pop();
      }
      pop();

      // counter-rotating inner frame, so the cage never looks static over 4s
      push();
      rotate(-frameCount * 0.012);
      stroke(255, 235, 160, alpha * 0.5);
      strokeWeight(2);
      beginShape();
      for (let i = 0; i < 8; i++) {
        const angle = (TWO_PI / 8) * i;
        vertex(cos(angle) * (r - 5), sin(angle) * (r - 5));
      }
      endShape(CLOSE);
      pop();

      // impact flare where a body is being held against the wall right now
      for (const spark of this.sparks) {
        const t = constrain(spark.age / 260, 0, 1);
        push();
        rotate(spark.angle);
        noStroke();
        fill(255, 255, 220, 230 * (1 - t));
        ellipse(this.radius, 0, 34 * (1 - t) + 8, 60 * (1 - t) + 14);
        pop();
      }

      // the closing slam itself: a bright leading edge coming down onto the radius
      if (closing) {
        noFill();
        stroke(255, 255, 235, 240);
        strokeWeight(3);
        circle(0, 0, r * 2 + 14);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // the seal animation starts nearly twice as wide as the final radius
      const r = this.radius * 2 + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Camille_R_Object;
}
const __cacheCamille_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_R_Object>>();
export function makeCamille_R_Object(api: ContentApi) {
  const cached = __cacheCamille_R_Object.get(api);
  if (cached) return cached;
  const built = __buildCamille_R_Object(api);
  __cacheCamille_R_Object.set(api, built);
  return built;
}