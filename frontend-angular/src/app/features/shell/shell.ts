import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

/**
 * Authenticated layout shell. Renders the top bar (brand, nav, current user,
 * logout) and a <router-outlet> for the child pages (dashboard / vessels /
 * form). Because the authGuard is attached to this route in app.routes.ts, the
 * shell only ever renders for a logged-in user, so `currentUser()` is non-null
 * in practice.
 *
 * `routerLink` + `routerLinkActive` come from RouterLink/RouterLinkActive — the
 * active link gets the `active` CSS class automatically as the URL changes.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.currentUser;

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
