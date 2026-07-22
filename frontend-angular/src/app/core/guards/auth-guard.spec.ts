import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth-guard';
import { AuthService } from '../services/auth.service';

// A functional guard runs inside an injection context, so we exercise it with
// `TestBed.runInInjectionContext` after providing test doubles for its two
// dependencies. The guard ignores its route/state args, so `{}` stands in.

describe('authGuard', () => {
  const redirectTree = {} as UrlTree;

  function setup(isAuthenticated: boolean) {
    const router = { createUrlTree: vi.fn().mockReturnValue(redirectTree) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
        { provide: Router, useValue: router },
      ],
    });
    return { router };
  }

  const invoke = () =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  it('allows access when the user is authenticated', () => {
    const { router } = setup(true);
    expect(invoke()).toBe(true);
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects to /login when the user is not authenticated', () => {
    const { router } = setup(false);
    const result = invoke();
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login']);
    expect(result).toBe(redirectTree);
  });
});
