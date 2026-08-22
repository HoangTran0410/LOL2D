import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type LeeSin_W = InstanceType<ReturnType<typeof makeLeeSin_W>>;
type LeeSin_W_Burst = InstanceType<ReturnType<typeof makeLeeSin_W_Burst>>;
type LeeSin_W_IronWill = InstanceType<ReturnType<typeof makeLeeSin_W_IronWill>>;



/**
 * Safeguard / Iron Will.
 *
 * Stage 1 (Safeguard): Lee Sin dashes to a nearby allied unit and both of them
 * get a shield when he lands — no shield at all if the dash is interrupted,
 * exactly like the real spell. With nobody around he self-casts and shields
 * himself on the spot. Reaching an allied *champion* halves the cooldown.
 *
 * Stage 2 (Iron Will): recastable for 3s afterwards. The real Iron Will is pure
 * omnivamp, which is meaningless here because this game has no basic attacks —
 * it is adapted into a heal-over-time of the same "sustain in a fight" shape.
 */
function __buildLeeSin_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Champion = api.units.Champion;
  const Dash = api.buffs.Dash;
  const Shield = api.buffs.Shield;
  const LeeSin_W_IronWill = makeLeeSin_W_IronWill(api);
  const LeeSin_W_Burst = makeLeeSin_W_Burst(api);
  class LeeSin_W extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    static PHASES = {
      W1: { image: api.asset('spell_leesin_w') },
      // The wiki carries no separate icon for the second form, so the recast
      // reuses the base icon rather than falling back to a blank placeholder.
      W2: { image: api.asset('spell_leesin_w') },
    };
    phase: 'W1' | 'W2' = 'W1';

    image = LeeSin_W.PHASES[this.phase].image;
    name = 'Hộ Thể / Kiên Định (LeeSin_W)';
    description =
      'Lee Sin <span class="buff">Lướt</span> tới đồng minh gần nhất trong phạm vi, khi tới nơi cả hai nhận <span class="buff">Lá Chắn</span> hấp thụ <span class="damage">70 sát thương</span> trong <span class="time">3 giây</span> (không có đồng minh thì tự khoác lá chắn tại chỗ; nếu cú lướt bị chặn thì không có lá chắn). Lướt tới đồng minh là tướng sẽ giảm một nửa thời gian hồi. Có thể tái kích hoạt trong <span class="time">3 giây</span> để dùng <span class="buff">Ý Chí Sắt Đá</span>: game không có đòn đánh thường nên hút máu được chuyển thành <span class="buff">hồi 60 máu</span> trong <span class="time">4 giây</span>';
    coolDown = 9000;
    manaCost = 30;

    range = 400;
    dashSpeed = 14;
    // A champion pool is 100 health, so a shield is sized as a share of that.
    shieldAmount = 22;
    shieldDuration = 3000;

    /** How long Iron Will stays available after Safeguard, like the real 3s window. */
    ironWillWindow = 3000;
    ironWillDuration = 4000;
    ironWillHeal = 60;

    _ironWillTimeLeft = 0;
    _cooldownAfterSafeguard = 9000;

    onSpellCast() {
      if (this.phase === 'W1') this.castSafeguard();
      else this.castIronWill();
    }

    castSafeguard() {
      const ally = this.findNearestAlly();

      // the real spell halves its cooldown when it lands on an allied champion
      this._cooldownAfterSafeguard = ally instanceof Champion ? this.coolDown / 2 : this.coolDown;

      if (ally && Dash.CanDash(this.owner)) {
        const dashBuff = new Dash(3000, this.owner, this.owner);
        dashBuff.image = this.image;
        dashBuff.dashDestination = ally.position; // live ref: the dash follows the ally
        dashBuff.dashSpeed = this.dashSpeed;
        dashBuff.onReachedDestination = () => {
          this.grantShield(this.owner);
          // only champions are shielded alongside him, minions/wards are not
          if (ally instanceof Champion && !ally.isDead) this.grantShield(ally);
        };
        this.owner.addBuff(dashBuff);

        // the default dash streak is a fat grey capsule; make it read as Lee Sin's
        // own blue rush (cosmetic only — trailSize is set by Dash.onCreate, which
        // has already run by now)
        dashBuff.trailSystem.trailColor = '#8FD8FFAA';
        dashBuff.trailSystem.trailSize = this.owner.stats.size.value * 0.55;
        dashBuff.trailSystem.trailLifeTime = 260;
      } else {
        // self-cast: shield goes up immediately, no travel
        this.grantShield(this.owner);
      }

      this.phase = 'W2';
      this.image = LeeSin_W.PHASES.W2.image;
      this._ironWillTimeLeft = this.ironWillWindow;
      // Iron Will has to become castable right away; the real cooldown only
      // starts once the recast window is used up or has lapsed — so this is a
      // recast window, not a cooldown, and is deliberately not reduced
      this.currentCooldown = 300;
    }

    castIronWill() {
      const ironWill = new LeeSin_W_IronWill(this.ironWillDuration, this.owner, this.owner);
      ironWill.image = this.image;
      ironWill.totalHeal = this.ironWillHeal;
      this.owner.addBuff(ironWill);

      this.endRecastWindow();
    }

    grantShield(unit: any) {
      const shieldBuff = new Shield(this.shieldDuration, this.owner, unit);
      shieldBuff.amount = this.shieldAmount;
      shieldBuff.color = [140, 210, 255];
      shieldBuff.image = LeeSin_W.PHASES.W1.image;
      shieldBuff.stackId = 'leesin_w_shield';
      unit.addBuff(shieldBuff);

      // a shield that just appears as a thin ring is easy to miss — slam it on
      const burst = new LeeSin_W_Burst(this.owner);
      burst.follow = unit;
      burst.attachTo(unit);
      burst.position = unit.position.copy();
      burst.targetSize = unit.animatedValues?.displaySize ?? 50;
      this.game.objectManager.addObject(burst);
    }

    endRecastWindow() {
      this.phase = 'W1';
      this.image = LeeSin_W.PHASES.W1.image;
      this._ironWillTimeLeft = 0;
      this.currentCooldown = this.reducedCooldown(this._cooldownAfterSafeguard);
    }

    findNearestAlly(): any {
      const allies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.type(AttackableUnit),
          PredefinedFilters.teamId(this.owner.teamId),
          PredefinedFilters.excludeDead,
          PredefinedFilters.excludeObjects([this.owner]),
        ],
      });

      let nearest: any = null;
      let nearestDistance = Infinity;
      for (const ally of allies) {
        const distance = ally.position.dist(this.owner.position);
        if (distance < nearestDistance) {
          nearest = ally;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    onUpdate() {
      if (this.phase !== 'W2') return;

      this._ironWillTimeLeft -= deltaTime;
      if (this._ironWillTimeLeft <= 0) this.endRecastWindow();
    }

    drawPreview() {
      if (this.phase === 'W1') super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return LeeSin_W;
}
const __cacheLeeSin_W = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_W>>();
export default function makeLeeSin_W(api: ContentApi) {
  const cached = __cacheLeeSin_W.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_W(api);
  __cacheLeeSin_W.set(api, built);
  return built;
}


/**
 * Iron Will, adapted: the real one is omnivamp on his attacks and spells, which
 * this game has no way to express, so the sustain is paid out as a heal spread
 * over the same 4 seconds.
 */
function __buildLeeSin_W_IronWill(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Buff = api.buffs.Buff;
  class LeeSin_W_IronWill extends Buff {
    name = 'Ý Chí Sắt Đá';
    buffAddType = BuffAddType.RENEW_EXISTING;

    totalHeal = 60;
    tickInterval = 500;
    _tickTimer = 0;

    /** Cosmetic motes of chi drifting up off the target. */
    _motes: { x: number; y: number; age: number; life: number; size: number }[] = [];
    _spawnTimer = 0;

    onUpdate(): void {
      if (this.targetUnit.isDead) return;

      this._tickTimer += deltaTime;
      if (this._tickTimer >= this.tickInterval) {
        this._tickTimer -= this.tickInterval;

        const ticks = Math.max(1, Math.round(this.duration / this.tickInterval));
        this.targetUnit.takeHeal(Math.round(this.totalHeal / ticks), this.sourceUnit);
      }

      // particles are spawned here, never in draw(), so their density does not
      // depend on how often the unit happens to be rendered
      const radius = this.targetUnit.animatedValues.displaySize / 2;
      this._spawnTimer += deltaTime;
      while (this._spawnTimer >= 70 && this._motes.length < 18) {
        this._spawnTimer -= 70;
        this._motes.push({
          x: random(-radius, radius),
          y: random(0, radius * 0.6),
          age: 0,
          life: random(500, 850),
          size: random(3, 6),
        });
      }
      if (this._spawnTimer > 70) this._spawnTimer = 0;

      let i = 0;
      while (i < this._motes.length) {
        const m = this._motes[i];
        m.age += deltaTime;
        if (m.age >= m.life) this._motes.splice(i, 1);
        else i++;
      }
    }

    draw(): void {
      if (this.targetUnit.isDead) return;

      const pos = this.targetUnit.position;
      const size = this.targetUnit.animatedValues.displaySize;
      const left = this.duration ? constrain(1 - this.timeElapsed / this.duration, 0, 1) : 1;

      push();

      // rising chi, additive so it glows instead of speckling
      blendMode(ADD);
      noStroke();
      for (const m of this._motes) {
        const t = m.age / m.life;
        fill(90, 200, 255, 140 * (1 - t));
        circle(pos.x + m.x * (1 - t * 0.5), pos.y + m.y - t * size * 0.9, m.size * (1 - t * 0.5));
      }
      blendMode(BLEND);

      noFill();
      // a slowly turning brace of arcs, "hardened" rather than shielded
      const a = frameCount / 25;
      for (let i = 0; i < 3; i++) {
        const start = a + (i * TWO_PI) / 3;
        stroke(120, 220, 255, 170);
        strokeWeight(3);
        arc(pos.x, pos.y, size + 18, size + 18, start, start + 0.9);
      }

      // how much of Iron Will is left, as a closing arc
      stroke(200, 245, 255, 190);
      strokeWeight(2);
      arc(pos.x, pos.y, size + 30, size + 30, -HALF_PI, -HALF_PI + TWO_PI * left);
      pop();
    }
  }
  return LeeSin_W_IronWill;
}
const __cacheLeeSin_W_IronWill = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_W_IronWill>>();
export function makeLeeSin_W_IronWill(api: ContentApi) {
  const cached = __cacheLeeSin_W_IronWill.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_W_IronWill(api);
  __cacheLeeSin_W_IronWill.set(api, built);
  return built;
}


/** Stone-hard shell snapping shut around whoever Safeguard covered. */
function __buildLeeSin_W_Burst(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class LeeSin_W_Burst extends SpellObject {
    follow: any = null;
    targetSize = 50;
    age = 0;
    lifeTime = 380;

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      if (this.follow) this.position.set(this.follow.position.x, this.follow.position.y);
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // the ring collapses inward, reading as a shield closing rather than a blast
      const r = this.targetSize * (1.5 - 0.75 * t);

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noStroke();
      fill(110, 190, 255, 70 * fade);
      circle(0, 0, r * 1.6);
      blendMode(BLEND);

      noFill();
      stroke(160, 225, 255, 240 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, r);

      // four braces slamming in from the sides
      stroke(210, 245, 255, 220 * fade);
      strokeWeight(3);
      for (let i = 0; i < 4; i++) {
        const a = (i * TWO_PI) / 4 + PI / 4;
        arc(0, 0, r + 12, r + 12, a - 0.35, a + 0.35);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize * 1.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return LeeSin_W_Burst;
}
const __cacheLeeSin_W_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_W_Burst>>();
export function makeLeeSin_W_Burst(api: ContentApi) {
  const cached = __cacheLeeSin_W_Burst.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_W_Burst(api);
  __cacheLeeSin_W_Burst.set(api, built);
  return built;
}