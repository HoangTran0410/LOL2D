import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Camille_Q = InstanceType<ReturnType<typeof makeCamille_Q>>;
type Camille_Q_AuraObject = InstanceType<ReturnType<typeof makeCamille_Q_AuraObject>>;
type Camille_Q_Buff = InstanceType<ReturnType<typeof makeCamille_Q_Buff>>;



/** How long before the blade finishes charging and the hit turns true damage. */
export const CAMILLE_Q_CHARGE_MS = 1500;

export const CAMILLE_Q_DURATION_MS = 3500;

export const CAMILLE_Q_DAMAGE = 20;

export const CAMILLE_Q_TRUE_DAMAGE = 45;


function __buildCamille_Q(api: ContentApi) {
  const Spell = api.Spell;
  const Camille_Q_Buff = makeCamille_Q_Buff(api);
  class Camille_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_camille_q');
    name = 'Giao Thức Chuẩn Xác (Camille_Q)';
    description =
      'Cường hóa đòn đánh tiếp theo gây thêm <span class="damage">20 sát thương</span> và tăng <span class="buff">30% Tốc chạy</span>. Có thể tái kích hoạt sau 1.5 giây để đòn đánh tiếp theo gây <span class="damage">Sát Thương Chuẩn</span>.';
    coolDown = 6000;
    manaCost = 25;

    onSpellCast() {
      const qBuff = new Camille_Q_Buff(CAMILLE_Q_DURATION_MS, this.owner, this.owner);
      this.owner.addBuff(qBuff);
    }
  }
  return Camille_Q;
}
const __cacheCamille_Q = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_Q>>();
export default function makeCamille_Q(api: ContentApi) {
  const cached = __cacheCamille_Q.get(api);
  if (cached) return cached;
  const built = __buildCamille_Q(api);
  __cacheCamille_Q.set(api, built);
  return built;
}


function __buildCamille_Q_Buff(api: ContentApi) {
  const Buff = api.buffs.Buff;
  const EventType = api.enums.EventType;
  const Speedup = api.buffs.Speedup;
  const Camille_Q_AuraObject = makeCamille_Q_AuraObject(api);
  class Camille_Q_Buff extends Buff {
    image = api.asset('spell_camille_q');
    name = 'Giao Thức Chuẩn Xác (Cường Hóa)';
    isQ2Ready = false;
    timer = 0;
    private stopListening?: () => void;
    private auraObj: Camille_Q_AuraObject | null = null;

    onActivate() {
      this.auraObj = new Camille_Q_AuraObject(this.targetUnit, this);
      this.auraObj.attachTo(this.targetUnit, this);
      this.game.objectManager.addObject(this.auraObj);

      // Speedup
      const speed = new Speedup(1000, this.targetUnit, this.targetUnit);
      speed.percent = 0.3;
      this.targetUnit.addBuff(speed);

      this.stopListening = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: any) => {
          if (attacker === this.targetUnit && victim) {
            if (this.timer >= CAMILLE_Q_CHARGE_MS) {
              // True damage Q2
              victim.takeDamage(CAMILLE_Q_TRUE_DAMAGE, this.targetUnit);
            } else {
              // Normal Q1 bonus damage
              victim.takeDamage(CAMILLE_Q_DAMAGE, this.targetUnit);
            }
            this.auraObj?.discharge(victim.position.x, victim.position.y, this.isQ2Ready);
            this.deactivateBuff();
          }
        }
      );
    }

    onUpdate() {
      this.timer += deltaTime;
      if (this.timer >= CAMILLE_Q_CHARGE_MS && !this.isQ2Ready) {
        this.isQ2Ready = true;
        this.name = 'Giao Thức Chuẩn Xác (Sát Thương Chuẩn)';
        this.image = api.asset('spell_camille_q2');
        this.auraObj?.onChargeComplete();
      }
    }

    onDeactivate() {
      if (this.auraObj) {
        this.auraObj.toRemove = true;
        this.auraObj = null;
      }
      if (this.stopListening) {
        this.stopListening();
        this.stopListening = undefined;
      }
    }
  }
  return Camille_Q_Buff;
}
const __cacheCamille_Q_Buff = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_Q_Buff>>();
export function makeCamille_Q_Buff(api: ContentApi) {
  const cached = __cacheCamille_Q_Buff.get(api);
  if (cached) return cached;
  const built = __buildCamille_Q_Buff(api);
  __cacheCamille_Q_Buff.set(api, built);
  return built;
}


/** Radius the hex-plate blades orbit at, and the box the effect needs to survive culling. */
const BLADE_ORBIT = 34;

const BLADE_COUNT = 3;


/**
 * The blades riding on Camille's legs while Precision Protocol is up.
 *
 * Three states the player has to be able to tell apart at a glance, because the
 * whole spell is a decision about when to swing: unfolding (just cast), charging
 * cyan (bonus damage), locked gold (true damage). The lock is a one-shot flare
 * rather than a colour swap alone — a change that only happens between two frames
 * is invisible in a fight.
 */
