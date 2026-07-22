import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
}

/**
 * A tiny app-wide toast bus, built with a signal instead of an RxJS Subject.
 * The error interceptor pushes here on failed requests, forms push on success,
 * and a single <app-toast> host renders the list — no component needs to know
 * about any other. Auto-dismiss after a few seconds.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 1;
  // The toast list is a signal; the toast host component reads it reactively.
  readonly toasts = signal<Toast[]>([]);

  error(message: string): void { this.push('error', message); }
  success(message: string): void { this.push('success', message); }
  info(message: string): void { this.push('info', message); }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: Toast['kind'], message: string): void {
    const id = this.nextId++;
    // `update` reads the current value and returns the next one — the signal
    // equivalent of `subject.next([...subject.value, toast])`.
    this.toasts.update((list) => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), 5000);
  }
}
