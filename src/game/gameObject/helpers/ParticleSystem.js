import { Rectangle } from '../../../../libs/quadtree.js';
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
    getParticlePosFn,
    getParticleSizeFn,
    maxParticles = 200,
    autoRemoveIfEmpty = true,
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
    this.getParticlePosFn = getParticlePosFn;
    this.getParticleSizeFn = getParticleSizeFn;
    this.maxParticles = maxParticles;
    this.autoRemoveIfEmpty = autoRemoveIfEmpty;
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

        // if all particles are dead, remove this particle system
        // particle system only be removed if there was particle added
        if (this.autoRemoveIfEmpty && this.particles.length === 0) {
          this.toRemove = true;
        }
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

  getBoundingBox() {
    if (this.particles.length === 0 || !this.getParticlePosFn || !this.getParticleSizeFn)
      return new Rectangle({ x: 0, y: 0, w: 0, h: 0, data: this });

    let topLeft = {
      x: Infinity,
      y: Infinity,
    };
    let bottomRight = {
      x: -Infinity,
      y: -Infinity,
    };

    for (let p of this.particles) {
      let pos = this.getParticlePosFn(p);
      let size = this.getParticleSizeFn(p);
      topLeft.x = min(topLeft.x, pos.x - size / 2);
      topLeft.y = min(topLeft.y, pos.y - size / 2);
      bottomRight.x = max(bottomRight.x, pos.x + size / 2);
      bottomRight.y = max(bottomRight.y, pos.y + size / 2);
    }

    return new Rectangle({
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
      data: this,
    });
  }
}

export const PredefinedParticleSystems = {
  randomMovingParticlesDecreaseSize: (colour = '#77f9', decreaseSizeSpeed = 0.2) =>
    new ParticleSystem({
      getParticlePosFn: p => ({ x: p.x, y: p.y }),
      getParticleSizeFn: p => p.r * 2,
      isDeadFn: p => p.r <= 0,
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
      getParticlePosFn: p => ({ x: p.x, y: p.y }),
      getParticleSizeFn: p => p.r * 2,
      isDeadFn: p => p.r >= p.maxr,
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
      getParticlePosFn: p => ({ x: p.x, y: p.y }),
      getParticleSizeFn: p => p.size,
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

  heal: (colour = [0, 255, 0], size = 5, lifeTime = 1000) =>
    new ParticleSystem({
      getParticlePosFn: p => ({ x: p.x, y: p.y }),
      getParticleSizeFn: p => size * 2,
      isDeadFn: p => p.age >= lifeTime,
      updateFn: p => {
        p.x += random(-2, 2);
        p.y -= random(3);
        p.age = (p.age || 0) + deltaTime;
      },
      drawFn: p => {
        let alpha = map(p.age, 0, lifeTime, 200, 0);
        stroke(...colour, alpha);
        strokeWeight(3);

        // chữ thập
        line(p.x - size, p.y, p.x + size, p.y);
        line(p.x, p.y - size, p.x, p.y + size);
      },
    }),

  // explode: ({x, y, range = 100, particlesCount = 30, color }) => {
  //   let system = new ParticleSystem({
  //     isDeadFn: p => p.opacity <= 0,
  //     updateFn: p => {
  //       p.x += p.vx || 0;
  //       p.y += p.vy || 0;
  //       p.opacity -= 2;
  //     },
  //     drawFn: p => {
  //       noStroke();
  //       fill(255, 255, 100,)
  //     },
  //   });

  //   for (let i = 0; i < particlesCount; i++) {}

  //   return system;
  // },
};
