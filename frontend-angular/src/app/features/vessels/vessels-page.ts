import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, startWith, switchMap, tap } from 'rxjs';
import { Vessel } from '../../core/models/vessel.model';
import { VesselService } from '../../core/services/vessel.service';

type SortKey = 'name' | 'type' | 'flag' | 'builtYear' | 'dwt' | 'currentSpeed' | 'status';

/**
 * Vessels page — the data table (Feature 3) plus the RxJS search box (Feature 4).
 *
 * Division of labour:
 *  - TEXT SEARCH is server-side: the search box drives an RxJS pipeline that
 *    calls GET /api/vessels?search=… so the backend does the filtering.
 *  - STATUS/TYPE filtering, SORTING and PAGINATION are client-side refinements
 *    over whatever the server returned, expressed as chained `computed()`
 *    signals. Each depends on the one before it, so a change anywhere upstream
 *    (new search results, a different sort column) recomputes exactly what it
 *    must and nothing else.
 */
@Component({
  selector: 'app-vessels-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe],
  templateUrl: './vessels-page.html',
  styleUrl: './vessels-page.css',
})
export class VesselsPage {
  private readonly vesselService = inject(VesselService);

  // --- Search (Feature 4) ----------------------------------------------------
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly loading = signal(false);

  /**
   * The classic "type-ahead" pipeline. Read top to bottom:
   *  startWith('')        → fire an initial load so the table isn't empty.
   *  debounceTime(300)    → wait until the user pauses typing (no request per keystroke).
   *  distinctUntilChanged → ignore emissions that didn't actually change the term.
   *  switchMap            → for each settled term, start a new request AND cancel
   *                         the previous in-flight one — so a slow earlier
   *                         response can never overwrite a newer one (race-free).
   *  catchError(of([]))   → keep the outer stream alive if a request fails.
   */
  private readonly results$ = this.search.valueChanges.pipe(
    startWith(''),
    debounceTime(300),
    distinctUntilChanged(),
    tap(() => this.loading.set(true)),
    switchMap((term) =>
      this.vesselService.list(term).pipe(
        catchError(() => of<Vessel[]>([])),
      ),
    ),
    tap(() => this.loading.set(false)),
    takeUntilDestroyed(), // auto-unsubscribe when the component is destroyed
  );

  // Bridge the RxJS result stream into a signal so the rest of the component is
  // pure signal-land. `toSignal` subscribes for us and always has a value.
  private readonly vessels = toSignal(this.results$, { initialValue: [] as Vessel[] });

  // --- Client-side refinement state (Feature 3) ------------------------------
  protected readonly statusFilter = signal('all');
  protected readonly typeFilter = signal('all');
  protected readonly sortKey = signal<SortKey>('name');
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');
  protected readonly page = signal(1);
  protected readonly pageSize = 8;

  // Dropdown options are derived from the data actually present.
  protected readonly statuses = computed(() => unique(this.vessels().map((v) => v.status)));
  protected readonly types = computed(() => unique(this.vessels().map((v) => v.type)));

  // 1) filter → 2) sort → 3) paginate, each a computed() built on the last.
  protected readonly filtered = computed(() => {
    const status = this.statusFilter();
    const type = this.typeFilter();
    return this.vessels().filter(
      (v) => (status === 'all' || v.status === status) && (type === 'all' || v.type === type),
    );
  });

  protected readonly sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    // Copy before sorting — never mutate a signal's value in place.
    return [...this.filtered()].sort((a, b) => compare(a[key], b[key]) * dir);
  });

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.sorted().length / this.pageSize)));

  protected readonly pageRows = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.sorted().slice(start, start + this.pageSize);
  });

  constructor() {
    // Keep `page` in range when the row count shrinks (new search/filter).
    // An effect() runs whenever a signal it reads changes — here, totalPages.
    effect(() => {
      if (this.page() > this.totalPages()) {
        this.page.set(this.totalPages());
      }
    });
  }

  // --- Interactions ----------------------------------------------------------
  toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
    this.page.set(1);
  }

  onStatusFilter(value: string): void { this.statusFilter.set(value); this.page.set(1); }
  onTypeFilter(value: string): void { this.typeFilter.set(value); this.page.set(1); }
  prevPage(): void { this.page.update((p) => Math.max(1, p - 1)); }
  nextPage(): void { this.page.update((p) => Math.min(this.totalPages(), p + 1)); }
}

/** Distinct, sorted list of string values. */
function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Comparator that handles both numbers and strings. */
function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
