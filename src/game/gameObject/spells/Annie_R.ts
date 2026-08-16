import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import Pet from '../attackableUnits/Pet';
import AoePulse from '../spellObjects/AoePulse';
import DamageOverTime from '../buffs/DamageOverTime';

export const MAX_RANGE = 450;
export const SUMMON_DAMAGE = 34;
export const SUMMON_RADIUS = 200;
export const TIBBERS_LIFETIME_MS = 20_000;
export const TIBBERS_HEALTH = 180;
export const TIBBERS_DAMAGE = 12;
export const TIBBERS_ATTACK_RANGE = 130;
export const AURA_RADIUS = 150;
export const AURA_DAMAGE_PER_TICK = 3;

/**
 * Summon: Tibbers.
 *
 * The pet ultimate the whole `Pet` class was written for — and the first one
 * in this game that is a *big* pet rather than a trap: 180 health, hits for 12,
 * burns everything standing next to him, and lasts 20 seconds. Killing him is
 * a real play, which is the entire difference between a summon and an effect.
 *
 * `docs/abilities/annie/r.json`: location-targeted, damages enemies near him
 * on arrival, *"remains on the field as a controllable pet"*, and recasting
 * directs him to a point. The recast is `checkCastCondition` returning false
 * while he is alive — the same shape Shaco's clone uses to be steered.
 */
export default class Annie_R extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_annie_r');
  name = 'Triệu Hồi: Tibbers (Annie_R)';
  description =
    `Triệu hồi Tibbers tại vị trí chỉ định trong <span class="time">${TIBBERS_LIFETIME_MS / 1000} giây</span>:` +
    ` vụ lửa xuất hiện gây <span class="damage">${SUMMON_DAMAGE} sát thương</span> trong <span>${SUMMON_RADIUS}px</span>.` +
    ` Tibbers có <span class="buff">${TIBBERS_HEALTH} máu</span>, tự đánh kẻ địch gần nhất và thiêu` +
    ` <span class="damage">${AURA_DAMAGE_PER_TICK} sát thương</span> mỗi nhịp quanh mình.` +
    ` <span class="buff">Bấm lại</span> để điều Tibbers tới vị trí mới`;
  coolDown = 10000;
  manaCost = 100;

  maxRange = MAX_RANGE;
  tibbers: Tibbers | null = null;

  /** While he is out, the key is a move order for him rather than a new summon. */
  checkCastCondition() {
    if (this.tibbers && !this.tibbers.toRemove) {
      const aim = this.aimPoint;
      this.tibbers.commandTo(aim);
      return false;
    }
    return true;
  }

  onUpdate() {
    if (!this.tibbers?.toRemove) return;
    // He is gone: the key goes back to being a summon, on its real cooldown.
    this.tibbers = null;
    this.currentCooldown = this.reducedCooldown(this.coolDown);
  }

  onSpellCast() {
    const aim = this.aimPoint;
    const spot = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: spot.x, y: spot.y, r: SUMMON_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(SUMMON_DAMAGE, this.owner));

    const burst = new AoePulse(this.owner);
    burst.position = spot.copy();
    burst.radius = SUMMON_RADIUS;
    burst.lifeTime = 550;
    burst.color = [255, 150, 60];
    burst.style = 'columns';
    burst.spokes = 12;
    this.game.objectManager.addObject(burst);

    const tibbers = new Tibbers({
      game: this.game,
      position: spot,
      teamId: this.owner.teamId,
      ownerUnit: this.owner,
      lifeTimeMs: TIBBERS_LIFETIME_MS,
      aggroRadius: 400,
      // He is steered by the recast, so he must not walk himself back to Annie.
      followsOwner: false,
      preset: {
        name: 'Tibbers',
        spells: [],
        attack: {
          damage: TIBBERS_DAMAGE,
          attacksPerSecond: 0.9,
          range: TIBBERS_ATTACK_RANGE,
        },
      },
    });
    this.game.objectManager.addObject(tibbers);
    this.tibbers = tibbers;
    // The recast is the whole second half of the ability, and a spell sitting
    // in COOLDOWN never reaches `checkCastCondition` — so every R press while
    // Tibbers was out was rejected by the runtime before the move order could
    // be read. Cleared here so the key stays live for as long as he is; put
    // back in `onUpdate` the moment he is not. (Shaco R does the same.)
    this.resetCoolDown();
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class Tibbers extends Pet {
  auraTick = 0;

  constructor(options: ConstructorParameters<typeof Pet>[0]) {
    super(options);
    this.stats.maxHealth.baseValue = TIBBERS_HEALTH;
    this.stats.health.baseValue = TIBBERS_HEALTH;
    this.stats.size.baseValue = this.stats.size.baseValue * 1.25;
  }

  update(): void {
    super.update();
    if (this.toRemove || this.isDead) return;

    this.auraTick += deltaTime;
    if (this.auraTick < 500) return;
    this.auraTick -= 500;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: AURA_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
    });
    enemies.forEach((enemy: any) => {
      enemy.takeDamage(AURA_DAMAGE_PER_TICK, this.ownerUnit);
      const burn = new DamageOverTime(600, this.ownerUnit, enemy);
      burn.stackId = 'tibbers_burn';
      burn.name = 'Cháy';
      burn.damagePerTick = 1;
      burn.tickInterval = 300;
      enemy.addBuff(burn);
    });
  }

  drawAvatar(): void {
    const size = this.animatedValues?.displaySize ?? 60;
    push();
    translate(this.position.x, this.position.y);
    // the fire he stands in
    noStroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI + this.age / 400;
      fill(255, 150 + i * 8, 50, 120);
      circle(cos(a) * AURA_RADIUS * 0.9, sin(a) * AURA_RADIUS * 0.9, 14);
    }
    // the bear
    fill(120, 70, 40);
    circle(0, 0, size);
    circle(-size * 0.34, -size * 0.34, size * 0.34);
    circle(size * 0.34, -size * 0.34, size * 0.34);
    fill(255, 200, 90);
    circle(-size * 0.16, -size * 0.08, size * 0.16);
    circle(size * 0.16, -size * 0.08, size * 0.16);
    pop();
  }
}
