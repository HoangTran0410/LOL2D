import { vi } from 'vitest';

Object.assign(globalThis, {
  deltaTime: 16,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  constrain: (n: number, low: number, high: number) => Math.min(high, Math.max(low, n)),
  random: (min = 1, max?: number) => max === undefined ? Math.random() * min : min + Math.random() * (max - min),
  floor: Math.floor,
  createVector: vi.fn(),
});
