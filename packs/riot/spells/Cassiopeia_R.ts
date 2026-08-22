import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Cassiopeia_R = InstanceType<ReturnType<typeof makeCassiopeia_R>>;
type Cassiopeia_R_Cone = InstanceType<ReturnType<typeof makeCassiopeia_R_Cone>>;



export const REACH = 420;

export const HALF_ANGLE = 0.6;

export const DAMAGE = 40;

export const STUN_DURATION = 1400;

export const SLOW_DURATION = 2000;

export const SLOW_PERCENT = 0.5;

/** How long the gaze takes to travel from her eyes to the far edge of the cone. */
export const SWEEP_DURATION = 420;

/** The wedge outlives the wave: stone dust hangs after the front has gone. */
export const CONE_LIFETIME = 780;

/** Chips of stone crystallising in the ground the gaze has already crossed. */
const CHIP_COUNT = 22;

/** How long a petrification burst lives at the spot a victim was caught. */
const MARK_LIFETIME = 340;


/**
 * Petrifying Gaze. A cone, not a circle: it only catches what is in front of
 * her, so turning the corner on Cassiopeia is the counterplay. (League's
 * facing check has no analogue here — every unit's facing is its heading, not
 * a thing the player aims — so the cone itself is the whole condition.)
 *
 * The gaze *sweeps*. Everything in the wedge used to be stunned on the frame of
 * the cast while three rings raced down it for another half second as pure
 * decoration, so someone standing at the far edge was already petrified before
 * the wave had covered a third of the distance to them. The wave front is now
 * the thing that hits: it leaves her eyes, crosses the cone in
 * `SWEEP_DURATION`, and catches each victim at the moment it reaches them.
 */
function __buildCassiopeia_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Cassiopeia_R_Cone = makeCassiopeia_R_Cone(api);
  class Cassiopeia_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_cassiopeia_r');
    name = 'Cái Nhìn Hóa Đá (Cassiopeia_R)';
    description =
      `Quét một hình nón <span>${REACH}px</span> theo hướng chỉ định trong` +
      ` <span class="time">${SWEEP_DURATION / 1000} giây</span>: <span class="damage">${DAMAGE} sát thương</span>,` +
      ` <span class="buff">Choáng</span> trong <span class="time">${STUN_DURATION / 1000} giây</span>` +
      ` và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span> sau đó, <i>khi làn sóng chạm tới từng mục tiêu</i>`;
    coolDown = 10000;
    manaCost = 80;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, REACH);
      const heading = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);

      // The cone does the hitting. It is anchored where she cast it rather than to
      // her body: a wave that has left her eyes does not follow her backwards.
      const gaze = new Cassiopeia_R_Cone(this.owner);
      gaze.heading = heading;
      gaze.position = this.owner.position.copy();
      this.game.objectManager.addObject(gaze);
    }

    drawPreview() {
      super.drawPreview(REACH);
    }
  }
  return Cassiopeia_R;
}
const __cacheCassiopeia_R = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_R>>();
export default function makeCassiopeia_R(api: ContentApi) {
  const cached = __cacheCassiopeia_R.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_R(api);
  __cacheCassiopeia_R.set(api, built);
  return built;
}


interface PetrifyMark {
  x: number;
  y: number;
  age: number;
}


/**
 * The wave. Its own class rather than a plain `AoePulse`, because a wedge is not
 * a circle and because this one is not cosmetic — `_sweep()` is where the
 * ultimate's damage and stun actually come from.
 */
