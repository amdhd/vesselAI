import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';

/**
 * Global error handling for every HTTP response. This is the counterpart to the
 * requirement "handle errors globally, not per-call try/catch everywhere":
 * services and components stay clean, and this single interceptor decides how
 * failures are surfaced.
 *
 *  - 401 → the token is missing/expired: log the user out and bounce to /login.
 *  - everything else → show a toast with the best available message.
 *
 * We still `throwError` the error onward so a component *can* react if it wants
 * to (e.g. keep a form open on a 400), but it no longer *has* to.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notify = inject(NotificationService);
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        auth.logout();
        router.navigate(['/login']);
        notify.error('Your session has expired. Please sign in again.');
      } else {
        notify.error(extractMessage(err));
      }
      return throwError(() => err);
    }),
  );
};

/** Pull the most useful message out of the backend's error envelope. */
function extractMessage(err: HttpErrorResponse): string {
  if (err.status === 0) {
    return 'Cannot reach the VesselMind API. Is the backend running on :3001?';
  }
  const body = err.error;
  if (body && typeof body === 'object' && typeof body.error === 'string') {
    return body.error;
  }
  return `Request failed (${err.status}).`;
}
