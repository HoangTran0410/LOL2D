import { Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import Pet from '@/game/gameObject/attackableUnits/Pet';
import { PredefinedParticleSystems } from '@/game/gameObject/helpers/ParticleSystem';

// Exported so the suite asserts the swarm's wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const CAST_RANGE = 450;
export const VOIDLING_COUNT = 2;
/** The rift has to tear open before anything climbs out of it. */
export const SPAWN_DELAY_MS = 500;
export const SPAWN_STAGGER_MS = 350;
export const VOIDLING_LIFETIME_MS = 12_000;
export const VOIDLING_HEALTH = 25;
export const VOIDLING_DAMAGE = 5;
export const VOIDLING_ATTACKS_PER_SECOND = 1.2;
export const VOIDLING_ATTACK_RANGE = 120;
export const VOIDLING_AGGRO_RADIUS = 380;
/** How long a voidling spends hauling itself out of the ground. */
export const EMERGE_MS = 320;
export const COOLDOWN_MS = 8_000;
export const MANA_COST = 50;

const VOID_DEEP: [number, number, number] = [38, 12, 58];
const VOID_SHELL: [number, number, number] = [96, 48, 150];
const VOID_EYE: [number, number, number] = [206, 255, 140];

/**
 * Bầy Bọ Hư Không. Two voidlings claw their way out of the ground and fight
 * for him until they are killed or their twelve seconds run out.
 *
 * Built on `Pet`, which is what makes a summon interesting here: a voidling is
 * a real body with 25 health, so the enemy can kill it, and it soaks the
 * skillshot that was meant for Malzahar. `Pet` already declares
 * `killCredit = 'none'` — necessary because `Pet extends Champion`, so without
 * it every voidling killed would land on somebody's KDA — and this subclass
 * inherits it rather than restating it.
 */
export default class Malzahar_W extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_malzahar_w');
  name = 'Bầy Bọ Hư Không (Malzahar_W)';
  description =
    `Xé một khe nứt Hư Không, triệu hồi <span class="buff">${VOIDLING_COUNT} Bọ Hư Không</span>` +
    ` sống <span class="time">${VOIDLING_LIFETIME_MS / 1000} giây</span>. Mỗi con có` +
    ` <span class="buff">${VOIDLING_HEALTH} máu</span> và cắn` +
    ` <span class="damage">${VOIDLING_DAMAGE} sát thương</span> mỗi đòn — có thể bị tiêu diệt`;
  coolDown = COOLDOWN_MS;
  manaCost = MANA_COST;

  range = CAST_RANGE;

  onSpellCast(): void {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.aimPoint,
      CAST_RANGE
    );

    const rift = new Malzahar_W_Rift(this.owner);
    rift.position.set(to.x, to.y);
    this.game.objectManager.addObject(rift);
  }
}

/**
 * The tear in the ground the swarm comes out of. Ground art, so `zIndex = 2`:
 * a `SpellObject` subclass otherwise falls through to `DEFAULT_Z_INDEX` (99)
 * and paints over the feet of everything standing on it.
 */
export class Malzahar_W_Rift extends SpellObject {
  zIndex = 2;
  age = 0;
  spawned = 0;

  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
    'rgba(120, 60, 190, 0.6)',
    0.4
  );

  onAdded(): void {
    // Nothing is emitted until 500ms in; an auto-removing system would already
    // have deleted itself by then.
    this.useParticles(this.particleSystem);
  }

  update(): void {
    this.age += deltaTime;

    while (
      this.spawned < VOIDLING_COUNT &&
      this.age >= SPAWN_DELAY_MS + this.spawned * SPAWN_STAGGER_MS
    ) {
      this.hatch(this.spawned);
      this.spawned++;
    }

    if (this.age >= SPAWN_DELAY_MS + VOIDLING_COUNT * SPAWN_STAGGER_MS + 300) {
      this.toRemove = true;
    }
  }

  hatch(index: number): void {
    // Fanned around the tear rather than stacked, so two voidlings do not spend
    // their first second shoving each other apart.
    const angle = (index / VOIDLING_COUNT) * TWO_PI + this.age / 900;
    const voidling = new Malzahar_W_Voidling({
      game: this.game,
      position: createVector(this.position.x + cos(angle) * 26, this.position.y + sin(angle) * 26),
      teamId: this.owner.teamId,
      ownerUnit: this.owner,
      lifeTimeMs: VOIDLING_LIFETIME_MS,
      aggroRadius: VOIDLING_AGGRO_RADIUS,
      preset: {
        name: 'Bọ Hư Không',
        spells: [],
        attack: {
          damage: VOIDLING_DAMAGE,
          attacksPerSecond: VOIDLING_ATTACKS_PER_SECOND,
          range: VOIDLING_ATTACK_RANGE,
        },
      },
    });
    this.game.objectManager.addObject(voidling);

    for (let i = 0; i < 10; i++) {
      this.particleSystem.addParticle({
        x: voidling.position.x + random(-14, 14),
        y: voidling.position.y + random(-14, 14),
        r: random(3, 8),
      });
    }
  }

  draw(): void {
    // A tear that widens as the swarm works at it from the other side.
    const open = constrain(this.age / SPAWN_DELAY_MS, 0, 1);
    const grown = 1 - (1 - open) * (1 - open);
    const closing = constrain(
      1 - (this.age - (SPAWN_DELAY_MS + VOIDLING_COUNT * SPAWN_STAGGER_MS)) / 300,
      0,
      1
    );
    const scale = grown * closing;
    const [dr, dg, db] = VOID_DEEP;
    const [sr, sg, sb] = VOID_SHELL;

    push();
    translate(this.position.x, this.position.y);

    noStroke();
    fill(dr, dg, db, 200 * scale);
    ellipse(0, 0, 92 * scale, 46 * scale);

    // ragged edges, five splits, leaning off the same clock as the widening
    stroke(sr, sg, sb, 220 * scale);
    strokeWeight(3);
    noFill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TWO_PI + this.age / 1400;
      const reach = 46 * scale * (0.7 + 0.3 * sin(this.age / 200 + i));
      line(cos(a) * 12 * scale, sin(a) * 6 * scale, cos(a) * reach, sin(a) * reach * 0.5);
    }

    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    const r = 70;
    return this.squareDisplayBoundingBox(r * 2);
  }
}

