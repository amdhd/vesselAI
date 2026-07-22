import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Custom validators for the vessel form. A ValidatorFn takes a control and
 * returns either `null` (valid) or an errors object like `{ someKey: true }`.
 * The template then checks `control.hasError('someKey')` to show a message.
 * These complement the built-in `Validators.required` / `Validators.pattern`.
 */

/**
 * Field-level: a build year must be plausible — no earlier than 1950 and no
 * further out than next year (a newbuild can be delivered slightly ahead). We
 * return a rich error payload so the template can show the allowed bounds.
 */
export function builtYearRange(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === '' || value === undefined) return null; // let `required` own emptiness
  const year = Number(value);
  const max = new Date().getFullYear() + 1;
  if (Number.isNaN(year) || year < 1950 || year > max) {
    return { builtYearRange: { min: 1950, max } };
  }
  return null;
}

/**
 * Group-level (cross-field): a vessel's economical *design* speed can never be
 * higher than its *maximum* speed. A cross-field rule can't live on a single
 * control, so it's attached to the FormGroup and reads sibling controls. It
 * writes the error onto the `designSpeed` control (so the message renders next
 * to that field) and returns null at the group level.
 */
export const designSpeedWithinMax: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const max = group.get('maxSpeed')?.value;
  const design = group.get('designSpeed')?.value;
  const designCtrl = group.get('designSpeed');
  if (max == null || design == null || max === '' || design === '' || !designCtrl) {
    return null;
  }

  if (Number(design) > Number(max)) {
    // Merge our error in without clobbering any existing errors on the control.
    designCtrl.setErrors({ ...(designCtrl.errors ?? {}), designAboveMax: true });
  } else if (designCtrl.hasError('designAboveMax')) {
    // Clear only our error; keep any other validation errors intact.
    const { designAboveMax, ...rest } = designCtrl.errors ?? {};
    designCtrl.setErrors(Object.keys(rest).length ? rest : null);
  }
  return null;
};
