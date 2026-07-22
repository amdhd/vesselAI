import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from '../services/auth.service';

/**
 * Functional HTTP interceptor that attaches the JWT to every outgoing request.
 *
 * Registered once in app.config.ts via `provideHttpClient(withInterceptors([...]))`,
 * it runs for every HttpClient call, so no service method ever has to set the
 * Authorization header itself. HttpRequest objects are immutable, so we `clone()`
 * with the extra header rather than mutating the original.
 *
 * (Pre-v15 this was a class implementing `HttpInterceptor` with an `intercept()`
 * method, registered through the `HTTP_INTERCEPTORS` multi-provider token. The
 * functional form here is the current idiom.)
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();

  // No token (e.g. the login request itself) → pass the request through as-is.
  if (!token) {
    return next(req);
  }

  const authReq = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
  return next(authReq);
};
