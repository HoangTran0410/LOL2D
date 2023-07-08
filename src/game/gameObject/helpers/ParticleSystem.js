import SpellObject from '../SpellObject.js';

export default class ParticleSystem extends SpellObject {
  particles = [];

  constructor({
    isDeadFn,
    preUpdateFn,
    updateFn,
    postUpdateFn,
    preDrawFn,
    drawFn,
    postDrawFn,
    maxParticles = 200,
    owner,
  }) {
    super(owner);
    this.isDeadFn = isDeadFn;
    this.preUpdateFn = preUpdateFn;
    this.updateFn = updateFn;
    this.postUpdateFn = postUpdateFn;
    this.preDrawFn = preDrawFn;
    this.drawFn = drawFn;
    this.postDrawFn = postDrawFn;
    this.maxParticles = maxParticles;
  }

  addParticle(particle) {
    this.particles.push(particle);
    if (this.particles.length > this.maxParticles) {
      this.particles.shift();
    }
  }

  update() {
    this.preUpdateFn?.(this.particles);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      this.updateFn?.(particle);
      if (this.isDeadFn?.(particle)) {
        this.particles.splice(i, 1);
      }
    }
    this.postUpdateFn?.(this.particles);
  }

  draw() {
    push();
    this.preDrawFn?.(this.particles);
    for (const particle of this.particles) {
      this.drawFn?.(particle);
    }
    this.postDrawFn?.(this.particles);
    pop();
  }

  get toRemove() {
    return this.particles.length === 0;
  }
}

export const PredefinedParticleSystems = {
  randomMovingParticlesDecreaseSize: (colour = '#77f9', decreaseSizeSpeed = 0.2) =>
    new ParticleSystem({
      isDeadFn: p => {
        return p.r <= 0;
      },
      updateFn: p => {
        p.x += random(-2, 2);
        p.y += random(-2, 2);
        p.r -= decreaseSizeSpeed;
      },
      preDrawFn: () => {
        fill(colour);
        noStroke();
      },
      drawFn: p => {
        circle(p.x, p.y, p.r * 2);
      },
    }),

  ripple: () =>
    new ParticleSystem({
      isDeadFn: p => {
        return p.r >= p.maxr;
      },
      updateFn: p => {
        p.x += p.vx || 0;
        p.y += p.vy || 0;
        p.r += 0.7;
      },
      drawFn: p => {
        let alpha = map(p.r, 0, p.maxr, 150, 0);
        noStroke();
        fill(100, 100, 150, alpha);
        circle(p.x, p.y, p.r * 2 + random(-3, 3));
      },
    }),

  smoke: (colour = [255, 255, 100], spreadSpeed = 0.1, opacitySpeed = 2) =>
    new ParticleSystem({
      isDeadFn: p => p.opacity <= 0,
      updateFn: p => {
        p.x += random(-2, 2);
        p.y += random(-2, 2);
        p.size += spreadSpeed;
        p.opacity -= opacitySpeed;
      },
      drawFn: p => {
        noStroke();
        fill(...colour, p.opacity);
        circle(p.x, p.y, p.size);
      },
    }),
};
