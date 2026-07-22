import { FormControl, FormGroup } from '@angular/forms';
import { builtYearRange, designSpeedWithinMax } from './vessel.validators';

// These validators are plain functions over a control, so they can be tested
// directly — no TestBed, no component — by handing them a FormControl/FormGroup.

describe('builtYearRange', () => {
  const run = (value: unknown) => builtYearRange(new FormControl(value));

  it('accepts a plausible year', () => {
    expect(run(2018)).toBeNull();
  });

  it('leaves emptiness to Validators.required', () => {
    expect(run('')).toBeNull();
    expect(run(null)).toBeNull();
  });

  it('rejects a year before 1950', () => {
    expect(run(1800)).toEqual({ builtYearRange: { min: 1950, max: new Date().getFullYear() + 1 } });
  });

  it('rejects a year beyond next year', () => {
    expect(run(new Date().getFullYear() + 5)).not.toBeNull();
  });
});

describe('designSpeedWithinMax', () => {
  const group = (max: number | null, design: number | null) =>
    new FormGroup({
      maxSpeed: new FormControl(max),
      designSpeed: new FormControl(design),
    });

  it('is valid when design speed does not exceed max speed', () => {
    const g = group(16, 14);
    expect(designSpeedWithinMax(g)).toBeNull();
    expect(g.get('designSpeed')!.hasError('designAboveMax')).toBe(false);
  });

  it('flags the designSpeed control when design speed exceeds max speed', () => {
    const g = group(15, 20);
    designSpeedWithinMax(g);
    expect(g.get('designSpeed')!.hasError('designAboveMax')).toBe(true);
  });

  it('clears its own error once the value is corrected', () => {
    const g = group(15, 20);
    designSpeedWithinMax(g);
    g.get('designSpeed')!.setValue(13);
    designSpeedWithinMax(g);
    expect(g.get('designSpeed')!.hasError('designAboveMax')).toBe(false);
  });

  it('does not flag anything while a value is still missing', () => {
    expect(designSpeedWithinMax(group(null, 14))).toBeNull();
    expect(designSpeedWithinMax(group(15, null))).toBeNull();
  });

  it('preserves other errors on the designSpeed control', () => {
    const g = group(15, 20);
    g.get('designSpeed')!.setErrors({ required: true });
    designSpeedWithinMax(g);
    expect(g.get('designSpeed')!.hasError('required')).toBe(true);
    expect(g.get('designSpeed')!.hasError('designAboveMax')).toBe(true);
  });
});
