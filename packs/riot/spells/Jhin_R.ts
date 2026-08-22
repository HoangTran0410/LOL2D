import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Root = InstanceType<ContentApi['buffs']['Root']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Jhin_R = InstanceType<ReturnType<typeof makeJhin_R>>;
type Jhin_R_Bloom = InstanceType<ReturnType<typeof makeJhin_R_Bloom>>;
type Jhin_R_Bullet = InstanceType<ReturnType<typeof makeJhin_R_Bullet>>;
type Jhin_R_Petals = InstanceType<ReturnType<typeof makeJhin_R_Petals>>;
type Jhin_R_Stage = InstanceType<ReturnType<typeof makeJhin_R_Stage>>;



export const JHIN_R_WINDOW_MS = 10_000;

export const JHIN_R_SHOTS = 4;

export const JHIN_R_SHOT_GAP_MS = 500;

export const JHIN_R_RANGE = 1350;

export const JHIN_R_CONE_ANGLE = 50 * (Math.PI / 180);
 // ~50 degrees sector
export const JHIN_R_DAMAGE = 20;

export const JHIN_R_FINAL_DAMAGE = 60;

export const JHIN_R_SLOW = 0.8;

export const JHIN_R_SLOW_MS = 1_000;

export const JHIN_R_ZOOM_FACTOR = 0.65;


const MAGENTA: [number, number, number] = [232, 67, 147];

const BONE: [number, number, number] = [245, 246, 250];

const GOLD: [number, number, number] = [241, 196, 15];

const PETAL_ORBIT = 52;


