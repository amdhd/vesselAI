import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Credentials, LoginResponse, User } from '../models/user.model';

const TOKEN_KEY = 'vesselmind.token';
const USER_KEY = 'vesselmind.user';

/**
 * Central auth state + the login/logout API.
 *
 * `providedIn: 'root'` registers this as an application-wide singleton with the
 * Angular injector — there is exactly one AuthService instance, and any
 * component/guard/interceptor that `inject()`s it shares the same auth state.
 *
 * ── How this differs from the pre-Angular-17 NgModule style ──────────────────
 * Old style: you'd declare `@NgModule({ providers: [AuthService] })` (or rely on
 *   root), inject it via a constructor parameter — `constructor(private http:
 *   HttpClient) {}` — and expose auth state as a `BehaviorSubject<User|null>`
 *   that components subscribed to with the `| async` pipe.
 * New style (below): `providedIn: 'root'` needs no NgModule; dependencies are
 *   grabbed with the `inject()` function; and state is a `signal()` that
 *   templates read directly (`auth.currentUser()`) with no subscription and no
 *   manual unsubscribe. Signals are pull-based and integrate with change
 *   detection automatically, which is why they replace the Subject+async pattern
 *   for local/UI state.
 * ----------------------------------------------------------------------------
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  // Private writable signals hold the source of truth. We seed them from
  // localStorage so a page refresh keeps the user logged in.
  private readonly _token = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private readonly _user = signal<User | null>(readStoredUser());

  // Public read-only views. Exposing `.asReadonly()` means components can read
  // but never reassign auth state directly — mutations go through login/logout.
  readonly token = this._token.asReadonly();
  readonly currentUser = this._user.asReadonly();

  // `computed()` derives state from other signals and recomputes lazily only
  // when its inputs change. The auth guard reads this to decide route access.
  readonly isAuthenticated = computed(() => this._token() !== null);

  /**
   * Exchange credentials for a JWT. Returns an Observable so the component can
   * react to success/failure; the `tap` side-effect persists the token/user
   * before the component's subscriber runs.
   */
  login(credentials: Credentials): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, credentials).pipe(
      tap((res) => this.setSession(res.token, res.user)),
    );
  }

  logout(): void {
    this._token.set(null);
    this._user.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  private setSession(token: string, user: User): void {
    this._token.set(token);
    this._user.set(user);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

function readStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}
