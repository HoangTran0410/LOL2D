// https://github.com/Prozi/detect-collisions/blob/master/src/optimized.ts
// Callbacks receive (value, index, array) to stay compatible with the native
// Array.prototype signature — these are patched onto Array.prototype in main.ts.
export const forEach = <T>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => void
): void => {
  const l = array.length;
  for (let i = 0; i < l; i++) {
    callback(array[i], i, array);
  }
};

export const some = <T>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => boolean
): boolean => {
  const l = array.length;
  for (let i = 0; i < l; i++) {
    if (callback(array[i], i, array)) return true;
  }
  return false;
};

export const every = <T>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => boolean
): boolean => {
  const l = array.length;
  for (let i = 0; i < l; i++) {
    if (!callback(array[i], i, array)) return false;
  }
  return true;
};

export const filter = <T>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => boolean
): T[] => {
  const output: T[] = [];
  const l = array.length;
  for (let i = 0; i < l; i++) {
    const item = array[i];
    if (callback(item, i, array)) output.push(item);
  }
  return output;
};

export const map = <T, U>(
  array: T[],
  callback: (value: T, index: number, array: T[]) => U
): U[] => {
  const l = array.length;
  const output = new Array<U>(l);
  for (let i = 0; i < l; i++) {
    output[i] = callback(array[i], i, array);
  }
  return output;
};

/**
 * High-performance 2D/multi-variate hypot replacement.
 * Uses direct scalar multiplications and Math.sqrt, bypassing V8's variadic scaling loop.
 */
export const fastHypot = (a = 0, b = 0, ...rest: number[]): number => {
  if (rest.length === 0) {
    return Math.sqrt(a * a + b * b);
  }
  let sum = a * a + b * b;
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i];
    sum += v * v;
  }
  return Math.sqrt(sum);
};

