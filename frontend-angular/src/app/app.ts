import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from './shared/toast';

/**
 * Root component. It's intentionally tiny: a <router-outlet> where the current
 * route's component renders, plus the global <app-toast> host. All real layout
 * (header/nav) lives in the protected Shell component, not here, so the login
 * page can render full-bleed without the dashboard chrome.
 *
 * `imports: [...]` is the standalone-component replacement for an NgModule's
 * `declarations`/`imports`: a component lists exactly the other components,
 * directives and pipes its own template uses.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toast],
  template: `
    <router-outlet />
    <app-toast />
  `,
})
export class App {}
