import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth-interceptor';
import { errorInterceptor } from './core/interceptors/error-interceptor';

/**
 * The application's root providers. In a standalone app this replaces the old
 * root `AppModule` — `bootstrapApplication(App, appConfig)` in main.ts wires it
 * up. `provideHttpClient(withInterceptors([...]))` registers HttpClient plus our
 * two functional interceptors; order matters — the auth interceptor attaches the
 * token on the way out, then the error interceptor handles the response stream.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor, errorInterceptor]),
    ),
  ],
};