function __buildJhin_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const SpellForm = api.enums.SpellForm;
  const Root = api.buffs.Root;
  const Spell = api.Spell;
  const Jhin_R_Bullet = makeJhin_R_Bullet(api);
  const Jhin_R_Stage = makeJhin_R_Stage(api);
  const Jhin_R_Petals = makeJhin_R_Petals(api);
  class Jhin_R extends Spell {
    image = api.asset('spell_jhin_r');
    name = 'Sân Khấu Tử Thần (Jhin_R)';
    description = `Dựng sân khấu tử thần: Bấm R lần đầu để mở sân khấu hình quạt dài ${JHIN_R_RANGE} đơn vị trong ${JHIN_R_WINDOW_MS / 1000} giây (Jhin bị trói chân và mở rộng tầm nhìn).
      Bấm R thêm ${JHIN_R_SHOTS} lần nữa, mỗi lần cách nhau ${JHIN_R_SHOT_GAP_MS / 1000} giây, để bắn ${JHIN_R_SHOTS} phát đạn tỉa:
      <span class="damage">${JHIN_R_DAMAGE} sát thương</span> cho 3 phát đầu và
      <span class="damage">${JHIN_R_FINAL_DAMAGE} sát thương chí mạng</span> cho phát thứ 4,
      làm chậm kẻ địch đầu tiên trúng đạn ${JHIN_R_SLOW * 100}% trong ${JHIN_R_SLOW_MS / 1000} giây.`;
    coolDown = 10_000;
    manaCost = 100;
    range = JHIN_R_RANGE;

    performing = false;
    shotsRemaining = JHIN_R_SHOTS;
    stageAngle = 0;

    private selfRoot: Root | null = null;
    private stage: Jhin_R_Stage | null = null;
    private petals: Jhin_R_Petals | null = null;
    private savedZoom: number | null = null;

    /** The rounds left in the chamber are the whole tension, so the HUD icon carries them. */
    get stackCount(): number | undefined {
      return this.performing ? this.shotsRemaining : undefined;
    }

    setStackCount(count: number): boolean {
      this.shotsRemaining = Math.max(0, Math.min(JHIN_R_SHOTS, Math.floor(count)));
      return true;
    }

    get shotsFired(): number {
      return JHIN_R_SHOTS - this.shotsRemaining;
    }

    /**
     * One press raises the curtain, the next four are the four rounds — so the
     * budget is `JHIN_R_SHOTS` recasts, not the default 1, and the window and the
     * gap between shots both belong to the runtime rather than to a clock this
     * spell keeps for itself.
     *
     * The spec is read exactly once, on the first cast (`Spell.runtime`), so it
     * must not depend on how far through the performance Jhin is: an earlier
     * version computed its cooldown from `shotsRemaining` and got the opening
     * press's answer frozen in for the rest of the match.
     */
    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'RECAST',
        targeting: 'DIRECTION',
        active: {
          maxDurationMs: JHIN_R_WINDOW_MS,
          recastDelayMs: JHIN_R_SHOT_GAP_MS,
          recasts: JHIN_R_SHOTS,
        },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        // He is set up and aiming, not running: crowd control takes the stage
        // down, but his own root must not read as a move that cancels it.
        interrupts: SpellForm.AIMED,
      };
    }

    /** Press 1. The bullets are `onRecast`; nothing is fired here. */
    onActivate(): void {
      this.openCurtain();
    }

    /** Presses 2-5, one round each, the last one heavy. */
    onRecast(): void {
      if (!this.performing || this.shotsRemaining <= 0) return;
      this.shotsRemaining -= 1;
      this.fireBullet(this.shotsRemaining <= 0);
    }

    onCancel(): void {
      this.closeCurtain();
    }

    /** The finale, and the window lapsing, both arrive here. */
    onComplete(): void {
      this.closeCurtain();
    }

    onRemoved(): void {
      this.closeCurtain();
      super.onRemoved();
    }

    deactivate(): void {
      this.closeCurtain();
      super.deactivate();
    }

    private openCurtain(): void {
      if (this.performing) return;
      const aim = this.aimPoint;
      this.stageAngle = Math.atan2(aim.y - this.owner.position.y, aim.x - this.owner.position.x);
      this.shotsRemaining = JHIN_R_SHOTS;
      this.performing = true;

      // Root Jhin in place during the performance
      const root = new Root(JHIN_R_WINDOW_MS, this.owner, this.owner);
      this.selfRoot = root;
      this.owner.addBuff(root);

      // Zoom out camera for wide sniper vision
      if (
        this.owner === this.game?.player &&
        typeof (this.game?.camera as any)?.setZoomFactor === 'function'
      ) {
        const current: number = (this.game.camera as any).zoomFactor ?? 1;
        this.savedZoom = current;
        (this.game.camera as any).setZoomFactor(Math.max(0.45, current * JHIN_R_ZOOM_FACTOR));
      }

      // Spawn stage sector on ground
      const stage = new Jhin_R_Stage(
        this.owner,
        effectiveRange(this.range, this.owner),
        this.stageAngle,
        JHIN_R_CONE_ANGLE
      );
      this.stage = stage;
      this.game.objectManager.addObject(stage);

      // Ammo petals around Jhin
      const petals = new Jhin_R_Petals(this.owner, this);
      petals.attachTo(this.owner);
      this.petals = petals;
      this.game.objectManager.addObject(petals);
    }

    /** Idempotent: the finale, the window lapsing and every cancel all land here. */
    closeCurtain(): void {
      this.performing = false;
      this.shotsRemaining = JHIN_R_SHOTS;

      if (this.selfRoot) {
        this.selfRoot.deactivateBuff();
        this.selfRoot = null;
      }
      if (
        this.savedZoom !== null &&
        typeof (this.game?.camera as any)?.setZoomFactor === 'function' &&
        this.owner === this.game?.player
      ) {
        (this.game.camera as any).setZoomFactor(this.savedZoom);
        this.savedZoom = null;
      }
      if (this.stage) {
        this.stage.toRemove = true;
        this.stage = null;
      }
      if (this.petals) {
        this.petals.toRemove = true;
        this.petals = null;
      }
    }

    /**
     * `onRecast` is handed the context the *opening* press was made with — the
     * runtime keeps the activation's context and never replaces it — so every
     * round would fly down the angle the curtain rose at. `aimPoint` reads
     * `Spell._castContext`, which `Spell.press` refreshes on each press including
     * a recast, and is therefore where this shot is actually being aimed.
     */
    private fireBullet(isFinal: boolean): void {
      const start = createVector(this.owner.position.x, this.owner.position.y);
      const reach = effectiveRange(JHIN_R_RANGE, this.owner);
      const aim = this.aimPoint;

      // Clamp shot angle within stage sector cone
      const shotAngle = Math.atan2(aim.y - start.y, aim.x - start.x);
      let diff = shotAngle - this.stageAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const halfCone = JHIN_R_CONE_ANGLE / 2;
      const clampedDiff = constrain(diff, -halfCone, halfCone);
      const finalAngle = this.stageAngle + clampedDiff;

      const toX = start.x + Math.cos(finalAngle) * reach;
      const toY = start.y + Math.sin(finalAngle) * reach;
      const dest = createVector(toX, toY);

      const payload = isFinal ? JHIN_R_FINAL_DAMAGE : JHIN_R_DAMAGE;
      const bullet = new Jhin_R_Bullet(this.owner, start, dest, isFinal, payload);
      this.game.objectManager.addObject(bullet);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Jhin_R;
}
const __cacheJhin_R = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_R>>();
export default function makeJhin_R(api: ContentApi) {
  const cached = __cacheJhin_R.get(api);
  if (cached) return cached;
  const built = __buildJhin_R(api);
  __cacheJhin_R.set(api, built);
  return built;
}


