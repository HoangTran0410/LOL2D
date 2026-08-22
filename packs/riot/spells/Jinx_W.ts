import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Jinx_W = InstanceType<ReturnType<typeof makeJinx_W>>;
type Jinx_W_Object = InstanceType<ReturnType<typeof makeJinx_W_Object>>;



/**
 * Reach of the bolt.
 *
 * 850 was read straight off the wiki and never scaled. The map here is about
 * 1600x1600 and the rest of the skillshot roster sits between 350 and 500, so a
 * single 850px line covered better than half the world from a standing start —
 * a poke that could not be walked out of and did not have to be aimed. 620
 * keeps Zap! the longest shot Jinx owns without letting it cross the map.
 */
export const RANGE = 620;

export const DAMAGE = 30;

export const SLOW_PERCENT = 0.6;

export const SLOW_DURATION = 2000;


/** Zap!: her longest skillshot, and it stops whoever it finds. */
function __buildJinx_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Jinx_W_Object = makeJinx_W_Object(api);
  class Jinx_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_jinx_w');
    name = 'Giật Bắn! (Jinx_W)';
    description =
      `Bắn một tia điện xa <span>${RANGE}px</span>: mục tiêu đầu tiên trúng phải nhận` +
      ` <span class="damage">${DAMAGE} sát thương</span> và bị <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
      ` trong <span class="time">${SLOW_DURATION / 1000} giây</span>`;
    coolDown = 9000;
    manaCost = 35;

    range = RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const bolt = new Jinx_W_Object(this.owner);
      bolt.destination = to;
      this.game.objectManager.addObject(bolt);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Jinx_W;
}
const __cacheJinx_W = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_W>>();
export default function makeJinx_W(api: ContentApi) {
  const cached = __cacheJinx_W.get(api);
  if (cached) return cached;
  const built = __buildJinx_W(api);
  __cacheJinx_W.set(api, built);
  return built;
}


/** How far behind the head the bolt crackles. */
export const BOLT_TAIL = 96;


function __buildJinx_W_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const AoePulse = api.AoePulse;
  const TrailSystem = api.helpers.TrailSystem;
  const AttackableUnit = api.units.AttackableUnit;
  class Jinx_W_Object extends MissileSpellObject {
    speed = 26;
    size = 18;
    maxHitCount = 1;
    /** Fixed at construction so the crackle is this bolt's and not the frame's. */
    seed = Math.random() * Math.PI * 2;

    trailSystem: TrailSystem | null = new TrailSystem({
      trailColor: 'rgba(140, 220, 255, 0.55)',
      trailSize: 7,
      maxLength: 14,
    });

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(DAMAGE, this.owner);
      const slow = new Slow(SLOW_DURATION, this.owner, enemy);
      slow.percent = SLOW_PERCENT;
      enemy.addBuff(slow);

      // A single-target shot with no impact reads as a miss. `fillAlpha = 0` on
      // purpose: this is a spark on one body, not an area, and a filled disc
      // would promise a splash that never happens.
      //
      // `frag` is Jinx's shape across the whole kit — the chunks are small and
      // fast here because it is a hit on one body rather than a bomb, but a
      // player who has learned that tumbling debris means Jinx should not have to
      // relearn it per ability. `shards` said "rock" and belonged to four other
      // champions besides.
      const zap = new AoePulse(this.owner);
      zap.position = enemy.position.copy();
      zap.radius = 70;
      zap.lifeTime = 260;
      zap.color = [170, 240, 255];
      zap.style = 'frag';
      zap.spokes = 9;
      zap.fillAlpha = 0;
      this.game.objectManager.addObject(zap);
    }

    /**
     * Three lines down the axis was a laser pointer. Zap! is a *current*: a
     * jagged core with forks coming off it, and the jag is derived from the
     * bolt's own position so it crawls while the shot travels rather than
     * standing still or reshuffling at random.
     */
    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const crawl = this.position.x * 0.05 + this.position.y * 0.05;
      const kink = (i: number, amount: number) =>
        Math.sin(this.seed + i * 2.3 + crawl) * amount +
        Math.sin(this.seed * 3 + i * 5.1) * amount * 0.4;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // Glow first, so the bolt sits inside a haze rather than on top of the map.
      blendMode(ADD);
      noStroke();
      fill(80, 180, 255, 70);
      ellipse(-BOLT_TAIL * 0.35, 0, BOLT_TAIL * 1.3, 34);
      blendMode(BLEND);

      // Outer discharge, then the white core along the same jag.
      const segments = 7;
      for (const [weight, colour] of [
        [7, [90, 190, 255, 130]],
        [3.5, [190, 240, 255, 220]],
        [1.6, [255, 255, 255, 245]],
      ] as [number, number[]][]) {
        stroke(colour[0], colour[1], colour[2], colour[3]);
        strokeWeight(weight);
        noFill();
        beginShape();
        for (let i = 0; i <= segments; i++) {
          const p = i / segments;
          vertex(14 - BOLT_TAIL * p, kink(i, 11 * p));
        }
        endShape();
      }

      // Forks: short branches off the tail, the thing that makes it read as
      // electricity instead of a streak.
      stroke(200, 245, 255, 190);
      strokeWeight(2);
      for (let i = 1; i < 4; i++) {
        const x = 14 - BOLT_TAIL * (i / 4);
        const y = kink(i * 2, 11 * (i / 4));
        const side = i % 2 === 0 ? 1 : -1;
        line(x, y, x - 16, y + side * (12 + 8 * Math.sin(this.seed + i)));
      }

      // The head: a hot bead with a couple of sparks jumping off it.
      noStroke();
      fill(255, 255, 255, 250);
      circle(14, 0, 13);
      fill(160, 235, 255, 200);
      circle(14, 0, 22);
      stroke(230, 250, 255, 210);
      strokeWeight(2);
      for (let i = 0; i < 3; i++) {
        const a = this.seed + crawl + (i / 3) * Math.PI * 2;
        line(14, 0, 14 + Math.cos(a) * 20, Math.sin(a) * 14);
      }
      pop();
    }

    /**
     * The base box is the 18px hitbox, which is now a fraction of what this
     * paints: the tail alone runs 96 units behind the head, and a box that small
     * culls the whole bolt the moment its head leaves the camera.
     */
    getDisplayBoundingBox() {
      const span = BOLT_TAIL + 30;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Jinx_W_Object;
}
const __cacheJinx_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_W_Object>>();
export function makeJinx_W_Object(api: ContentApi) {
  const cached = __cacheJinx_W_Object.get(api);
  if (cached) return cached;
  const built = __buildJinx_W_Object(api);
  __cacheJinx_W_Object.set(api, built);
  return built;
}