function __buildCassiopeia_R_Cone(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AoePulse = api.AoePulse;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const Stun = api.buffs.Stun;
  class Cassiopeia_R_Cone extends AoePulse {
    heading = 0;
    radius = REACH;
    lifeTime = CONE_LIFETIME;
    visionRadius = REACH;

    /** Petrified already — one victim, one hit, however long the front lingers. */
    _petrified: AttackableUnit[] = [];
    /** World-space spots the wave caught somebody, for the burst drawn there. */
    _marks: PetrifyMark[] = [];

    /**
     * How far the front has travelled. Eased out: the gaze snaps open and then
     * settles, which is what makes the far edge of a 420px cone survivable.
     * Both the hit test and the drawing read this one expression, so the bright
     * arc on screen *is* the line that petrifies.
     */
    get front(): number {
      const t = Math.min(1, this.age / SWEEP_DURATION);
      return REACH * t * (2 - t);
    }

    update() {
      super.update();
      // The wave only hits while it is moving. Without this, someone who walked
      // into the swept ground a quarter second later would be petrified by a
      // front that had already passed the far edge.
      if (this.age <= SWEEP_DURATION) this._sweep();
      for (const mark of this._marks) mark.age += deltaTime;
    }

    _sweep() {
      const front = this.front;
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: REACH }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        // Checked here rather than through excludeObjects: the local list is what
        // guarantees once-per-unit whatever the query does.
        if (this._petrified.includes(enemy)) continue;

        const dx = enemy.position.x - this.position.x;
        const dy = enemy.position.y - this.position.y;
        const body = enemy.collisionRadius ?? 0;
        const distance = Math.hypot(dx, dy);
        if (distance - body > front) continue; // the front has not reached them yet
        if (distance - body > REACH) continue;

        let delta = Math.abs(Math.atan2(dy, dx) - this.heading) % (Math.PI * 2);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (delta > HALF_ANGLE) continue;

        this._petrified.push(enemy);
        enemy.takeDamage(DAMAGE, this.owner);
        enemy.addBuff(new Stun(STUN_DURATION, this.owner, enemy));
        const slow = new Slow(SLOW_DURATION, this.owner, enemy);
        slow.percent = SLOW_PERCENT;
        enemy.addBuff(slow);

        this._marks.push({ x: enemy.position.x, y: enemy.position.y, age: 0 });
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const sweep = constrain(this.age / SWEEP_DURATION, 0, 1);
      const fade = 1 - t;
      // 1 while the wave is travelling, 0 once it has spent itself on the far edge
      const live = 1 - sweep;
      const front = Math.max(this.front, 1);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      // The ground the gaze has already crossed stays lit, so after the flash a
      // player can still see exactly how far the cone reached and who was in it.
      noStroke();
      fill(198, 178, 216, 42 * fade);
      arc(0, 0, front * 2, front * 2, -HALF_ANGLE, HALF_ANGLE, PIE);
      // violet heat riding just behind the front, brightest while it is moving
      fill(186, 126, 236, 60 * live * fade + 14 * fade);
      arc(0, 0, front * 2, front * 2, -HALF_ANGLE * 0.8, HALF_ANGLE * 0.8, PIE);

      // The wave front, with two echoes lagging behind it. This is the line that
      // does the petrifying, so it is the brightest thing on screen.
      noFill();
      for (let i = 1; i <= 2; i++) {
        const echo = front - i * REACH * 0.075;
        if (echo <= 0) continue;
        stroke(226, 206, 255, (150 - i * 45) * fade);
        strokeWeight((6 - i * 2) * fade + 1);
        arc(0, 0, echo * 2, echo * 2, -HALF_ANGLE, HALF_ANGLE);
      }
      stroke(252, 246, 255, 230 * live + 45 * fade);
      strokeWeight(4 * live + 1.5);
      arc(0, 0, front * 2, front * 2, -HALF_ANGLE, HALF_ANGLE);

      // The wedge is bounded by two snakes, not two rays: each edge slithers, and
      // the ripple runs outward with the front rather than sitting still.
      strokeWeight(2.5 * fade + 1);
      for (const side of [-1, 1]) {
        stroke(138, 232, 140, 200 * fade);
        beginShape();
        for (let k = 0; k <= 14; k++) {
          const p = k / 14;
          const wobble = sin(p * PI * 3 - this.age / 55) * 0.045 * (1 - p * 0.35);
          const angle = side * HALF_ANGLE + wobble;
          const r = front * p;
          vertex(cos(angle) * r, sin(angle) * r);
        }
        endShape();
      }

      // Chips of stone crystallising in the swept ground, each one growing only
      // once the front has gone past it — the petrification made visible.
      noStroke();
      for (let i = 0; i < CHIP_COUNT; i++) {
        const angle = HALF_ANGLE * Math.sin(this.seed + i * 2.3) * 0.92;
        const distance = REACH * (0.12 + 0.82 * Math.abs(Math.sin(this.seed + i * 3.7)));
        const risen = constrain((front - distance) / 70, 0, 1);
        if (risen <= 0) continue;
        const chip = (5 + 7 * Math.abs(Math.sin(this.seed + i))) * risen;
        push();
        translate(cos(angle) * distance, sin(angle) * distance);
        rotate(angle + this.seed + i);
        fill(206, 192, 220, 235 * fade * risen);
        quad(-chip * 0.5, 0, -chip * 0.2, -chip, chip * 0.35, -chip * 0.8, chip * 0.5, 0);
        pop();
      }

      // Her eyes at the mouth of the cone: the source of the wave, and a hard
      // flash on the first two frames so the cast has a start, not just a spread.
      const spark = 1 - constrain(this.age / 150, 0, 1);
      fill(240, 220, 255, 220 * fade);
      ellipse(6, -7, 12 + 8 * spark, 8 + 6 * spark);
      ellipse(6, 7, 12 + 8 * spark, 8 + 6 * spark);
      if (spark > 0) {
        fill(255, 255, 255, 200 * spark);
        circle(0, 0, 70 * spark);
      }
      pop();

      // Where the wave actually caught somebody: a stone burst in world space, so
      // the ability's damage has a visible cause at the exact spot it happened.
      push();
      noFill();
      for (const mark of this._marks) {
        const m = constrain(mark.age / MARK_LIFETIME, 0, 1);
        if (m >= 1) continue;
        const out = 1 - m;
        stroke(238, 228, 250, 235 * out);
        strokeWeight(5 * out + 1);
        circle(mark.x, mark.y, 26 + 52 * m);
        stroke(176, 120, 226, 200 * out);
        strokeWeight(2);
        for (let i = 0; i < 6; i++) {
          const a = this.seed + (TWO_PI * i) / 6;
          const inner = 12 + 20 * m;
          const outer = inner + 14 * out;
          line(
            mark.x + cos(a) * inner,
            mark.y + sin(a) * inner,
            mark.x + cos(a) * outer,
            mark.y + sin(a) * outer
          );
        }
      }
      pop();
    }
  }
  return Cassiopeia_R_Cone;
}
const __cacheCassiopeia_R_Cone = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_R_Cone>>();
export function makeCassiopeia_R_Cone(api: ContentApi) {
  const cached = __cacheCassiopeia_R_Cone.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_R_Cone(api);
  __cacheCassiopeia_R_Cone.set(api, built);
  return built;
}