/**
 * Fast-flying sniper bullet missile object.
 */
function __buildJhin_R_Bullet(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const Jhin_R_Bloom = makeJhin_R_Bloom(api);
  class Jhin_R_Bullet extends MissileSpellObject {
    speed = 28;
    size = 20;
    finale: boolean;
    damage: number;
    maxHitCount = 1;
    removeOnArrive = true;

    constructor(
      owner: AttackableUnit,
      start: p5.Vector,
      dest: p5.Vector,
      finale: boolean,
      damage: number
    ) {
      super(owner);
      this.position = start.copy();
      this.destination = dest.copy();
      this.finale = finale;
      this.damage = damage;
      this.trailSystem = new TrailSystem({
        trailSize: finale ? 16 : 10,
        trailColor: finale ? '#f1c40fcc' : '#e84393cc',
        trailLifeTime: 250,
        maxLength: 16,
      });
    }

    onHit(victim: AttackableUnit): void {
      if (
        !(victim instanceof AttackableUnit) ||
        typeof victim.takeDamage !== 'function' ||
        victim.teamId === this.owner.teamId ||
        victim.isDead ||
        victim.toRemove
      ) {
        return;
      }
      victim.takeDamage(this.damage, this.owner);
      const slow = new Slow(JHIN_R_SLOW_MS, this.owner, victim);
      slow.percent = JHIN_R_SLOW;
      slow.stackId = 'jhin_curtain_call_slow';
      victim.addBuff(slow);

      this.game.objectManager.addObject(
        new Jhin_R_Bloom(this.owner, victim.position.copy(), this.finale)
      );
      this.toRemove = true;
    }

    draw(): void {
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      push();
      translate(this.position.x, this.position.y);
      rotate(heading);

      if (this.finale) {
        // Golden heavy critical bullet
        noStroke();
        fill(GOLD[0], GOLD[1], GOLD[2], 255);
        ellipse(0, 0, 24, 10);
        fill(BONE[0], BONE[1], BONE[2], 255);
        ellipse(4, 0, 16, 6);
        stroke(GOLD[0], GOLD[1], GOLD[2], 230);
        strokeWeight(2);
        line(-14, 0, 12, 0);
      } else {
        // Magenta sniper bullet
        noStroke();
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 255);
        ellipse(0, 0, 18, 7);
        fill(BONE[0], BONE[1], BONE[2], 255);
        ellipse(3, 0, 12, 4);
        stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 210);
        strokeWeight(1.5);
        line(-10, 0, 9, 0);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(60);
    }
  }
  return Jhin_R_Bullet;
}
const __cacheJhin_R_Bullet = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_R_Bullet>>();
export function makeJhin_R_Bullet(api: ContentApi) {
  const cached = __cacheJhin_R_Bullet.get(api);
  if (cached) return cached;
  const built = __buildJhin_R_Bullet(api);
  __cacheJhin_R_Bullet.set(api, built);
  return built;
}


