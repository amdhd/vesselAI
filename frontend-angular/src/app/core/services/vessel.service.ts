import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Vessel, VesselInput } from '../models/vessel.model';

/**
 * Thin resource service wrapping HttpClient for the `vessel` entity. Components
 * never touch HttpClient directly — they depend on this service, which owns the
 * URLs and request shapes. Note there is NO try/catch and NO token handling in
 * here: auth headers are attached by the auth interceptor and errors are
 * surfaced by the error interceptor, both registered once in app.config.ts.
 * That's the whole point of interceptors — cross-cutting concerns live in one
 * place instead of being repeated in every service method.
 */
@Injectable({ providedIn: 'root' })
export class VesselService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/vessels`;

  /**
   * List vessels, optionally filtered by a backend free-text search. The search
   * term is sent as a query param (`?search=...`) so the *server* does the
   * filtering — this is what the RxJS debounced search box calls on each
   * settled keystroke.
   */
  list(search?: string): Observable<Vessel[]> {
    // HttpParams builds a properly-encoded query string. We only attach the
    // param when there's actually a search term.
    let params = new HttpParams();
    if (search && search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<Vessel[]>(this.baseUrl, { params });
  }

  getById(id: string): Observable<Vessel> {
    return this.http.get<Vessel>(`${this.baseUrl}/${id}`);
  }

  create(input: VesselInput): Observable<Vessel> {
    return this.http.post<Vessel>(this.baseUrl, input);
  }

  update(id: string, input: Partial<VesselInput>): Observable<Vessel> {
    return this.http.patch<Vessel>(`${this.baseUrl}/${id}`, input);
  }
}
