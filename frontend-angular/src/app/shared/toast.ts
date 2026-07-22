import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService } from '../core/services/notification.service';

/**
 * Renders the app-wide toast list. It owns no state of its own — it just reads
 * the NotificationService's `toasts` signal. `ChangeDetectionStrategy.OnPush`
 * is safe (and cheap) here because everything it renders comes from signals,
 * which notify Angular precisely when they change.
 *
 * `@for` / `@if` are Angular's built-in control-flow syntax (v17+). They replace
 * the old structural directives `*ngFor` / `*ngIf` — no `CommonModule` import
 * needed, and `@for` requires a `track` expression for efficient list diffing.
 */
@Component({
  selector: 'app-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-host">
      @for (t of notify.toasts(); track t.id) {
        <div class="toast toast-{{ t.kind }}" (click)="notify.dismiss(t.id)">
          <span>{{ t.message }}</span>
          <button class="close" aria-label="Dismiss">×</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-host {
      position: fixed;
      top: 1rem;
      right: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      z-index: 1000;
      max-width: min(360px, 90vw);
    }
    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.7rem 0.9rem;
      border-radius: 10px;
      color: #fff;
      box-shadow: 0 6px 20px rgba(11, 31, 51, 0.25);
      cursor: pointer;
      font-size: 0.88rem;
      animation: slidein 0.15s ease;
    }
    .toast-error { background: #c02626; }
    .toast-success { background: #17915a; }
    .toast-info { background: #1b4568; }
    .close { background: transparent; border: none; color: #fff; font-size: 1.1rem; cursor: pointer; }
    @keyframes slidein { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `],
})
export class Toast {
  protected readonly notify = inject(NotificationService);
}