/**
 * The massive fan-shaped stage (Sân Khấu Tử Thần) drawn on the ground.
 */
function __buildJhin_R_Stage(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_R_Stage extends SpellObject {
    zIndex = 1;
    reach: number;
    angle: number;
    coneAngle: number;
    age = 0;

    constructor(owner: AttackableUnit, reach: number, angle: number, coneAngle: number) {
      super(owner);
      this.reach = reach;
      this.angle = angle;
      this.coneAngle = coneAngle;
      this.position = createVector(owner.position.x, owner.position.y);
    }

    update(): void {
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw(): void {
      const half = this.coneAngle / 2;
      const startA = this.angle - half;
      const endA = this.angle + half;
      const pulse = 0.5 + 0.5 * sin(this.age / 350);

      push();
      translate(this.position.x, this.position.y);

      // Theatre curtain sector fill
      noStroke();
      fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 24 + 10 * pulse);
      arc(0, 0, this.reach * 2, this.reach * 2, startA, endA, PIE);

      // Stage boundary side borders
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 220);
      strokeWeight(2.5);
      line(0, 0, cos(startA) * this.reach, sin(startA) * this.reach);
      line(0, 0, cos(endA) * this.reach, sin(endA) * this.reach);

      // Outer stage arc border with gold accent
      noFill();
      stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 240);
      strokeWeight(3);
      arc(0, 0, this.reach * 2, this.reach * 2, startA, endA);

      stroke(GOLD[0], GOLD[1], GOLD[2], 180 + 75 * pulse);
      strokeWeight(1.5);
      arc(0, 0, this.reach * 1.96, this.reach * 1.96, startA, endA);

      // Mid-range sniper distance rings
      stroke(BONE[0], BONE[1], BONE[2], 65);
      strokeWeight(1);
      arc(0, 0, 500 * 2, 500 * 2, startA, endA);
      arc(0, 0, 950 * 2, 950 * 2, startA, endA);

      // Center firing line
      stroke(BONE[0], BONE[1], BONE[2], 110 + 60 * pulse);
      strokeWeight(1.5);
      line(0, 0, cos(this.angle) * this.reach, sin(this.angle) * this.reach);

      // Scalloped theatre border petals along the outer arc
      const segments = 12;
      for (let i = 0; i <= segments; i++) {
        const a = startA + (i / segments) * this.coneAngle;
        const x = cos(a) * this.reach;
        const y = sin(a) * this.reach;
        fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 200);
        noStroke();
        circle(x, y, 9);
        fill(GOLD[0], GOLD[1], GOLD[2], 240);
        circle(x, y, 4);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.reach + 60) * 2);
    }
  }
  return Jhin_R_Stage;
}
const __cacheJhin_R_Stage = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_R_Stage>>();
export function makeJhin_R_Stage(api: ContentApi) {
  const cached = __cacheJhin_R_Stage.get(api);
  if (cached) return cached;
  const built = __buildJhin_R_Stage(api);
  __cacheJhin_R_Stage.set(api, built);
  return built;
}


/**
 * The 4 ammo petals revolving around Jhin.
 */
