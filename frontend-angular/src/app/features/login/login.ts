import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Login page. A small reactive form (email + password) that exchanges
 * credentials for a JWT via AuthService, then routes to the dashboard.
 *
 * Local UI state — whether a request is in flight — is a `signal(false)` rather
 * than a plain boolean, so the template updates automatically when it flips.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);

  // `fb.nonNullable` builds controls whose value can never become null, which
  // pairs well with strict mode — `form.value.email` is typed `string`, not
  // `string | null | undefined`.
  protected readonly form = this.fb.nonNullable.group({
    email: ['demo@petronas.com', [Validators.required, Validators.email]],
    password: ['demo123', [Validators.required]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      // The error interceptor already shows a toast; we just re-enable the form.
      error: () => this.submitting.set(false),
    });
  }
}
