import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import LoginPage from './LoginPage'

// authApi.login is the one network seam this page has; mocking it lets the
// test exercise the real form, real AuthContext, and real navigation without
// a backend.
vi.mock('@/lib/api', () => ({
  authApi: { login: vi.fn() },
}))
import { authApi } from '@/lib/api'

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Dashboard</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(authApi.login).mockReset()
})

describe('LoginPage', () => {
  it('renders the sign-in form and the demo-mode button', () => {
    renderLoginPage()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try demo mode/i })).toBeInTheDocument()
  })

  it('signs in with real credentials and navigates to the dashboard', async () => {
    const user = userEvent.setup()
    vi.mocked(authApi.login).mockResolvedValue({
      token: 'jwt-abc',
      user: { id: 'u1', email: 'captain@company.com', name: 'Captain', role: 'fleet_manager', fleetId: 'fleet-001' },
    } as any)

    renderLoginPage()
    await user.type(screen.getByLabelText(/email/i), 'captain@company.com')
    await user.type(screen.getByLabelText(/password/i), 'correct-password')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    expect(authApi.login).toHaveBeenCalledWith('captain@company.com', 'correct-password')
    expect(localStorage.getItem('vm_token')).toBe('jwt-abc')
  })

  it('falls back to the demo account when the API is unreachable and credentials match', async () => {
    const user = userEvent.setup()
    vi.mocked(authApi.login).mockRejectedValue(new Error('network error'))

    renderLoginPage()
    await user.type(screen.getByLabelText(/email/i), 'demo@petronas.com')
    await user.type(screen.getByLabelText(/password/i), 'demo123')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    expect(localStorage.getItem('vm_token')).toMatch(/^demo_token_/)
  })

  it('shows an error and stays on the page for bad credentials with no API', async () => {
    const user = userEvent.setup()
    vi.mocked(authApi.login).mockRejectedValue(new Error('network error'))

    renderLoginPage()
    await user.type(screen.getByLabelText(/email/i), 'wrong@company.com')
    await user.type(screen.getByLabelText(/password/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('the demo-mode button logs in without touching the email/password fields', async () => {
    const user = userEvent.setup()
    vi.mocked(authApi.login).mockRejectedValue(new Error('network error'))

    renderLoginPage()
    await user.click(screen.getByRole('button', { name: /try demo mode/i }))

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())
    const stored = JSON.parse(localStorage.getItem('vm_user') ?? '{}')
    expect(stored.email).toBe('demo@petronas.com')
  })
})