function __buildJhin_R_Petals(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_R_Petals extends SpellObject {
    radius = PETAL_ORBIT;
    age = 0;
    private spell: Jhin_R;
    private fallen: number[] = [];

    constructor(owner: AttackableUnit, spell: Jhin_R) {
      super(owner);
      this.spell = spell;
    }

    update(): void {
      if (this.dropIfAttachmentLost()) return;
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      const gone = JHIN_R_SHOTS - this.spell.shotsRemaining;
      while (this.fallen.length < gone) this.fallen.push(0);
      for (let i = 0; i < this.fallen.length; i++) {
        this.fallen[i] = Math.min(this.fallen[i] + deltaTime, 600);
      }
      if (!this.spell.performing) this.toRemove = true;
    }

    draw(): void {
      const drift = sin(this.age / 700) * 0.12;

      push();
      translate(this.position.x, this.position.y);
      noStroke();
      for (let i = 0; i < JHIN_R_SHOTS; i++) {
        const spent = i < this.fallen.length ? constrain(this.fallen[i] / 600, 0, 1) : 0;
        if (spent >= 1) continue;
        const isFourth = i === JHIN_R_SHOTS - 1;
        const reach = PETAL_ORBIT + spent * 46;
        const fade = 1 - spent;
        push();
        rotate((i * TWO_PI) / JHIN_R_SHOTS + drift + spent * 1.6);
        translate(reach, 0);
        rotate(spent * 2.4);

        if (isFourth) {
          fill(GOLD[0], GOLD[1], GOLD[2], 255 * fade);
          triangle(-11, 0, 11, -7, 11, 7);
          fill(BONE[0], BONE[1], BONE[2], 220 * fade);
          triangle(-4, 0, 10, -3, 10, 3);
        } else {
          fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235 * fade);
          triangle(-9, 0, 9, -6, 9, 6);
          fill(BONE[0], BONE[1], BONE[2], 200 * fade);
          triangle(-3, 0, 8, -2, 8, 2);
        }
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((PETAL_ORBIT + 60) * 2);
    }
  }
  return Jhin_R_Petals;
}
const __cacheJhin_R_Petals = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_R_Petals>>();
export function makeJhin_R_Petals(api: ContentApi) {
  const cached = __cacheJhin_R_Petals.get(api);
  if (cached) return cached;
  const built = __buildJhin_R_Petals(api);
  __cacheJhin_R_Petals.set(api, built);
  return built;
}


/** The landing explosion on the victim. The finale gets a huge golden/magenta lotus. */
function __buildJhin_R_Bloom(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Jhin_R_Bloom extends SpellObject {
    lifeTime: number;
    age = 0;
    finale: boolean;
    radius: number;
    petals: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector, finale: boolean) {
      super(owner);
      this.position = at;
      this.finale = finale;
      this.radius = finale ? 140 : 45;
      this.lifeTime = finale ? 650 : 340;
    }

    onAdded(): void {
      const count = this.finale ? 18 : 5;
      for (let i = 0; i < count; i++) {
        this.petals.push({
          angle: (i * TWO_PI) / count + random(-0.1, 0.1),
          reach: random(0.6, 1),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      noFill();
      stroke(BONE[0], BONE[1], BONE[2], 240 * fade);
      strokeWeight((this.finale ? 4.5 : 2) * fade + 1);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);

      if (this.finale) {
        stroke(GOLD[0], GOLD[1], GOLD[2], 220 * fade);
        strokeWeight(2.5);
        circle(this.position.x, this.position.y, this.radius * 1.3 * opened);
      }

      noStroke();
      for (const petal of this.petals) {
        const reach = this.radius * petal.reach * opened;
        push();
        translate(
          this.position.x + cos(petal.angle) * reach,
          this.position.y + sin(petal.angle) * reach
        );
        rotate(petal.angle);
        if (this.finale) {
          fill(GOLD[0], GOLD[1], GOLD[2], 240 * fade);
        } else {
          fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 235 * fade);
        }
        const petalSize = (this.finale ? 22 : 12) * fade + 4;
        triangle(0, 0, petalSize, -petalSize * 0.38, petalSize, petalSize * 0.38);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 32) * 2);
    }
  }
  return Jhin_R_Bloom;
}
const __cacheJhin_R_Bloom = new WeakMap<ContentApi, ReturnType<typeof __buildJhin_R_Bloom>>();
export function makeJhin_R_Bloom(api: ContentApi) {
  const cached = __cacheJhin_R_Bloom.get(api);
  if (cached) return cached;
  const built = __buildJhin_R_Bloom(api);
  __cacheJhin_R_Bloom.set(api, built);
  return built;
}