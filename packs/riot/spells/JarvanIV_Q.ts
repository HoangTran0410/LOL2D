import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type JarvanIV_Q = InstanceType<ReturnType<typeof makeJarvanIV_Q>>;
type JarvanIV_Q_ChargeObject = InstanceType<ReturnType<typeof makeJarvanIV_Q_ChargeObject>>;
type JarvanIV_Q_Object = InstanceType<ReturnType<typeof makeJarvanIV_Q_Object>>;



export const JARVAN_Q_DAMAGE = 25;

export const JARVAN_Q_KNOCKUP_MS = 750;

export const JARVAN_Q_DASH_HIT_RADIUS = 90;

/** How close the spear line has to pass a flag for the combo to latch. */
export const JARVAN_Q_FLAG_SNAP = 60;


function __buildJarvanIV_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Airborne = api.buffs.Airborne;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const CollideUtils = api.utils.CollideUtils;
  const Circle = api.utils.Quadtree.Circle;
  const JarvanIV_Q_Object = makeJarvanIV_Q_Object(api);
  const JarvanIV_Q_ChargeObject = makeJarvanIV_Q_ChargeObject(api);
  class JarvanIV_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_jarvaniv_q');
    name = 'Giáng Long Kích (JarvanIV_Q)';
    description =
      'Đâm giáo theo hướng chỉ định gây <span class="damage">25 sát thương</span>. Nếu giáo chạm vào <span class="buff">Hoàng Kim Kỳ (E)</span>, Jarvan IV sẽ <span class="buff">Lướt</span> tới lá cờ và <span class="buff">Hất Tung</span> kẻ địch trên đường lướt.';
    coolDown = 8000;
    manaCost = 45;
    range = 450;

    onSpellCast() {
      const { from, to: qEndPos } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      // Search for active Demacian Standard (E) near Q line
      const standards = this.game.objectManager.queryObjects({
        queryByDisplayBoundingBox: true,
        filters: [
          (o: any) =>
            o.isDemacianStandard &&
            o.owner === this.owner &&
            !o.toRemove &&
            CollideUtils.lineCircle(
              from.x,
              from.y,
              qEndPos.x,
              qEndPos.y,
              o.position.x,
              o.position.y,
              JARVAN_Q_FLAG_SNAP
            ),
        ],
      });

      if (standards.length > 0) {
        const targetFlag = standards[0];
        const flagPos = targetFlag.position.copy();

        // The spear is thrown FIRST and the drag only begins when its tip actually
        // reaches the standard. The combo used to teleport straight into the dash
        // on the frame of the press, so the two halves that give it its name — the
        // spear, and the flag answering it — were never shown; it just looked like
        // Jarvan deciding to run. `onReachedFlag` is the beat between them.
        const spear = new JarvanIV_Q_Object(this.owner);
        spear.position = from;
        spear.destination = flagPos.copy();
        spear.onReachedFlag = () => {
          targetFlag.onCharged?.();
          this.beginCharge(flagPos.copy());
        };
        this.game.objectManager.addObject(spear);
        return;
      }

      // Standard Q spear thrust with extending animation
      const obj = new JarvanIV_Q_Object(this.owner);
      obj.position = from;
      obj.destination = qEndPos;
      this.game.objectManager.addObject(obj);
    }

    /** The drag itself, once the spear has connected with the standard. */
    beginCharge(flagPos: p5.Vector) {
      const hitTargets = new Set<any>();

      const charge = new JarvanIV_Q_ChargeObject(this.owner, flagPos.copy());
      this.game.objectManager.addObject(charge);

      // Perform fast, smooth EQ Combo Dash
      const dashBuff = new Dash(1000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = flagPos;
      dashBuff.dashSpeed = 24;
      dashBuff.onDashUpdate = () => {
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.owner.position.x,
            y: this.owner.position.y,
            r: JARVAN_Q_DASH_HIT_RADIUS,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        for (const enemy of enemies) {
          if (
            !hitTargets.has(enemy) &&
            this.owner.position.dist(enemy.position) < JARVAN_Q_DASH_HIT_RADIUS
          ) {
            hitTargets.add(enemy);
            enemy.takeDamage(JARVAN_Q_DAMAGE, this.owner);
            enemy.addBuff(new Airborne(JARVAN_Q_KNOCKUP_MS, this.owner, enemy));
            charge.impactAt(enemy.position.x, enemy.position.y);
          }
        }
      };
      dashBuff.onReachedDestination = () => charge.endCharge();
      dashBuff.onDeactivate = () => charge.endCharge();
      this.owner.addBuff(dashBuff);
    }
  }
  return JarvanIV_Q;
}
const __cacheJarvanIV_Q = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_Q>>();
export default function makeJarvanIV_Q(api: ContentApi) {
  const cached = __cacheJarvanIV_Q.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_Q(api);
  __cacheJarvanIV_Q.set(api, built);
  return built;
}


