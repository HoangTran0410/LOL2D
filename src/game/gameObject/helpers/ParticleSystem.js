export default class ParticleSystem {
  particles = [];

  constructor({
    isDeadFn,
    preUpdateFn,
    updateFn,
    postUpdateFn,
    preDrawFn,
    drawFn,
    postDrawFn,
    maxParticles = 30,
  }) {
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
    this.preDrawFn?.(this.particles);
    for (const particle of this.particles) {
      this.drawFn?.(particle);
    }
    this.postDrawFn?.(this.particles);
  }
}

export const PredefinedParticleSystems = {
  randomMovingParticlesDecreaseSize: (colour = '#77f9') =>
    new ParticleSystem({
      isDeadFn: p => {
        return p.r <= 0;
      },
      updateFn: p => {
        p.x += random(-2, 2);
        p.y += random(-2, 2);
        p.r -= 0.2;
      },
      preDrawFn: () => {
        fill(colour);
        noStroke();
      },
      drawFn: p => {
        circle(p.x, p.y, p.r * 2);
      },
    }),
};
