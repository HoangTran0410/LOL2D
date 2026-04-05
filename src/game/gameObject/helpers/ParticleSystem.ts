import { Rectangle } from '../../../../libs/quadtree';
import SpellObject from '../SpellObject';

interface ParticleSystemOptions {
  isDeadFn: (particle: any) => boolean;
  preUpdateFn?: (particles: any[]) => void;
  updateFn?: (particle: any) => void;
  postUpdateFn?: (particles: any[]) => void;
  preDrawFn?: (particles: any[]) => void;
  drawFn?: (particle: any) => void;
  postDrawFn?: (particles: any[]) => void;
  getParticlePosFn?: (particle: any) => { x: number; y: number };
  getParticleSizeFn?: (particle: any) => number;
  maxParticles?: number;
  autoRemoveIfEmpty?: boolean;
  owner?: any;
}

export default class ParticleSystem extends SpellObject {
  particles: any[] = [];
  _cachedBB: Rectangle | null = null;

  isDeadFn: (particle: any) => boolean;
  preUpdateFn?: (particles: any[]) => void;
  updateFn?: (particle: any) => void;
  postUpdateFn?: (particles: any[]) => void;
  preDrawFn?: (particles: any[]) => void;
  drawFn?: (particle: any) => void;
  postDrawFn?: (particles: any[]) => void;
  getParticlePosFn?: (particle: any) => { x: number; y: number };
  getParticleSizeFn?: (particle: any) => number;
  maxParticles: number;
  autoRemoveIfEmpty: boolean;

  constructor(options: ParticleSystemOptions) {
    const {
      isDeadFn,
      preUpdateFn,
      updateFn,
      postUpdateFn,
      preDrawFn,
      drawFn,
      postDrawFn,
      getParticlePosFn,
      getParticleSizeFn,
      maxParticles = 200,
      autoRemoveIfEmpty = true,
      owner,
    } = options;

    super(owner);
    this.isDeadFn = isDeadFn;
    this.preUpdateFn = preUpdateFn;
    this.updateFn = updateFn;
    this.postUpdateFn = postUpdateFn;
    this.preDrawFn = preDrawFn;
    this.drawFn = drawFn;
    this.postDrawFn = postDrawFn;
    this.getParticlePosFn = getParticlePosFn;
    this.getParticleSizeFn = getParticleSizeFn;
    this.maxParticles = maxParticles;
    this.autoRemoveIfEmpty = autoRemoveIfEmpty;
  }

  addParticle(particle: any): void {
    this.particles.push(particle);
    if (this.particles.length > this.maxParticles) {
      this.particles.shift();
    }
    this._cachedBB = null;
  }

  update(): void {
    this.preUpdateFn?.(this.particles);
    let i = 0;
    while (i < this.particles.length) {
      const particle = this.particles[i];
      this.updateFn?.(particle);
      if (this.isDeadFn?.(particle)) {
        this.particles.splice(i, 1);
      } else {
        i++;
      }
    }
    this._cachedBB = null;
    if (this.autoRemoveIfEmpty && this.particles.length === 0) {
      this.toRemove = true;
    }
    this.postUpdateFn?.(this.particles);
  }

  draw(): void {
    push();
    this.preDrawFn?.(this.particles);
    for (const particle of this.particles) {
      this.drawFn?.(particle);
    }
    this.postDrawFn?.(this.particles);
    pop();
  }

  getDisplayBoundingBox(): Rectangle {
    if (this._cachedBB) return this._cachedBB;

    if (this.particles.length === 0 || !this.getParticlePosFn || !this.getParticleSizeFn) {
      this._cachedBB = new Rectangle({ x: 0, y: 0, w: 0, h: 0, data: this });
      return this._cachedBB;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of this.particles) {
      const pos = this.getParticlePosFn!(p);
      const size = this.getParticleSizeFn!(p);
      const half = size / 2;
      if (pos.x - half < minX) minX = pos.x - half;
      if (pos.y - half < minY) minY = pos.y - half;
      if (pos.x + half > maxX) maxX = pos.x + half;
      if (pos.y + half > maxY) maxY = pos.y + half;
    }

    this._cachedBB = new Rectangle({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      data: this,
    });
    return this._cachedBB;
  }
}

