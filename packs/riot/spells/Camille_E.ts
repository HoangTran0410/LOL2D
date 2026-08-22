import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { WallContact } from '@moba2d/core/content/types';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Camille_E = InstanceType<ReturnType<typeof makeCamille_E>>;
type Camille_E_DiveStreak = InstanceType<ReturnType<typeof makeCamille_E_DiveStreak>>;
type Camille_E_GrappleObject = InstanceType<ReturnType<typeof makeCamille_E_GrappleObject>>;
type Camille_E_TetherObject = InstanceType<ReturnType<typeof makeCamille_E_TetherObject>>;



export const CAMILLE_E_DIVE_DAMAGE = 35;

export const CAMILLE_E_DIVE_RANGE = 450;

export const CAMILLE_E_CC_MS = 750;


function __buildCamille_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Airborne = api.buffs.Airborne;
  const Stun = api.buffs.Stun;
  const Speedup = api.buffs.Speedup;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const Champion = api.units.Champion;
  const Camille_E_GrappleObject = makeCamille_E_GrappleObject(api);
  const Camille_E_DiveStreak = makeCamille_E_DiveStreak(api);
  class Camille_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_camille_e');
    name = 'Bắn Dây Móc (Camille_E)';
    description =
      'Bắn dây móc theo hướng chỉ định. Nếu trúng tường, kéo Camille tới tường và cho phép tái kích hoạt <span class="buff">Nhảy Tường</span> lướt tới va chạm tướng địch đầu tiên.';
    coolDown = 10000;
    manaCost = 70;
    range = 750;

    attachedToWall = false;
    wallAttachPoint: p5.Vector | null = null;
    /** The cable drawn while she is perched, so the recast is not invisible. */
    tetherObj: Camille_E_TetherObject | null = null;

    checkCastCondition() {
      return Dash.CanDash(this.owner);
    }

    /** Both the wall-dive and losing the perch come through here, so it is idempotent. */
    releaseWall() {
      this.attachedToWall = false;
      this.wallAttachPoint = null;
      this.image = api.asset('spell_camille_e');
      if (this.tetherObj) {
        this.tetherObj.toRemove = true;
        this.tetherObj = null;
      }
    }

    onSpellCast() {
      if (this.attachedToWall && this.wallAttachPoint) {
        // Wall Dive (E2)
        const wallPoint = this.wallAttachPoint.copy();
        this.releaseWall();

        const { to: diveDest } = VectorUtils.getVectorWithRange(
          wallPoint,
          this.aimPoint,
          CAMILLE_E_DIVE_RANGE
        );

        const hitTargets = new Set<any>();
        let hasHitChampion = false;

        const diveBuff = new Dash(1000, this.owner, this.owner);
        diveBuff.image = api.asset('spell_camille_e2');
        diveBuff.dashDestination = diveDest;
        diveBuff.dashSpeed = 12;

        // she launches off the wall, so the streak starts at the wall she left
        const streak = new Camille_E_DiveStreak(this.owner, wallPoint.copy());
        this.game.objectManager.addObject(streak);

        diveBuff.onDashUpdate = () => {
          if (hasHitChampion) return;

          // Query enemies around Camille during Wall Dive
          const enemies = this.game.objectManager.queryObjects({
            area: new Circle({
              x: this.owner.position.x,
              y: this.owner.position.y,
              r: this.owner.stats.size.value / 2 + 30,
            }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
          });

          for (const enemy of enemies) {
            if (!hitTargets.has(enemy)) {
              hitTargets.add(enemy);
              enemy.takeDamage(CAMILLE_E_DIVE_DAMAGE, this.owner);
              enemy.addBuff(new Airborne(CAMILLE_E_CC_MS, this.owner, enemy));
              enemy.addBuff(new Stun(CAMILLE_E_CC_MS, this.owner, enemy));
              streak.impactAt(enemy.position.x, enemy.position.y);

              // Stop prematurely on first enemy champion hit!
              if (enemy instanceof Champion) {
                hasHitChampion = true;
                diveBuff.dashDestination = this.owner.position.copy();
                const speed = new Speedup(4000, this.owner, this.owner);
                speed.percent = 0.4;
                this.owner.addBuff(speed);
                break;
              }
            }
          }
        };
        diveBuff.onDeactivate = () => streak.endDive();
        this.owner.addBuff(diveBuff);
        return;
      }

      // Hookshot (E1): Fire grapple projectile
      const { from, to: hookEnd } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const grapple = new Camille_E_GrappleObject(this.owner, this);
      grapple.position = from.copy();
      grapple.destination = hookEnd;
      this.game.objectManager.addObject(grapple);
    }
  }
  return Camille_E;
}
const __cacheCamille_E = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_E>>();
export default function makeCamille_E(api: ContentApi) {
  const cached = __cacheCamille_E.get(api);
  if (cached) return cached;
  const built = __buildCamille_E(api);
  __cacheCamille_E.set(api, built);
  return built;
}


