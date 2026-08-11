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