function __buildCamille_Q_AuraObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Camille_Q_AuraObject extends SpellObject {
    buffRef: Camille_Q_Buff;

    /** Blades fold out over this long; before it the effect is still assembling. */
    unfoldMs = 220;
    age = 0;
    /** Counts down from 1 when the blade locks into true damage. */
    lockFlare = 0;
    /** Counts down from 1 on the swing that spends the charge. */
    dischargeFlare = 0;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#7fe9ff', 0.35);

    constructor(owner: any, buffRef: Camille_Q_Buff) {
      super(owner);
      this.buffRef = buffRef;
    }

    onAdded() {
      this.useParticles(this.particleSystem);
    }

    /** The blade finishes charging: gold snaps in with a burst of sparks. */
    onChargeComplete() {
      this.lockFlare = 1;
      for (let i = 0; i < 12; i++) {
        const angle = (TWO_PI / 12) * i;
        this.particleSystem.addParticle({
          x: this.owner.position.x + cos(angle) * BLADE_ORBIT,
          y: this.owner.position.y + sin(angle) * BLADE_ORBIT,
          r: random(4, 9),
        });
      }
    }

    /** The charge is spent on a body: throw the sparks at whoever ate it. */
    discharge(x: number, y: number, wasGold: boolean) {
      this.dischargeFlare = 1;
      for (let i = 0; i < (wasGold ? 14 : 8); i++) {
        this.particleSystem.addParticle({
          x: x + random(-18, 18),
          y: y + random(-18, 18),
          r: random(5, 12),
        });
      }
    }

    update() {
      // rides her body: dies with her, and with the buff it shadows
      if (this.dropIfAttachmentLost()) return;
      if (!this.owner || this.owner.toRemove || this.buffRef.toRemove) {
        this.toRemove = true;
        return;
      }
      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      if (this.lockFlare > 0) this.lockFlare = Math.max(0, this.lockFlare - deltaTime / 320);
      if (this.dischargeFlare > 0) {
        this.dischargeFlare = Math.max(0, this.dischargeFlare - deltaTime / 220);
      }
    }

    draw() {
      if (!this.owner) return;
      const unfold = constrain(this.age / this.unfoldMs, 0, 1);
      // ease-out: the blades snap out fast then settle, rather than sliding linearly
      const open = 1 - (1 - unfold) * (1 - unfold);
      const gold = this.buffRef.isQ2Ready;
      const spin = frameCount * (gold ? 0.045 : 0.028);

      push();
      translate(this.owner.position.x, this.owner.position.y);

      // ground glow under her, so the state reads even when her body is covered
      noStroke();
      if (gold) fill(255, 205, 60, 40 + this.lockFlare * 90);
      else fill(90, 220, 255, 32);
      ellipse(0, 0, BLADE_ORBIT * 2.4 * open, BLADE_ORBIT * 1.1 * open);

      // the charge ring: a gap that closes as the true-damage timer fills
      const charge = constrain(this.buffRef.timer / CAMILLE_Q_CHARGE_MS, 0, 1);
      noFill();
      stroke(30, 90, 120, 150 * open);
      strokeWeight(3);
      circle(0, 0, BLADE_ORBIT * 2 * open);
      stroke(gold ? 255 : 120, gold ? 225 : 240, gold ? 90 : 255, 230 * open);
      strokeWeight(4);
      arc(
        0,
        0,
        BLADE_ORBIT * 2 * open,
        BLADE_ORBIT * 2 * open,
        -HALF_PI,
        -HALF_PI + TWO_PI * (gold ? 1 : charge)
      );

      // hex-plate blades orbiting her legs — Camille's silhouette is hard angles,
      // never the soft rings the elemental champions use
      rotate(spin);
      for (let i = 0; i < BLADE_COUNT; i++) {
        push();
        rotate((TWO_PI / BLADE_COUNT) * i);
        translate(BLADE_ORBIT * open, 0);
        // each blade tilts as it unfolds, so the fold-out is legible
        rotate((1 - open) * HALF_PI);

        stroke(gold ? 255 : 150, gold ? 235 : 245, gold ? 140 : 255, 240 * open);
        strokeWeight(2);
        fill(gold ? 190 : 20, gold ? 140 : 90, gold ? 20 : 120, 170 * open);
        const long = 13 * open;
        const wide = 6 * open;
        beginShape();
        vertex(-long, 0);
        vertex(-long * 0.35, -wide);
        vertex(long * 0.55, -wide * 0.6);
        vertex(long, 0);
        vertex(long * 0.55, wide * 0.6);
        vertex(-long * 0.35, wide);
        endShape(CLOSE);
        pop();
      }
      pop();

      // the lock-in: a hard hex snapping shut around her, gone in a third of a second
      if (this.lockFlare > 0) {
        push();
        translate(this.owner.position.x, this.owner.position.y);
        const grow = 1 - this.lockFlare;
        noFill();
        stroke(255, 230, 130, 255 * this.lockFlare);
        strokeWeight(3 + 4 * this.lockFlare);
        beginShape();
        for (let i = 0; i < 6; i++) {
          const angle = (TWO_PI / 6) * i - HALF_PI;
          const r = BLADE_ORBIT * (2.2 - 1.1 * grow);
          vertex(cos(angle) * r, sin(angle) * r);
        }
        endShape(CLOSE);
        pop();
      }

      // the swing that spends it: a white pop where the blade came off her leg
      if (this.dischargeFlare > 0) {
        push();
        translate(this.owner.position.x, this.owner.position.y);
        noStroke();
        fill(255, 255, 255, 200 * this.dischargeFlare);
        circle(0, 0, BLADE_ORBIT * 1.6 * (1 - this.dischargeFlare) + 10);
        pop();
      }
    }

    getDisplayBoundingBox() {
      const r = BLADE_ORBIT * 2.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Camille_Q_AuraObject;
}
const __cacheCamille_Q_AuraObject = new WeakMap<ContentApi, ReturnType<typeof __buildCamille_Q_AuraObject>>();
export function makeCamille_Q_AuraObject(api: ContentApi) {
  const cached = __cacheCamille_Q_AuraObject.get(api);
  if (cached) return cached;
  const built = __buildCamille_Q_AuraObject(api);
  __cacheCamille_Q_AuraObject.set(api, built);
  return built;
}