/** Grapple missile sent forward to seek terrain wall. */
function __buildCamille_E_GrappleObject(api: ContentApi) {
  const Dash = api.buffs.Dash;
  const sweepToWall = api.terrain.sweepToWall;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const MissileSpellObject = api.MissileSpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Camille_E_TetherObject = makeCamille_E_TetherObject(api);
  class Camille_E_GrappleObject extends MissileSpellObject {
    speed = 12;
    size = 20;
    /** The hook is a grapple, not a skillshot: it looks for wall, not for bodies. */
    maxHitCount = 0;
    spellRef: Camille_E;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#c8c8ff', 0.4);

    constructor(owner: any, spellRef: Camille_E) {
      super(owner);
      this.spellRef = spellRef;
    }

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    private previousX = 0;
    private previousY = 0;

    onBeforeMove(): void {
      this.previousX = this.position.x;
      this.previousY = this.position.y;
    }

    onAfterMove(): void {
      // The whole step, not just where it landed. This used to test the hook's
      // own position once a frame, which at speed 12 answers "is it inside the
      // wall yet" — so the anchor was set as much as a frame's travel *past* the
      // surface, Camille was then pulled to that point, and she spent the perch
      // standing inside solid rock. `sweepToWall` finds the crossing itself, and
      // for walls of both kinds at once: asking the map's polygons alone sent the
      // hook straight through an Anivia ice wall and through Cataclysm.
      const contact = sweepToWall(
        this.game,
        this.previousX,
        this.previousY,
        this.position.x,
        this.position.y
      );
      if (contact) this.onHitWall(contact);
    }

    onHitWall(contact: WallContact) {
      this.toRemove = true;

      // Spark particles on wall contact
      for (let i = 0; i < 15; i++) {
        this.particleSystem.addParticle({
          x: contact.x + random(-20, 20),
          y: contact.y + random(-20, 20),
          r: random(5, 12),
        });
      }

      // She perches *against* the wall, not in it: the anchor is on the surface,
      // and her body stops a radius short of it along the outward normal. Sending
      // her to the anchor itself buried her, and left the push-out to argue her
      // back out of a wall it could not always win.
      const anchor = createVector(contact.x, contact.y);
      const perch = createVector(
        contact.x + contact.normalX * this.owner.terrainRadius,
        contact.y + contact.normalY * this.owner.terrainRadius
      );

      // Pull Camille to wall
      const pullBuff = new Dash(800, this.owner, this.owner);
      pullBuff.dashDestination = perch;
      pullBuff.dashSpeed = 13;
      pullBuff.onReachedDestination = () => {
        this.spellRef.attachedToWall = true;
        this.spellRef.wallAttachPoint = anchor.copy();
        this.spellRef.image = api.asset('spell_camille_e2');
        this.spellRef.resetCoolDown();

        // the perch is a decision window, so it needs to be visible: a taut cable
        // back to the anchor and a ring that says the recast is live
        const tether = new Camille_E_TetherObject(this.owner, anchor.copy(), this.spellRef);
        this.spellRef.tetherObj = tether;
        this.game.objectManager.addObject(tether);
      };
      this.owner.addBuff(pullBuff);
    }

    /** The cable pays out behind the hook rather than being one straight line. */
    draw() {
      const ox = this.owner.position.x;
      const oy = this.owner.position.y;
      const dx = this.position.x - ox;
      const dy = this.position.y - oy;
      const span = Math.hypot(dx, dy);
      const heading = Math.atan2(dy, dx);

      push();
      // cable: drawn as segments with a slack wobble, so it reads as a line paying
      // out rather than a laser
      const links = Math.max(2, Math.floor(span / 26));
      stroke(70, 80, 110, 200);
      strokeWeight(5);
      noFill();
      beginShape();
      for (let i = 0; i <= links; i++) {
        const t = i / links;
        const sag = sin(t * PI) * sin(frameCount * 0.25 + t * 6) * 4;
        vertex(ox + dx * t - sin(heading) * sag, oy + dy * t + cos(heading) * sag);
      }
      endShape();
      stroke(200, 210, 240, 230);
      strokeWeight(2);
      beginShape();
      for (let i = 0; i <= links; i++) {
        const t = i / links;
        const sag = sin(t * PI) * sin(frameCount * 0.25 + t * 6) * 4;
        vertex(ox + dx * t - sin(heading) * sag, oy + dy * t + cos(heading) * sag);
      }
      endShape();

      // the hook head: three spinning claws, not a dot
      translate(this.position.x, this.position.y);
      rotate(heading + frameCount * 0.3);
      stroke(230, 235, 255, 245);
      strokeWeight(3);
      noFill();
      for (let i = 0; i < 3; i++) {
        push();
        rotate((TWO_PI / 3) * i);
        arc(0, 0, 20, 20, -0.5, 0.9);
        line(9, 3, 13, 9);
        pop();
      }
      noStroke();
      fill(190, 215, 255, 240);
      circle(0, 0, 8);
      pop();
    }

    getDisplayBoundingBox() {
      // the cable spans back to Camille, so the box has to cover both ends
      const minX = Math.min(this.position.x, this.owner.position.x) - 24;
      const minY = Math.min(this.position.y, this.owner.position.y) - 24;
      const maxX = Math.max(this.position.x, this.owner.position.x) + 24;
      const maxY = Math.max(this.position.y, this.owner.position.y) + 24;
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return Camille_E_GrappleObject;
}
const __cacheCamille_E_GrappleObject = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_E_GrappleObject>>();
export function makeCamille_E_GrappleObject(api: ContentApi) {
  const cached = __cacheCamille_E_GrappleObject.get(api);
  if (cached) return cached;
  const built = __buildCamille_E_GrappleObject(api);
  __cacheCamille_E_GrappleObject.set(api, built);
  return built;
}


/**
 * The taut cable while she is perched on the wall.
 *
 * Without it the perch is a state the player can only find by looking at the
 * ability icon — the recast window was completely invisible in the world.
 */
function __buildCamille_E_TetherObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Rectangle = api.utils.Quadtree.Rectangle;
  class Camille_E_TetherObject extends SpellObject {
    anchor: p5.Vector;
    spellRef: Camille_E;

    constructor(owner: any, anchor: p5.Vector, spellRef: Camille_E) {
      super(owner);
      this.anchor = anchor;
      this.spellRef = spellRef;
      this.position = anchor.copy();
    }

    update() {
      if (this.dropIfAttachmentLost()) return;
      if (!this.owner || this.owner.toRemove || !this.spellRef.attachedToWall) {
        this.toRemove = true;
      }
    }

    draw() {
      const ox = this.owner.position.x;
      const oy = this.owner.position.y;

      push();
      // the cable, now taut — no sag, because she is hanging on it
      stroke(60, 70, 100, 220);
      strokeWeight(5);
      line(ox, oy, this.anchor.x, this.anchor.y);
      stroke(190, 205, 245, 240);
      strokeWeight(2);
      line(ox, oy, this.anchor.x, this.anchor.y);

      // a charge running up the cable towards the anchor: the recast is armed
      const t = (frameCount % 40) / 40;
      noStroke();
      fill(140, 235, 255, 230 * (1 - t));
      circle(lerp(ox, this.anchor.x, t), lerp(oy, this.anchor.y, t), 9 - 4 * t);

      // the anchor plate bitten into the wall
      translate(this.anchor.x, this.anchor.y);
      rotate(frameCount * 0.02);
      noFill();
      stroke(170, 220, 255, 200);
      strokeWeight(3);
      beginShape();
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI / 6) * i;
        vertex(cos(a) * 13, sin(a) * 13);
      }
      endShape(CLOSE);
      pop();

      // ready ring on Camille herself, pulsing, so the recast reads on her body too
      push();
      translate(ox, oy);
      const pulse = 1 + sin(frameCount * 0.16) * 0.12;
      noFill();
      stroke(150, 235, 255, 190);
      strokeWeight(3);
      circle(0, 0, 46 * pulse);
      pop();
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.anchor.x, this.owner.position.x) - 30;
      const minY = Math.min(this.anchor.y, this.owner.position.y) - 30;
      const maxX = Math.max(this.anchor.x, this.owner.position.x) + 30;
      const maxY = Math.max(this.anchor.y, this.owner.position.y) + 30;
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return Camille_E_TetherObject;
}
const __cacheCamille_E_TetherObject = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_E_TetherObject>>();
export function makeCamille_E_TetherObject(api: ContentApi) {
  const cached = __cacheCamille_E_TetherObject.get(api);
  if (cached) return cached;
  const built = __buildCamille_E_TetherObject(api);
  __cacheCamille_E_TetherObject.set(api, built);
  return built;
}


