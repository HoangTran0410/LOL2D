/// <reference types="p5/global" />
/// <reference types="p5" />

// Declare p5 namespace in global scope (for use in module files)
declare namespace p5 {
  class Vector {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    static add(v1: p5.Vector, v2: p5.Vector): p5.Vector;
    static sub(v1: p5.Vector, v2: p5.Vector): p5.Vector;
    static mult(v: p5.Vector, n: number): p5.Vector;
    static div(v: p5.Vector, n: number): p5.Vector;
    static dot(v1: p5.Vector, v2: p5.Vector): number;
    static dist(v1: p5.Vector, v2: p5.Vector): number;
    static cross(v1: p5.Vector, v2: p5.Vector): p5.Vector;
    static normalize(v: p5.Vector): p5.Vector;
    static fromAngle(angle: number): p5.Vector;
    static random2D(): p5.Vector;
    static mag(v: p5.Vector): number;
    set(v: p5.Vector): p5.Vector;
    set(x: number, y: number, z?: number): p5.Vector;
    copy(): p5.Vector;
    add(v: p5.Vector | { x: number; y: number }): p5.Vector;
    add(x: number, y: number): p5.Vector;
    sub(v: p5.Vector | { x: number; y: number }): p5.Vector;
    sub(x: number, y: number): p5.Vector;
    mult(n: number): p5.Vector;
    div(n: number): p5.Vector;
    mag(): number;
    magSq(): number;
    dot(v: p5.Vector): number;
    cross(v: p5.Vector): p5.Vector;
    normalize(): p5.Vector;
    limit(max: number): p5.Vector;
    setMag(len: number): p5.Vector;
    heading(): number;
    rotate(angle: number): p5.Vector;
    dist(v: p5.Vector): number;
    lerp(target: p5.Vector, amt: number): p5.Vector;
    array(): number[];
    isStatic?: boolean;
  }

  interface Color {
    setAlpha(a: number): p5.Color;
  }
  interface Image {}
  interface Element {
    elt: HTMLElement;
  }
  interface Graphics {
    erase(): void;
    noErase(): void;
  }
}

// Augment window with game-level globals
declare global {
  interface Window {
    objectManager?: any;
    champion?: any;
    Stats: any;
  }
}

// Additional p5 types not in @types/p5
declare module 'p5' {
  interface Graphics {
    erase(): void;
    noErase(): void;
  }
}

// Augment Array prototype with optimized methods
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Array<T> {
  forEach(callbackfn: (value: T, index: number) => void): void;
  map<U>(callbackfn: (value: T, index: number) => U): U[];
  filter(callbackfn: (value: T, index: number) => boolean): T[];
  some(callbackfn: (value: T, index: number) => boolean): boolean;
  every(callbackfn: (value: T, index: number) => boolean): boolean;
}