import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Leblanc_W = InstanceType<ReturnType<typeof makeLeblanc_W>>;
type Leblanc_W_Object = InstanceType<ReturnType<typeof makeLeblanc_W_Object>>;
type Leblanc_W_Object2 = InstanceType<ReturnType<typeof makeLeblanc_W_Object2>>;



/** The illusion resolves into focus over this long, rather than appearing. */
export const MIRROR_ASSEMBLE_MS = 300;

/** Fraction of the marker's life spent visibly coming apart, as a warning. */
export const MIRROR_DECAY = 0.25;


function __buildLeblanc_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const VectorUtils = api.utils.VectorUtils;
  const Dash = api.buffs.Dash;
  const Spell = api.Spell;
  const Leblanc_W_Object = makeLeblanc_W_Object(api);
  const Leblanc_W_Object2 = makeLeblanc_W_Object2(api);
  class Leblanc_W extends Spell {
    targetingMode = 'POINT' as const;
    PHASES = {
      W1: {
        image: api.asset('spell_leblanc_w1'),
      },
      W2: {
        image: api.asset('spell_leblanc_w2'),
      },
    };
    phase = this.PHASES.W1;

    image = this.phase.image;
    name = 'Biến Ảnh (Leblanc_W)';
    description =
      '<span class="buff">Lướt</span> tới vị trí chỉ định, gây <span class="damage">20 sát thương</span> cho những kẻ địch tại vị trí đó, đồng thời để lại <span>1 dị điểm</span> tồn tại <span class="time">3 giây</span> tại ví trí cũ. Tái kích hoạt sẽ lập tức <span class="buff">Dịch Chuyển</span> bạn về dị điểm.';
    coolDown = 5000;
    manaCost = 30;

    w1Object: Leblanc_W_Object | null = null;
    w1LifeTime = 3000;
    waitTimeBeforeRecast = 1000;

    swtichPhase(phase: typeof this.PHASES.W1 | typeof this.PHASES.W2, coolDown: number) {
      this.phase = phase;
      this.image = phase.image;
      this.currentCooldown = coolDown;
    }

    checkCastCondition() {
      if (this.phase == this.PHASES.W1) {
        return this.owner.canMove;
      } else if (this.phase == this.PHASES.W2) {
        return this.w1Object != null;
      }
      return false;
    }

    onSpellCast() {
      if (this.phase == this.PHASES.W1) {
        const maxDistance = 300;

        const { to: destination } = VectorUtils.getVectorWithMaxRange(
          this.owner.position,
          this.aimPoint,
          maxDistance
        );

        const dashBuff = new Dash(2000, this.owner, this.owner);
        dashBuff.image = api.asset('spell_leblanc_w1');
        dashBuff.dashSpeed = 10;
        dashBuff.dashDestination = destination;
        dashBuff.onReachedDestination = () => {
          const w2Obj = new Leblanc_W_Object2(this.owner);
          w2Obj.position = destination.copy();
          w2Obj.lifeTime = 700;
          w2Obj.size = 200;
          this.game.objectManager.addObject(w2Obj);

          const enemies = this.game.objectManager.queryObjects({
            area: new Circle({
              x: destination.x,
              y: destination.y,
              r: w2Obj.size / 2,
            }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
          });
          enemies.forEach((enemy: any) => {
            enemy.takeDamage(20, this.owner);
          });
        };

        this.owner.moveTo(destination.x, destination.y);
        this.owner.addBuff(dashBuff);

        this.w1Object = new Leblanc_W_Object(this.owner);
        this.w1Object.position = this.owner.position.copy();
        this.w1Object.lifeTime = this.w1LifeTime;
        this.game.objectManager.addObject(this.w1Object);

        // recast window, not a cooldown — deliberately not reduced
        this.swtichPhase(this.PHASES.W2, this.waitTimeBeforeRecast);
      } else {
        if (this.w1Object) {
          this.owner.position.set(this.w1Object.position.x, this.w1Object.position.y);
          this.w1Object.toRemove = true;
        }

        this.swtichPhase(this.PHASES.W1, this.reducedCooldown(this.coolDown));
      }
    }

    onUpdate() {
      if (this.phase == this.PHASES.W2) {
        if (this.w1Object?.toRemove) {
          this.swtichPhase(this.PHASES.W1, this.reducedCooldown(this.coolDown));
        }
      }
    }
  }
  return Leblanc_W;
}
const __cacheLeblanc_W = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_W>>();
export default function makeLeblanc_W(api: ContentApi) {
  const cached = __cacheLeblanc_W.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_W(api);
  __cacheLeblanc_W.set(api, built);
  return built;
}


