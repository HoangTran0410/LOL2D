import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Graves_Q = InstanceType<ReturnType<typeof makeGraves_Q>>;
type Graves_Q_Object = InstanceType<ReturnType<typeof makeGraves_Q_Object>>;



export const RANGE = 420;

export const TRAVEL_DAMAGE = 12;

export const BLAST_DAMAGE = 26;

export const BLAST_RADIUS = 130;

/** Nose to tail, drawn. The hitbox stays `size`; this is only the picture. */
export const SHELL_LENGTH = 40;


/** End of the Line: a shell that hurts on the way through and detonates at the end. */
function __buildGraves_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Graves_Q_Object = makeGraves_Q_Object(api);
  class Graves_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_graves_q');
    name = 'Đạn Xuyên Mục Tiêu (Graves_Q)';
    description =
      `Bắn một viên đạn xuyên qua kẻ địch (<span class="damage">${TRAVEL_DAMAGE} sát thương</span>)` +
      ` rồi <span class="damage">phát nổ</span> ở cuối đường bay, gây thêm` +
      ` <span class="damage">${BLAST_DAMAGE} sát thương</span> trong <span>${BLAST_RADIUS}px</span>`;
    coolDown = 9000;
    manaCost = 30;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const shell = new Graves_Q_Object(this.owner);
      shell.destination = to;
      // Kept from the cast rather than derived on arrival: at the endpoint
      // `destination - position` collapses to zero, and the blast cone has to know
      // which way the shell was travelling to spray its pellets forward.
      const heading = to.copy().sub(this.owner.position);
      if (heading.magSq() > 0) shell.heading = heading.setMag(1);
      this.game.objectManager.addObject(shell);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Graves_Q;
}
const __cacheGraves_Q = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_Q>>();
export default function makeGraves_Q(api: ContentApi) {
  const cached = __cacheGraves_Q.get(api);
  if (cached) return cached;
  const built = __buildGraves_Q(api);
  __cacheGraves_Q.set(api, built);
  return built;
}


function __buildGraves_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const MissileSpellObject = api.MissileSpellObject;
  const AoePulse = api.AoePulse;
  const TrailSystem = api.helpers.TrailSystem;
  const AttackableUnit = api.units.AttackableUnit;
  class Graves_Q_Object extends MissileSpellObject {
    speed = 13;
    size = 18;
    /** Flight direction, held so the detonation can aim its cone. */
    heading: p5.Vector = createVector(1, 0);
    /** Grows with every frame of flight; drives the tumble and the burn-down. */
    travelled = 0;

    trailSystem: TrailSystem | null = new TrailSystem({
      trailColor: 'rgba(120, 96, 76, 0.35)',
      trailSize: 12,
      maxLength: 10,
    });

    onAfterMove() {
      this.travelled += this.speed;
    }

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(TRAVEL_DAMAGE, this.owner);
    }

    onArrive() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: BLAST_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(BLAST_DAMAGE, this.owner));

      const blast = new AoePulse(this.owner);
      blast.position = this.position.copy();
      blast.radius = BLAST_RADIUS;
      blast.lifeTime = 420;
      blast.color = [255, 170, 60];
      // A shotgun, not a rockfall: a cone of pellets thrown down the barrel line
      // with muzzle smoke sitting at the origin. `seed` is the cone's centre
      // angle for this style, so handing it the heading points the spray forward
      // instead of picking a random direction every cast.
      blast.style = 'buckshot';
      blast.seed = Math.atan2(this.heading.y, this.heading.x);
      blast.spokes = 12;
      this.game.objectManager.addObject(blast);
    }

    /**
     * A tumbling brass shell with the fuse burning down it.
     *
     * The first pass was a rounded rect and a dot, which at speed 13 read as a
     * sliding pill and gave the player nothing to judge the shot by. The tumble is
     * keyed off `travelled` rather than `frameCount`, so it spins with the shell's
     * own progress and two shells fired a frame apart do not spin in lockstep.
     */
    draw() {
      const angle = Math.atan2(this.heading.y, this.heading.x);
      const half = SHELL_LENGTH / 2;
      // Wobble, not a full spin: a shell fired flat yaws a little in the air.
      const yaw = Math.sin(this.travelled * 0.06) * 0.22;
      const spark = 0.6 + 0.4 * Math.sin(this.travelled * 0.35);

      push();
      translate(this.position.x, this.position.y);
      rotate(angle + yaw);
      noStroke();

      // Muzzle heat dragged behind the shell, brightest right at the tail.
      blendMode(ADD);
      fill(255, 150, 50, 60 * spark);
      ellipse(-half * 0.9, 0, SHELL_LENGTH * 1.3, this.size * 1.4);
      blendMode(BLEND);

      // Brass casing with a darker underside, so it has a lit edge.
      fill(96, 70, 44);
      rect(-half, -6, SHELL_LENGTH * 0.78, 12, 4);
      fill(168, 126, 66);
      rect(-half, -6, SHELL_LENGTH * 0.78, 8, 4);
      // Rim and crimp grooves — the detail that says "cartridge" at a glance.
      fill(70, 50, 32);
      rect(-half, -6, 4, 12, 2);
      fill(210, 172, 96, 180);
      for (let i = 0; i < 2; i++) rect(-half + 9 + i * 7, -6, 2, 12);

      // Lead slug at the nose, hot from the barrel.
      fill(240, 214, 172);
      ellipse(half - 8, 0, 16, 13);
      fill(255, 226, 150, 220);
      ellipse(half - 9, -2, 8, 5);

      // The fuse spark riding the tail — the tell that this one is going to go off
      // at the end of its run rather than simply landing.
      fill(255, 236, 170, 235 * spark);
      circle(-half - 3, 0, 7 * spark + 4);
      stroke(255, 190, 90, 200 * spark);
      strokeWeight(2);
      for (let i = 0; i < 3; i++) {
        const a = this.travelled * 0.2 + (i / 3) * TWO_PI;
        line(-half - 3, 0, -half - 3 + Math.cos(a) * 12, Math.sin(a) * 9);
      }
      pop();
    }

    /**
     * The heat haze and the fuse sparks both reach well past the 18px hitbox, and
     * the base box is the hitbox — which would cull the shell the instant its
     * centre left the camera while it was still visibly in frame.
     */
    getDisplayBoundingBox() {
      const span = SHELL_LENGTH;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Graves_Q_Object;
}
const __cacheGraves_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildGraves_Q_Object>>();
export function makeGraves_Q_Object(api: ContentApi) {
  const cached = __cacheGraves_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildGraves_Q_Object(api);
  __cacheGraves_Q_Object.set(api, built);
  return built;
}