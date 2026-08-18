import { describe, expect, it } from 'vitest';
import {
  angleBetween,
  clamp,
  degToRad,
  dist,
  distSq,
  lerp,
  radToDeg,
  vecDist,
  vecDistSq,
  withinRadius,
  withinRadiusCoords,
  wrapAngle,
} from '../../src/utils/math.utils';

describe('math.utils', () => {
  describe('distSq and vecDistSq', () => {
    it('calculates squared distance between coordinate pairs', () => {
      expect(distSq(0, 0, 3, 4)).toBe(25);
      expect(distSq(1, 2, 4, 6)).toBe(25);
      expect(distSq(5, 5, 5, 5)).toBe(0);
    });

    it('calculates squared distance between Point2D objects', () => {
      expect(vecDistSq({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe(100);
      expect(vecDistSq({ x: -2, y: -3 }, { x: 1, y: 1 })).toBe(25);
    });
  });

  describe('dist and vecDist', () => {
    it('calculates Euclidean distance between coordinate pairs', () => {
      expect(dist(0, 0, 3, 4)).toBe(5);
      expect(dist(0, 0, 6, 8)).toBe(10);
      expect(dist(10, 20, 10, 20)).toBe(0);
    });

    it('calculates Euclidean distance between Point2D objects', () => {
      expect(vecDist({ x: 0, y: 0 }, { x: 5, y: 12 })).toBe(13);
      expect(vecDist({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(0);
    });
  });

  describe('withinRadius and withinRadiusCoords', () => {
    it('accurately evaluates distance threshold without square root', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 }; // distance = 5

      expect(withinRadius(a, b, 5)).toBe(true);
      expect(withinRadius(a, b, 4.99)).toBe(false);
      expect(withinRadius(a, b, 6)).toBe(true);
      expect(withinRadius(a, b, -1)).toBe(false);

      expect(withinRadiusCoords(0, 0, 3, 4, 5)).toBe(true);
      expect(withinRadiusCoords(0, 0, 3, 4, 4.99)).toBe(false);
      expect(withinRadiusCoords(0, 0, 3, 4, 5.01)).toBe(true);
      expect(withinRadiusCoords(0, 0, 3, 4, -5)).toBe(false);
    });
  });

  describe('clamp and lerp', () => {
    it('clamps values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('interpolates linearly between numbers', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
      expect(lerp(10, 20, 0)).toBe(10);
      expect(lerp(10, 20, 1)).toBe(20);
      expect(lerp(0, 100, 0.25)).toBe(25);
    });
  });

  describe('wrapAngle and conversions', () => {
    it('wraps angles into (-PI, PI]', () => {
      expect(wrapAngle(0)).toBe(0);
      expect(wrapAngle(Math.PI)).toBe(Math.PI);
      expect(wrapAngle(Math.PI * 3)).toBe(Math.PI);
      expect(wrapAngle(-Math.PI * 3)).toBe(Math.PI);
      expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    });

    it('converts between degrees and radians', () => {
      expect(degToRad(180)).toBeCloseTo(Math.PI);
      expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
      expect(radToDeg(Math.PI)).toBeCloseTo(180);
      expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
    });

    it('computes angle between two points', () => {
      expect(angleBetween({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
      expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
      expect(angleBetween({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(Math.PI);
    });
  });
});
