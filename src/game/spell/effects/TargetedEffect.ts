export function applyTargetedEffect<T>(
  target: T,
  isValid: (value: T) => boolean,
  apply: (value: T) => void
): boolean {
  if (!isValid(target)) return false;
  apply(target);
  return true;
}
