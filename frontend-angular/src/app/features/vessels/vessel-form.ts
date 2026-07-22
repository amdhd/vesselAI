import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { VESSEL_STATUSES, VESSEL_TYPES, VesselInput } from '../../core/models/vessel.model';
import { VesselService } from '../../core/services/vessel.service';
import { NotificationService } from '../../core/services/notification.service';
import { builtYearRange, designSpeedWithinMax } from './vessel.validators';

/**
 * Create / edit form for a vessel (Feature 5) — a *reactive* form (the model is
 * built in TypeScript with FormBuilder), not a template-driven one. Reactive
 * forms give synchronous, strongly-typed access to values and validation state,
 * which is what you want for anything non-trivial.
 *
 * The same component serves both "new" and "edit": if the route carries an
 * `:id`, we load that vessel and switch to update mode.
 */
@Component({
  selector: 'app-vessel-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './vessel-form.html',
  styleUrl: './vessel-form.css',
})
export class VesselForm {
  private readonly fb = inject(FormBuilder);
  private readonly vesselService = inject(VesselService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly types = VESSEL_TYPES;
  protected readonly statuses = VESSEL_STATUSES;
  protected readonly maxYear = new Date().getFullYear() + 1;

  // Edit mode is determined by the presence of an :id route param.
  private readonly vesselId = this.route.snapshot.paramMap.get('id');
  protected readonly isEdit = this.vesselId !== null;
  protected readonly saving = signal(false);
  protected readonly heading = computed(() => (this.isEdit ? 'Edit vessel' : 'Register new vessel'));

  /**
   * The form model. Built-in validators (`required`, `pattern`, `min`) plus our
   * custom ones (`builtYearRange` field validator, `designSpeedWithinMax` group
   * validator) declare the rules once, here — the template just reflects them.
   * Numbers start as `null` so the fields render empty on a new vessel;
   * `required` then rejects an untouched submit.
   */
  protected readonly form = this.fb.group(
    {
      name: ['', [Validators.required, Validators.maxLength(120)]],
      // pattern: an IMO number is exactly 7 digits.
      imoNumber: ['', [Validators.required, Validators.pattern(/^\d{7}$/)]],
      type: ['', [Validators.required]],
      flag: ['', [Validators.required, Validators.maxLength(80)]],
      builtYear: [null as number | null, [Validators.required, builtYearRange]],
      dwt: [null as number | null, [Validators.required, Validators.min(0)]],
      engineType: [''],
      enginePower: [null as number | null, [Validators.min(0)]],
      maxSpeed: [null as number | null, [Validators.required, Validators.min(0)]],
      designSpeed: [null as number | null, [Validators.required, Validators.min(0)]],
      fuelCapacity: [null as number | null, [Validators.min(0)]],
      status: ['active', [Validators.required]],
    },
    // Cross-field validator lives on the group so it can compare two controls.
    { validators: [designSpeedWithinMax] },
  );

  constructor() {
    if (this.vesselId) {
      this.vesselService.getById(this.vesselId).subscribe({
        next: (v) => this.form.patchValue(v),
        error: () => this.router.navigate(['/vessels']),
      });
    }
  }

  submit(): void {
    if (this.form.invalid) {
      // Touch everything so all pending error messages become visible at once.
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);

    const raw = this.form.getRawValue();
    // Coerce the (now-validated, non-null) values into the API payload.
    const payload: VesselInput = {
      name: raw.name!,
      imoNumber: raw.imoNumber!,
      type: raw.type!,
      flag: raw.flag!,
      builtYear: Number(raw.builtYear),
      dwt: Number(raw.dwt),
      engineType: raw.engineType ?? '',
      enginePower: Number(raw.enginePower ?? 0),
      maxSpeed: Number(raw.maxSpeed),
      designSpeed: Number(raw.designSpeed),
      fuelCapacity: Number(raw.fuelCapacity ?? 0),
      status: raw.status!,
    };

    const request$ = this.isEdit
      ? this.vesselService.update(this.vesselId!, payload)
      : this.vesselService.create(payload);

    request$.subscribe({
      next: (v) => {
        this.notify.success(`${v.name} ${this.isEdit ? 'updated' : 'created'}.`);
        this.router.navigate(['/vessels']);
      },
      error: () => this.saving.set(false), // interceptor already showed the error
    });
  }

  /** Small helper the template uses to decide whether to show a field's error. */
  showError(control: string, error: string): boolean {
    const c = this.form.get(control);
    return !!c && c.touched && c.hasError(error);
  }
}