/**
 * The return marker: LeBlanc, standing where she was.
 *
 * It has two jobs that pull in opposite directions, and the resolution is *who
 * is looking*.
 *
 * To LeBlanc it is a countdown — *how long do I still have to blink back?* — so
 * she gets a floor sigil and an arc spending clockwise from the top.
 *
 * To everyone else it has to be a lie worth falling for. A ring of spinning
 * glass around a violet-washed disc is not a lie: it is a clearly-labelled
 * marker that says "the real one is elsewhere", which makes the ability a
 * mobility tool and nothing more. So the enemy is shown the avatar and almost
 * nothing else — the tells are a faint rim and a slow shimmer, and the honest
 * giveaway is the one the game cannot hide, that it does not move or fight.
 *
 * That asymmetry is the ability. `isAllied` is read from the *viewer's* side
 * because everything is drawn from the local player's point of view.
 */
function __buildLeblanc_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Leblanc_W_Object extends SpellObject {
    position = createVector();
    lifeTime = 3000;
    age = 0;

    /** Whether the local player is the one being fooled by this. */
    get foolsViewer(): boolean {
      return !(this.owner as { isAllied?: boolean }).isAllied;
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const { stats, avatar } = this.owner as any;
      const size = stats.size.value;
      const r = size / 2;
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // ease-out assembly, then a long hold, then the decay: three states the
      // player can tell apart without reading a number
      const grow = constrain(this.age / MIRROR_ASSEMBLE_MS, 0, 1);
      const born = 1 - (1 - grow) * (1 - grow);
      const decay = constrain((t - (1 - MIRROR_DECAY)) / MIRROR_DECAY, 0, 1);
      const solid = born * (1 - decay);
      const left = 1 - t;

      const fooling = this.foolsViewer;

      push();
      translate(this.position.x, this.position.y);

      // LeBlanc's own instrumentation. Withheld from the enemy on purpose: a
      // countdown ring under the copy is a label reading "this one is fake", and
      // an illusion that announces itself is not an illusion.
      if (!fooling) {
        noFill();
        stroke(168, 96, 240, 150 * solid + 40);
        strokeWeight(2);
        circle(0, 0, size * 1.5);
        strokeWeight(1.2);
        circle(0, 0, size * 1.22);

        // countdown: the recast window, spent clockwise from the top
        stroke(214, 168, 255, 230 * (born - decay * 0.4));
        strokeWeight(4);
        arc(0, 0, size * 1.5, size * 1.5, -HALF_PI, -HALF_PI + TWO_PI * left);
      }

      // The illusion itself, drawn at full strength — this is the whole ability.
      // It used to be buried under a violet disc at ~150 alpha, which turned a
      // decoy into a purple blob nobody could mistake for a champion.
      if (born > 0.05) {
        // resolving into focus: a chromatic double that converges as it forms and
        // separates again as it dies. Both are the same tell, run in reverse, and
        // both are subtle enough to miss in a fight.
        const split = ((1 - born) * 0.5 + decay * 0.65) * r * 0.55;
        if (split > 0.4) {
          push();
          blendMode(ADD);
          tint(150, 90, 255, 120);
          image(api.renderableAsset(avatar), -split, 0, size, size);
          tint(120, 220, 255, 110);
          image(api.renderableAsset(avatar), split, 0, size, size);
          noTint();
          blendMode(BLEND);
          pop();
        }

        // the copy, essentially as she really looks
        push();
        tint(255, 255, 255, 255 * (0.55 + 0.45 * solid));
        image(api.renderableAsset(avatar), 0, 0, size, size);
        noTint();
        pop();

        // the only permanent tell an enemy gets: a thin violet rim, and a slow
        // shimmer crossing her. Enough to reward someone who looks twice.
        noFill();
        stroke(178, 120, 246, (fooling ? 90 : 150) * solid);
        strokeWeight(1.5);
        circle(0, 0, size * 1.02);

        const sweep = ((this.age % 1600) / 1600) * 2 - 1;
        noStroke();
        fill(226, 196, 255, (fooling ? 34 : 62) * solid);
        push();
        rotate(-0.6);
        ellipse(sweep * r, 0, r * 0.42, size * 0.92);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the sigil and countdown arc sit well outside the avatar
      const r = this.owner.stats.size.value * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Leblanc_W_Object;
}
const __cacheLeblanc_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_W_Object>>();
export function makeLeblanc_W_Object(api: ContentApi) {
  const cached = __cacheLeblanc_W_Object.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_W_Object(api);
  __cacheLeblanc_W_Object.set(api, built);
  return built;
}


/**
 * The arrival: the surface she stepped out of, still ringing.
 *
 * Deliberately not a shatter. Flying glass is the impact half the roster
 * already throws, and it tells the wrong story anyway — nothing was broken
 * here, something was passed through.
 */
function __buildLeblanc_W_Object2(api: ContentApi) {
  const Leblanc_W_Object = makeLeblanc_W_Object(api);
  class Leblanc_W_Object2 extends Leblanc_W_Object {
    size = 200;

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.2, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the flash of arrival, gone almost immediately
      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(206, 160, 255, 210 * flash);
        circle(0, 0, this.size * 0.55 * flash + 30);
        blendMode(BLEND);
      }

      // hard rim on the damage radius: everyone inside this took the 20
      noFill();
      stroke(120, 60, 200, 190 * fade);
      strokeWeight(8 * fade + 2);
      circle(0, 0, this.size);
      stroke(226, 198, 255, 235 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.size);

      // the wave racing out to that rim, so the boundary is arrived at, not stated
      stroke(190, 140, 250, 210 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, this.size * (0.15 + t * 0.85));

      // Ripples rather than debris. Breaking glass says a solid object was
      // destroyed here, which is the wrong story for a woman stepping out of her
      // own reflection — and it is the same triangle burst half the roster
      // already throws. Concentric rings crossing each other read as a surface
      // disturbed, and they are hers alone.
      noFill();
      for (let i = 0; i < 3; i++) {
        const phase = constrain(t * 1.5 - i * 0.18, 0, 1);
        if (phase <= 0) continue;
        stroke(196, 156, 250, 200 * (1 - phase) * fade);
        strokeWeight(3 * (1 - phase) + 1);
        // squashed and counter-rotated, so the rings read as a plane being
        // crossed rather than a second shockwave
        push();
        rotate(i * 0.7 - t * 0.5);
        ellipse(0, 0, this.size * phase, this.size * phase * 0.55);
        pop();
      }

      // the seam she came through, closing vertically
      const seam = 1 - constrain(t / 0.55, 0, 1);
      if (seam > 0) {
        blendMode(ADD);
        noStroke();
        fill(224, 200, 255, 190 * seam);
        ellipse(0, 0, this.size * 0.1 * seam + 4, this.size * 0.9 * seam);
        blendMode(BLEND);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the ripples overshoot the rim, so the box is wider than the damage radius
      const r = this.size * 0.85;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Leblanc_W_Object2;
}
const __cacheLeblanc_W_Object2 = new WeakMap<ContentApi, ReturnType<typeof __buildLeblanc_W_Object2>>();
export function makeLeblanc_W_Object2(api: ContentApi) {
  const cached = __cacheLeblanc_W_Object2.get(api);
  if (cached) return cached;
  const built = __buildLeblanc_W_Object2(api);
  __cacheLeblanc_W_Object2.set(api, built);
  return built;
}