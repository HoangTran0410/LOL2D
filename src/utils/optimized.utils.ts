// https://github.com/Prozi/detect-collisions/blob/master/src/optimized.ts
export const forEach = <T>(array: T[], callback: (value: T, index: number) => void): void => {
  for (let i = 0, l = array.length; i < l; i++) {
    callback(array[i], i);
  }
};

export const some = <T>(array: T[], callback: (value: T, index: number) => boolean): boolean => {
  for (let i = 0, l = array.length; i < l; i++) {
    if (callback(array[i], i)) return true;
  }
  return false;
};

export const every = <T>(array: T[], callback: (value: T, index: number) => boolean): boolean => {
  for (let i = 0, l = array.length; i < l; i++) {
    if (!callback(array[i], i)) return false;
  }
  return true;
};

export const filter = <T>(array: T[], callback: (value: T, index: number) => boolean): T[] => {
  const output: T[] = [];
  for (let i = 0, l = array.length; i < l; i++) {
    const item = array[i];
    if (callback(item, i)) output.push(item);
  }
  return output;
};

export const map = <T, U>(array: T[], callback: (value: T, index: number) => U): U[] => {
  const output = new Array<U>(array.length);
  for (let i = 0, l = array.length; i < l; i++) {
    output[i] = callback(array[i], i);
  }
  return output;
};
