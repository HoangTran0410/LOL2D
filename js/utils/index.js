export function hasFlag(target, flag) {
  return (target & flag) === flag;
}

export const statusFlagsToString = (status, statusFlags) => {
  let result = [];
  for (let key in statusFlags) {
    if (status & statusFlags[key]) {
      result.push(key);
    }
  }
  return result;
};