/**
 * The spear thrust.
 *
 * A thrust is a lunge and a recovery, not a beam that switches off: the shaft
 * drives out over 150ms and is pulled back in over the rest, which is what makes
 * it read as a weapon rather than a laser. Damage still lands once, at full
 * extension, and the tip is where it lands — so the recovery is honest.
 */
function __buildJarvanIV_Q_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const CollideUtils = api.utils.CollideUtils;
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class JarvanIV_Q_Object extends SpellObject {
    lifeTime = 420;
    extendMs = 150;
    holdMs = 60;
    timer = 0;
    hasStruck = false;
    /** 0 at the shoulder, 1 at full reach. */
    progress = 0;
    /** Fired once when the tip arrives — the beat the EQ drag waits on. */
    onReachedFlag: (() => void) | null = null;
    _calledFlag = false;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#ffaa00');

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    update() {
      this.timer += deltaTime;

      if (this.timer <= this.extendMs) {
        // ease-out on the way out: the thrust is fastest at the start
        const k = constrain(this.timer / this.extendMs, 0, 1);
        this.progress = 1 - (1 - k) * (1 - k);
      } else if (this.timer <= this.extendMs + this.holdMs) {
        this.progress = 1;
      } else {
        // ease-in on the retract: he pulls it back under control
        const k = constrain(
          (this.timer - this.extendMs - this.holdMs) / (this.lifeTime - this.extendMs - this.holdMs),
          0,
          1
        );
        this.progress = 1 - k * k;
      }

      // full extension is the moment the tip is on the flag
      if (!this._calledFlag && this.timer >= this.extendMs) {
        this._calledFlag = true;
        this.onReachedFlag?.();
      }

      if (!this.hasStruck && this.timer >= this.extendMs) {
        this.hasStruck = true;
        const tip = this.tipAt(1);
        const midX = (this.position.x + tip.x) / 2;
        const midY = (this.position.y + tip.y) / 2;
        const reach = Math.hypot(tip.x - this.position.x, tip.y - this.position.y);
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({ x: midX, y: midY, r: reach / 2 + 60 }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        for (const enemy of enemies) {
          if (
            CollideUtils.lineCircle(
              this.position.x,
              this.position.y,
              tip.x,
              tip.y,
              enemy.position.x,
              enemy.position.y,
              40
            )
          ) {
            enemy.takeDamage(JARVAN_Q_DAMAGE, this.owner);
            for (let i = 0; i < 6; i++) {
              this.particleSystem.addParticle({
                x: enemy.position.x + random(-14, 14),
                y: enemy.position.y + random(-14, 14),
                r: random(7, 14),
              });
            }
          }
        }
      }

      if (this.timer >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    tipAt(progress: number) {
      return {
        x: lerp(this.position.x, this.destination.x, progress),
        y: lerp(this.position.y, this.destination.y, progress),
      };
    }

    draw() {
      const tip = this.tipAt(this.progress);
      const heading = Math.atan2(tip.y - this.position.y, tip.x - this.position.x);
      // brightest at full extension, dimming through the recovery
      const heat = this.timer <= this.extendMs + this.holdMs ? 1 : this.progress;

      push();
      // Outer golden-red dragon aura glow
      stroke(255, 140, 0, 160 * heat);
      strokeWeight(22);
      line(this.position.x, this.position.y, tip.x, tip.y);

      // Inner bright golden spear core
      stroke(255, 215, 0, 240 * heat);
      strokeWeight(12);
      line(this.position.x, this.position.y, tip.x, tip.y);
      stroke(255, 255, 255, 250 * heat);
      strokeWeight(4);
      line(this.position.x, this.position.y, tip.x, tip.y);

      translate(tip.x, tip.y);
      rotate(heading);

      // the head: a lance point, and a dragon maw flaring around it at full reach
      noStroke();
      fill(255, 245, 210, 250 * heat);
      triangle(30, 0, -14, -11, -14, 11);
      fill(255, 170, 40, 220 * heat);
      triangle(20, 0, -8, -6, -8, 6);

      noFill();
      stroke(255, 200, 50, 220 * heat);
      strokeWeight(4);
      arc(0, 0, 40, 60, -HALF_PI, HALF_PI);
      // jaw wisps, widest at full extension
      stroke(255, 150, 40, 180 * heat);
      strokeWeight(3);
      const flare = 12 + 16 * this.progress;
      arc(-8, 0, 30, 60 + flare, -HALF_PI - 0.5, -HALF_PI + 0.2);
      arc(-8, 0, 30, 60 + flare, HALF_PI - 0.2, HALF_PI + 0.5);
      pop();
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.position.x, this.destination.x) - 40;
      const minY = Math.min(this.position.y, this.destination.y) - 40;
      const maxX = Math.max(this.position.x, this.destination.x) + 40;
      const maxY = Math.max(this.position.y, this.destination.y) + 40;
      return new Rectangle({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, data: this });
    }
  }
  return JarvanIV_Q_Object;
}
const __cacheJarvanIV_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_Q_Object>>();
export function makeJarvanIV_Q_Object(api: ContentApi) {
  const cached = __cacheJarvanIV_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_Q_Object(api);
  __cacheJarvanIV_Q_Object.set(api, built);
  return built;
}


interface ChargeImpact {
  x: number;
  y: number;
  age: number;
}


/**
 * The EQ charge.
 *
 * The signature combo of the champion, and it used to play with no art at all —
 * the same silhouette as walking. He now drags a banner-coloured wake behind
 * him and every body he knocks up gets its own burst, so the line he cut through
 * the fight is readable after the fact.
 */
function __buildJarvanIV_Q_ChargeObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const TrailSystem = api.helpers.TrailSystem;
  class JarvanIV_Q_ChargeObject extends SpellObject {
    target: p5.Vector;
    charging = true;
    fade = 1;
    impacts: ChargeImpact[] = [];

    trailSystem: TrailSystem;

    constructor(owner: any, target: p5.Vector) {
      super(owner);
      this.target = target;
      this.trailSystem = new TrailSystem({
        owner,
        maxLength: 16,
        trailColor: '#ffcc4dcc',
        trailSize: 13,
        trailLifeTime: 280,
      });
    }

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
    }

    impactAt(x: number, y: number) {
      this.impacts.push({ x, y, age: 0 });
    }

    endCharge() {
      this.charging = false;
    }

    update() {
      if (this.charging) {
        if (!this.owner || this.owner.toRemove) {
          this.charging = false;
        } else {
          this.position.set(this.owner.position.x, this.owner.position.y);
          this.trailSystem.addTrail(this.owner.position);
        }
      } else {
        this.fade -= deltaTime / 280;
      }

      let write = 0;
      for (let i = 0; i < this.impacts.length; i++) {
        this.impacts[i].age += deltaTime;
        if (this.impacts[i].age < 340) this.impacts[write++] = this.impacts[i];
      }
      this.impacts.length = write;

      if (!this.charging && this.fade <= 0 && this.impacts.length === 0) this.toRemove = true;
    }

    draw() {
      if (this.charging && this.owner) {
        push();
        translate(this.position.x, this.position.y);
        const heading = Math.atan2(this.target.y - this.position.y, this.target.x - this.position.x);
        rotate(heading);
        // lance held out ahead of the charge
        stroke(255, 200, 60, 200);
        strokeWeight(9);
        line(-6, 0, 46, 0);
        stroke(255, 250, 220, 235);
        strokeWeight(4);
        line(-6, 0, 46, 0);
        noStroke();
        fill(255, 245, 200, 245);
        triangle(58, 0, 40, -9, 40, 9);
        // dust cone kicked up behind him
        fill(210, 170, 90, 90);
        triangle(-16, 0, -44, -20, -44, 20);
        pop();
      }

      // knockup bursts, left behind on the bodies he threw
      for (const impact of this.impacts) {
        const t = constrain(impact.age / 340, 0, 1);
        const fade = 1 - t;
        push();
        translate(impact.x, impact.y);
        noFill();
        stroke(255, 220, 120, 230 * fade);
        strokeWeight(5 * fade + 1);
        circle(0, 0, 26 + 62 * t);
        // upward chevrons: the unit went up, not out
        stroke(255, 245, 210, 240 * fade);
        strokeWeight(3);
        for (let i = -1; i <= 1; i++) {
          const x = i * 16;
          const y = -18 - 26 * t;
          line(x - 8, y + 9, x, y);
          line(x, y, x + 8, y + 9);
        }
        pop();
      }
    }

    getDisplayBoundingBox() {
      let minX = Math.min(this.position.x, this.target.x);
      let minY = Math.min(this.position.y, this.target.y);
      let maxX = Math.max(this.position.x, this.target.x);
      let maxY = Math.max(this.position.y, this.target.y);
      for (const impact of this.impacts) {
        minX = Math.min(minX, impact.x);
        minY = Math.min(minY, impact.y);
        maxX = Math.max(maxX, impact.x);
        maxY = Math.max(maxY, impact.y);
      }
      return new Rectangle({
        x: minX - 70,
        y: minY - 70,
        w: maxX - minX + 140,
        h: maxY - minY + 140,
        data: this,
      });
    }
  }
  return JarvanIV_Q_ChargeObject;
}
const __cacheJarvanIV_Q_ChargeObject = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_Q_ChargeObject>>();
export function makeJarvanIV_Q_ChargeObject(api: ContentApi) {
  const cached = __cacheJarvanIV_Q_ChargeObject.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_Q_ChargeObject(api);
  __cacheJarvanIV_Q_ChargeObject.set(api, built);
  return built;
}