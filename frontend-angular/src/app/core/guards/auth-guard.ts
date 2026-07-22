import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Functional route guard protecting the dashboard shell.
 *
 * Since Angular 15 guards are plain functions typed as `CanActivateFn`, not
 * classes implementing `CanActivate`. They run inside an injection context, so
 * `inject()` works directly — no constructor, no `@Injectable`.
 *
 * ── Pre-Angular-15 (class-based) equivalent, for reference ───────────────────
 *   @Injectable({ providedIn: 'root' })
 *   export class AuthGuard implements CanActivate {
 *     constructor(private auth: AuthService, private router: Router) {}
 *     canActivate(): boolean | UrlTree {
 *       return this.auth.isAuthenticated() ? true : this.router.parseUrl('/login');
 *     }
 *   }
 * The function below is the modern, tree-shakable replacement. Returning a
 * `UrlTree` (via `router.createUrlTree`) instead of `false` redirects rather
 * than silently blocking — the user lands on /login instead of a dead route.
 * ----------------------------------------------------------------------------
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }
  // Not logged in → redirect to the login page.
  return router.createUrlTree(['/login']);
};