interface DiveImpact {
  x: number;
  y: number;
  age: number;
}


/**
 * The wall dive itself: a hard streak off the launch point plus a hit flash on
 * every body she catches. The dash used to be entirely unlit — the same
 * animation as walking, for a spell whose whole identity is the leap.
 */
function __buildCamille_E_DiveStreak(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const TrailSystem = api.helpers.TrailSystem;
  class Camille_E_DiveStreak extends SpellObject {
    launch: p5.Vector;
    trailSystem: TrailSystem;
    impacts: DiveImpact[] = [];
    diving = true;
    fade = 1;

    constructor(owner: any, launch: p5.Vector) {
      super(owner);
      this.launch = launch;
      this.position = launch.copy();
      this.trailSystem = new TrailSystem({
        owner,
        maxLength: 18,
        trailColor: '#8fe6ffcc',
        trailSize: 11,
        trailLifeTime: 260,
      });
    }

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
    }

    impactAt(x: number, y: number) {
      this.impacts.push({ x, y, age: 0 });
    }

    endDive() {
      this.diving = false;
    }

    update() {
      if (this.diving) {
        if (!this.owner || this.owner.toRemove) {
          this.diving = false;
        } else {
          this.position.set(this.owner.position.x, this.owner.position.y);
          this.trailSystem.addTrail(this.owner.position);
        }
      } else {
        this.fade -= deltaTime / 260;
      }

      let write = 0;
      for (let i = 0; i < this.impacts.length; i++) {
        this.impacts[i].age += deltaTime;
        if (this.impacts[i].age < 300) this.impacts[write++] = this.impacts[i];
      }
      this.impacts.length = write;

      if (!this.diving && this.fade <= 0 && this.impacts.length === 0) this.toRemove = true;
    }

    draw() {
      if (this.diving) {
        push();
        translate(this.position.x, this.position.y);
        const heading = Math.atan2(this.position.y - this.launch.y, this.position.x - this.launch.x);
        rotate(heading);
        // leading edge, drawn ahead of her body so the dive has a nose
        noStroke();
        fill(180, 240, 255, 170);
        triangle(26, 0, -12, -15, -12, 15);
        fill(255, 255, 255, 200);
        triangle(20, 0, -4, -7, -4, 7);
        pop();
      }

      // white pop on each body caught by the dive
      for (const impact of this.impacts) {
        const t = constrain(impact.age / 300, 0, 1);
        push();
        translate(impact.x, impact.y);
        noFill();
        stroke(255, 255, 255, 230 * (1 - t));
        strokeWeight(5 * (1 - t) + 1);
        circle(0, 0, 30 + 55 * t);
        stroke(150, 235, 255, 200 * (1 - t));
        strokeWeight(3);
        circle(0, 0, 16 + 34 * t);
        pop();
      }
    }

    getDisplayBoundingBox() {
      let minX = Math.min(this.position.x, this.launch.x);
      let minY = Math.min(this.position.y, this.launch.y);
      let maxX = Math.max(this.position.x, this.launch.x);
      let maxY = Math.max(this.position.y, this.launch.y);
      for (const impact of this.impacts) {
        minX = Math.min(minX, impact.x);
        minY = Math.min(minY, impact.y);
        maxX = Math.max(maxX, impact.x);
        maxY = Math.max(maxY, impact.y);
      }
      return new Rectangle({
        x: minX - 50,
        y: minY - 50,
        w: maxX - minX + 100,
        h: maxY - minY + 100,
        data: this,
      });
    }
  }
  return Camille_E_DiveStreak;
}
const __cacheCamille_E_DiveStreak = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_E_DiveStreak>>();
export function makeCamille_E_DiveStreak(api: ContentApi) {
  const cached = __cacheCamille_E_DiveStreak.get(api);
  if (cached) return cached;
  const built = __buildCamille_E_DiveStreak(api);
  __cacheCamille_E_DiveStreak.set(api, built);
  return built;
}