/**
 * One voidling. Everything about fighting, dying and leashing is `Pet`'s; this
 * only supplies the body, because a summon that borrowed another champion's
 * artwork would break the first rule in `docs/VFX_STANDARD.md`.
 */
export class Malzahar_W_Voidling extends Pet {
  /** Counts up from spawn: it hauls itself out rather than popping into place. */
  emergeMs = 0;

  constructor(options: ConstructorParameters<typeof Pet>[0]) {
    super(options);
    this.stats.maxHealth.baseValue = VOIDLING_HEALTH;
    this.stats.health.baseValue = VOIDLING_HEALTH;
  }

  update(): void {
    super.update();
    if (this.toRemove || this.isDead) return;
    if (this.emergeMs < EMERGE_MS) this.emergeMs += deltaTime;
  }

  drawAvatar(): void {
    // Wind-in easing: it comes up out of the floor, squashed, and unfolds.
    const t = constrain(this.emergeMs / EMERGE_MS, 0, 1);
    const rise = t * t;
    const body = 26 * (0.4 + 0.6 * rise);
    const walk = sin(this.age / 110);
    const [dr, dg, db] = VOID_DEEP;
    const [sr, sg, sb] = VOID_SHELL;
    const [er, eg, eb] = VOID_EYE;

    push();
    translate(this.position.x, this.position.y + (1 - rise) * 10);

    // the shadow it is still half inside of
    noStroke();
    fill(dr, dg, db, 130);
    ellipse(0, body * 0.5, body * 1.5, body * 0.5);

    // six scuttling legs, alternating with the walk cycle
    stroke(sr, sg, sb, 235);
    strokeWeight(2.5);
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const along = ((i % 3) - 1) * body * 0.42;
      const kick = walk * side * (3 + (i % 3));
      line(along, 0, along + kick, side * body * 0.75 * rise);
    }

    // carapace: a wedge, not a ball — it should read as vermin at a glance
    stroke(dr, dg, db, 245);
    strokeWeight(2);
    fill(sr, sg, sb, 240);
    beginShape();
    vertex(body * 0.6, 0);
    vertex(0, -body * 0.45);
    vertex(-body * 0.55, -body * 0.2);
    vertex(-body * 0.55, body * 0.2);
    vertex(0, body * 0.45);
    endShape(CLOSE);

    // the single eye, the only bright thing on it
    noStroke();
    fill(er, eg, eb, 235);
    circle(body * 0.24, 0, body * 0.3);
    fill(255, 255, 255, 200);
    circle(body * 0.28, -body * 0.04, body * 0.12);

    // mandibles, snapping on the same clock as the legs
    stroke(er, eg, eb, 200);
    strokeWeight(2);
    for (const side of [-1, 1]) {
      line(body * 0.5, side * body * 0.1, body * 0.78, side * (body * 0.2 + walk * 2));
    }

    pop();
  }

  // No `getDisplayBoundingBox` override on purpose: `AttackableUnit`'s version
  // widens the box to the vision radius for an allied body, which is what puts
  // a summon's sight into the fog layer. The art fits inside the unit's own
  // size, so there is nothing to widen it for.
}
