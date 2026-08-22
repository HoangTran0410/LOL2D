import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Pet = InstanceType<ContentApi['units']['Pet']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Jinx_E = InstanceType<ReturnType<typeof makeJinx_E>>;
type Jinx_E_Chomper = InstanceType<ReturnType<typeof makeJinx_E_Chomper>>;



export const MAX_RANGE = 500;

export const COUNT = 3;

export const SPREAD = 70;

export const LAND_TIME_MS = 1000;

export const ARM_TIME_MS = 500;

export const FUSE_MS = 5000;

export const TRIGGER_RADIUS = 60;

export const BLAST_RADIUS = 110;

export const DAMAGE = 18;

export const ROOT_DURATION = 1500;

export const CHOMPER_HEALTH = 10;

/** One chomper per champion, so a champion already bitten walks over the rest. */
export const CHOMPED_STACK_ID = 'jinx_e_chomped';


/**
 * Flame Chompers!
 *
 * Read off `docs/abilities/jinx/e.json` rather than from memory, which is how
 * the first pass got it wrong twice: these are **not stealthed** (they land in
 * plain sight, which is why three of them read as a wall rather than an
 * ambush), and they **do not attack** — a chomper bites once and is gone.
 *
 * What the wiki does say, and what this implements:
 *
 *   - three of them, centred on the point, landing at 0.4s and arming at 0.5s;
 *   - each explodes on contact with an enemy *champion* — minions walk over
 *     them — knocking them down and rooting for 1.5s;
 *   - a champion can only be caught by one chomper, so walking into all three
 *     is one root, not three;
 *   - anything left after 5 seconds explodes anyway, damaging nearby enemies.
 *
 * They are still `Pet`s, and that part is not decoration: a chomper is a body
 * with 20 health that the enemy can shoot off the ground before it ever bites.
 * That is the whole reason the pet system exists — a trap you can answer.
 */
