import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Vessel } from '../../core/models/vessel.model';
import { VesselService } from '../../core/services/vessel.service';

interface Breakdown { key: string; count: number; }

/**
 * Fleet summary dashboard (Feature 6). The requirement is explicit: build this
 * with *signals + computed()*, NOT a service juggling manual RxJS Subjects.
 *
 * ── Signals vs the old BehaviorSubject pattern ───────────────────────────────
 * The pre-signals way to hold derived dashboard state was a service exposing
 * several `BehaviorSubject`s (e.g. statusCounts$, totalDwt$) that you had to
 * `.next()` by hand every time the vessel list changed, plus `| async` pipes and
 * careful unsubscription in each consumer.
 * Here instead: one source signal (`vessels`, bridged from the HTTP call by
 * `toSignal`) and a handful of `computed()` values derived from it. When
 * `vessels` changes, every computed recalculates automatically and the template
 * re-renders — no `.next()`, no subscriptions, no memory-leak footguns. That's
 * the whole argument for signals over manually-managed subjects.
 * ----------------------------------------------------------------------------
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly vesselService = inject(VesselService);

  // Single source of truth: the fleet, fetched once and exposed as a signal.
  private readonly vessels = toSignal(
    this.vesselService.list().pipe(catchError(() => of<Vessel[]>([]))),
    { initialValue: [] as Vessel[] },
  );

  // Every metric below is a pure function of `vessels()`.
  protected readonly total = computed(() => this.vessels().length);

  // "Underway" = actually making way through the water (>0.5 kn); the rest are
  // stationary (anchored/in port/maintenance).
  protected readonly underway = computed(() => this.vessels().filter((v) => v.currentSpeed > 0.5).length);
  protected readonly idle = computed(() => this.total() - this.underway());

  protected readonly avgSpeedUnderway = computed(() => {
    const moving = this.vessels().filter((v) => v.currentSpeed > 0.5);
    if (moving.length === 0) return 0;
    return moving.reduce((sum, v) => sum + v.currentSpeed, 0) / moving.length;
  });

  protected readonly totalDwt = computed(() => this.vessels().reduce((sum, v) => sum + v.dwt, 0));

  protected readonly byStatus = computed(() => groupCount(this.vessels().map((v) => v.status)));
  protected readonly byType = computed(() => groupCount(this.vessels().map((v) => v.type)));

  // For rendering the status bar widths as percentages.
  protected barPct(count: number): number {
    return this.total() === 0 ? 0 : Math.round((count / this.total()) * 100);
  }
}

/** Count occurrences of each key, returned sorted by descending count. */
function groupCount(values: string[]): Breakdown[] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}
