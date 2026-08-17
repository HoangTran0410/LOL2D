import { describe, expect, it } from 'vitest';
import { applyTargetedEffect } from '../../../src/game/spell/effects/TargetedEffect';

describe('TargetedEffect', () => {
  it('applies only to a still-valid target', () => {
    const target = { valid: true, applications: 0 };

    expect(
      applyTargetedEffect(
        target,
        value => value.valid,
        value => {
          value.applications += 1;
        }
      )
    ).toBe(true);
    target.valid = false;
    expect(
      applyTargetedEffect(
        target,
        value => value.valid,
        value => {
          value.applications += 1;
        }
      )
    ).toBe(false);

    expect(target.applications).toBe(1);
  });
});
