/** The authenticated user, as returned by POST /api/auth/login and GET /api/auth/me. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  fleetId: string | null;
}

/** Shape of the POST /api/auth/login response body. */
export interface LoginResponse {
  token: string;
  user: User;
}

/** Credentials submitted by the login form. */
export interface Credentials {
  email: string;
  password: string;
}