function __buildJinx_E(api: ContentApi) {
  const Spell = api.Spell;
  const Jinx_E_Chomper = makeJinx_E_Chomper(api);
  class Jinx_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_jinx_e');
    name = 'Lựu Đạn Ma Hỏa! (Jinx_E)';
    description =
      `Ném <span>${COUNT} chiếc bẫy</span> xuống vị trí chỉ định. Bẫy <span class="buff">kích hoạt sau</span>` +
      ` <span class="time">${ARM_TIME_MS / 1000} giây</span>: <span class="damage">tướng địch</span> giẫm phải bị` +
      ` <span class="buff">Hất Tung</span> và <span class="buff">Trói Chân</span>` +
      ` <span class="time">${ROOT_DURATION / 1000} giây</span> (mỗi tướng chỉ dính một bẫy).` +
      ` Sau <span class="time">${FUSE_MS / 1000} giây</span> bẫy tự nổ, gây <span class="damage">${DAMAGE} sát thương</span>.` +
      ` Bẫy nằm lộ thiên và <span class="damage">có thể bị phá</span> (${CHOMPER_HEALTH} máu)`;
    coolDown = 10000;
    manaCost = 50;

    maxRange = MAX_RANGE;

    onSpellCast() {
      const aim = this.aimPoint;
      const centre = aim
        .copy()
        .sub(this.owner.position)
        .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
        .add(this.owner.position);

      for (let i = 0; i < COUNT; i++) {
        const angle = (i / COUNT) * Math.PI * 2;
        const chomper = new Jinx_E_Chomper({
          game: this.game,
          position: this.owner.position.copy(),
          teamId: this.owner.teamId,
          ownerUnit: this.owner,
          lifeTimeMs: LAND_TIME_MS + FUSE_MS,
          stationary: true,
          followsOwner: false,
          // Never picks a fight: a chomper bites what steps on it and nothing else.
          aggroRadius: 0,
          preset: {
            name: 'Bẫy Răng Lửa',
            spells: [],
            attack: { damage: 0, attacksPerSecond: 0, range: 0 },
          },
        });
        chomper.landAt = centre.copy().add(Math.cos(angle) * SPREAD, Math.sin(angle) * SPREAD);
        this.game.objectManager.addObject(chomper);
      }
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Jinx_E;
}
const __cacheJinx_E = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_E>>();
export default function makeJinx_E(api: ContentApi) {
  const cached = __cacheJinx_E.get(api);
  if (cached) return cached;
  const built = __buildJinx_E(api);
  __cacheJinx_E.set(api, built);
  return built;
}


function __buildJinx_E_Chomper(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Champion = api.units.Champion;
  const Pet = api.units.Pet;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Root = api.buffs.Root;
  const AoePulse = api.AoePulse;
  class Jinx_E_Chomper extends Pet {
    /** Where it is being thrown; it flies there over `LAND_TIME_MS`. */
    landAt: p5.Vector | null = null;
    armed = false;
    bitten = false;

    constructor(options: ConstructorParameters<typeof Pet>[0]) {
      super(options);
      this.stats.maxHealth.baseValue = CHOMPER_HEALTH;
      this.stats.health.baseValue = CHOMPER_HEALTH;
      this.stats.healthRegen.baseValue = 0;
    }

    update(): void {
      // The throw. Lerped rather than stepped so all three land together
      // whatever the distance, which is what makes them read as one wall.
      if (this.landAt && this.age < LAND_TIME_MS) {
        const t = Math.min(1, (this.age + deltaTime) / LAND_TIME_MS);
        this.position.lerp(this.landAt, t);
      } else if (this.landAt) {
        this.position.set(this.landAt.x, this.landAt.y);
      }

      super.update();
      if (this.toRemove || this.isDead) return;

      if (!this.armed) {
        this.armed = this.age >= LAND_TIME_MS + ARM_TIME_MS;
        return;
      }
      if (this.bitten) return;

      const victim = this.findStandingChampion();
      if (victim) this.bite(victim);
    }

    /**
     * Enemy *champions* only — minions and monsters walk straight over a
     * chomper. `Pet` is a `Champion` subclass, so summons have to be excluded
     * explicitly or a Shaco box would set the whole row off.
     */
    findStandingChampion(): AttackableUnit | null {
      const nearby = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: TRIGGER_RADIUS }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.teamId),
          PredefinedFilters.type(Champion),
          PredefinedFilters.excludeType(Pet),
        ],
      }) as AttackableUnit[];

      for (const candidate of nearby) {
        // Already caught by one of its siblings: three chompers is one root.
        if (candidate.buffs.some(buff => buff.stackId === CHOMPED_STACK_ID && !buff.toRemove)) {
          continue;
        }
        return candidate;
      }
      return null;
    }

    bite(victim: AttackableUnit): void {
      this.bitten = true;

      victim.addBuff(new Airborne(400, this.ownerUnit, victim));
      const root = new Root(ROOT_DURATION, this.ownerUnit, victim);
      root.stackId = CHOMPED_STACK_ID;
      victim.addBuff(root);

      this.detonate();
    }

    /** The blast, whether a champion set it off or the fuse ran out. */
    detonate(): void {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: BLAST_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      });
      enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE, this.ownerUnit));

      // Frag, the shape shared by Jinx's whole kit: hard chunks of casing thrown
      // out through rolling smoke. `shards` was rock splinters and was doing duty
      // for four other champions at once — a chomper going off is an *explosive*,
      // and it has to look like the rocket and the zap it comes packaged with.
      const snap = new AoePulse(this.ownerUnit);
      snap.position = this.position.copy();
      snap.radius = BLAST_RADIUS;
      snap.lifeTime = 380;
      snap.color = [255, 140, 60];
      snap.style = 'frag';
      snap.spokes = 10;
      this.game.objectManager.addObject(snap);

      // Spent. The blast animation gets a beat before the body is retired.
      this.lifeTimeMs = Math.min(this.lifeTimeMs, this.age + 250);
    }

    /** The 5-second fuse. `Pet.expire` runs this however the life ended. */
    onExpire(): void {
      if (!this.bitten) this.detonate();
    }

    /**
     * Mid-throw the body is painted lifted off the ground, and the health bar,
     * buff row and lifetime bar stay pinned where the body physically is — so
     * the toss came out as a chomper flying above its own detached UI. Nothing
     * is shooting a chomper in the 0.4 seconds it is in the air.
     */
    draw(): void {
      if (this.landAt && this.age < LAND_TIME_MS) {
        this.drawAvatar();
        return;
      }
      super.draw();
    }

    drawAvatar(): void {
      // Lobbed, not slid. The position lerp already carries it to the landing
      // point; this is the half of a throw the position cannot express — height,
      // spin, and the shadow that says where it is coming down.
      const flight = constrain(this.age / LAND_TIME_MS, 0, 1);
      const lift = this.landAt ? Math.sin(flight * PI) * 44 : 0;
      const spin = flight < 1 ? flight * PI * 2.5 : 0;
      const chew = this.bitten
        ? Math.abs(Math.sin(this.age / 55))
        : this.armed
          ? Math.abs(Math.sin(this.age / 380)) * 0.55
          : 0;
      // The fuse, as a ring that closes — three of these on the ground is the
      // whole read of the ability, so it has to be legible at a glance.
      const left = this.remainingMs / this.lifeTimeMs;
      const urgent = left < 0.2;
      const pulse = 0.55 + 0.45 * Math.sin(this.age / (urgent ? 70 : 200));

      push();
      translate(this.position.x, this.position.y);

      noStroke();
      fill(0, 0, 0, 95 - lift);
      ellipse(0, 7, 32 - lift * 0.16, 13 - lift * 0.06);

      translate(0, -lift);

      // Armed and waiting: a low glow, so a chomper in grass is a thing you can
      // still spot. They are not stealthed — the wiki is explicit — and a trap
      // the enemy is meant to see has to actually be seeable.
      if (this.armed && !this.bitten) {
        blendMode(ADD);
        fill(255, 80, 140, 70 * pulse);
        circle(0, 0, 62);
        blendMode(BLEND);
      }

      push();
      rotate(spin);

      // Body: green shell, darker jaw.
      noStroke();
      fill(62, 138, 100);
      circle(0, 0, 34);
      fill(40, 100, 74);
      arc(0, 0, 34, 34, 0, PI, CHORD);
      // Rivets around the rim, so it reads as hardware and not a blob.
      fill(226, 232, 224, 200);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI + PI / 12;
        circle(cos(a) * 14, sin(a) * 14, 3.2);
      }

      // The mouth, opening as it chews.
      const gap = 3 + chew * 9;
      fill(16, 9, 15);
      rect(-15, -gap, 30, gap * 2, 3);
      fill(252, 248, 242);
      for (let i = 0; i < 4; i++) {
        const x = -13.5 + i * 7.5;
        triangle(x, -gap, x + 5.5, -gap, x + 2.75, -gap + 6.5);
        triangle(x + 2, gap, x + 7.5, gap, x + 4.75, gap - 6.5);
      }

      // Eyes: dead until it arms, then lit.
      fill(this.armed ? 255 : 90, this.armed ? 90 : 70, this.armed ? 160 : 90, 180 + 70 * pulse);
      circle(-7, -12, 6.5);
      circle(7, -12, 6.5);
      pop();

      // Fuse: a dim track with the remaining arc burning down it.
      noFill();
      stroke(60, 40, 30, 150);
      strokeWeight(3);
      circle(0, 0, 42);
      stroke(255, urgent ? 70 : 170, urgent ? 60 : 80, 180 + 70 * pulse);
      strokeWeight(3);
      arc(0, 0, 42, 42, -HALF_PI, -HALF_PI + TWO_PI * left);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(BLAST_RADIUS * 2);
    }
  }
  return Jinx_E_Chomper;
}
const __cacheJinx_E_Chomper = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_E_Chomper>>();
export function makeJinx_E_Chomper(api: ContentApi) {
  const cached = __cacheJinx_E_Chomper.get(api);
  if (cached) return cached;
  const built = __buildJinx_E_Chomper(api);
  __cacheJinx_E_Chomper.set(api, built);
  return built;
}