interface RippleParticle {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  r: number;
  maxr: number;
}

interface HealParticle {
  x: number;
  y: number;
  age?: number;
}

interface SmokeParticle {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

interface RandomMovingParticle {
  x: number;
  y: number;
  r: number;
}

export const PredefinedParticleSystems = {
  randomMovingParticlesDecreaseSize: (
    colour = '#77f9',
    decreaseSizeSpeed = 0.2
  ): ParticleSystem =>
    new ParticleSystem({
      getParticlePosFn: (p: RandomMovingParticle) => ({ x: p.x, y: p.y }),
      getParticleSizeFn: (p: RandomMovingParticle) => p.r * 2,
      isDeadFn: (p: RandomMovingParticle) => p.r <= 0,
      updateFn: (p: RandomMovingParticle) => {
        p.x += random(-2, 2);
        p.y += random(-2, 2);
        p.r -= decreaseSizeSpeed;
      },
      preDrawFn: () => {
        fill(colour);
        noStroke();
      },
      drawFn: (p: RandomMovingParticle) => {
        circle(p.x, p.y, p.r * 2);
      },
    }),

  ripple: (): ParticleSystem =>
    new ParticleSystem({
      getParticlePosFn: (p: RippleParticle) => ({ x: p.x, y: p.y }),
      getParticleSizeFn: (p: RippleParticle) => p.r * 2,
      isDeadFn: (p: RippleParticle) => p.r >= p.maxr,
      updateFn: (p: RippleParticle) => {
        p.x += p.vx || 0;
        p.y += p.vy || 0;
        p.r += 0.7;
      },
      drawFn: (p: RippleParticle) => {
        const alpha = map(p.r, 0, p.maxr, 150, 0);
        noStroke();
        fill(100, 100, 150, alpha);
        circle(p.x, p.y, p.r * 2 + random(-3, 3));
      },
    }),

  smoke: (
    colour: number[] = [255, 255, 100],
    spreadSpeed = 0.1,
    opacitySpeed = 2
  ): ParticleSystem =>
    new ParticleSystem({
      getParticlePosFn: (p: SmokeParticle) => ({ x: p.x, y: p.y }),
      getParticleSizeFn: (p: SmokeParticle) => p.size,
      isDeadFn: (p: SmokeParticle) => p.opacity <= 0,
      updateFn: (p: SmokeParticle) => {
        p.x += random(-2, 2);
        p.y += random(-2, 2);
        p.size += spreadSpeed;
        p.opacity -= opacitySpeed;
      },
      drawFn: (p: SmokeParticle) => {
        noStroke();
        fill(colour[0], colour[1], colour[2], p.opacity);
        circle(p.x, p.y, p.size);
      },
    }),

  heal: (colour: number[] = [0, 255, 0], size = 5, lifeTime = 1000): ParticleSystem =>
    new ParticleSystem({
      getParticlePosFn: (p: HealParticle) => ({ x: p.x, y: p.y }),
      getParticleSizeFn: () => size * 2,
      isDeadFn: (p: HealParticle) => (p.age ?? 0) >= lifeTime,
      updateFn: (p: HealParticle) => {
        p.x += random(-2, 2);
        p.y -= random(3);
        p.age = (p.age ?? 0) + deltaTime;
      },
      drawFn: (p: HealParticle) => {
        const alpha = map(p.age ?? 0, 0, lifeTime, 200, 0);
        stroke(colour[0], colour[1], colour[2], alpha);
        strokeWeight(3);
        line(p.x - size, p.y, p.x + size, p.y);
        line(p.x, p.y - size, p.x, p.y + size);
      },
    }),
};
