import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';

/**
 * Route table for the whole app. Every feature is lazily loaded with
 * `loadComponent` — the component's JS chunk is only fetched when its route is
 * first visited, which keeps the initial bundle small. The protected area is a
 * parent `Shell` route carrying `canActivate: [authGuard]`; because the guard
 * sits on the parent, it protects every child (dashboard, vessels, form) at
 * once.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    // Protected shell: header + nav + <router-outlet> for the child pages.
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'vessels',
        loadComponent: () => import('./features/vessels/vessels-page').then((m) => m.VesselsPage),
      },
      {
        path: 'vessels/new',
        loadComponent: () => import('./features/vessels/vessel-form').then((m) => m.VesselForm),
      },
      {
        path: 'vessels/:id/edit',
        loadComponent: () => import('./features/vessels/vessel-form').then((m) => m.VesselForm),
      },
    ],
  },
  // Unknown URL → send to the dashboard (the guard redirects to /login if the
  // user isn't authenticated).
  { path: '**', redirectTo: '' },
];
