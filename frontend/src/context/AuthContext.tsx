import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { User } from '@/lib/types'
import { MOCK_USER } from '@/lib/mockData'
import { authApi } from '@/lib/api'

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  loginDemo: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem('vm_token')
    const storedUser = localStorage.getItem('vm_user')
    if (storedToken && storedUser) {
      setToken(storedToken)
      try {
        setUser(JSON.parse(storedUser) as User)
      } catch {
        localStorage.removeItem('vm_user')
      }
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    // Try real API first, fall back to demo mode. Use authApi (the shared axios
    // instance) so login hits the SAME backend/base URL as every other request —
    // a hardcoded '/api/auth/login' would bypass VITE_API_URL and could sign the
    // token on a different backend than the one that later verifies it (→ 401).
    try {
      const data = await authApi.login(email, password)
      setToken(data.token)
      setUser(data.user)
      localStorage.setItem('vm_token', data.token)
      localStorage.setItem('vm_user', JSON.stringify(data.user))
      return
    } catch (err) {
      // Production has the demo account seeded into the database, so a failure
      // here is a REAL failure. Faking a session would be worse than useless:
      // the invented token below is not a signed JWT, so the UI would look
      // logged in while every subsequent request 401s — including the analytics
      // calls, which then surface as "Couldn't reach the analytics API".
      // Surface the error instead and let the user see what actually happened.
      if (!import.meta.env.DEV) throw err
      // Dev only: fall through to the offline demo session below, so the UI can
      // be worked on with no backend running.
    }

    // Demo fallback (development only — see above)
    if (email === 'demo@petronas.com' && password === 'demo123') {
      const demoToken = 'demo_token_' + Date.now()
      setToken(demoToken)
      setUser(MOCK_USER)
      localStorage.setItem('vm_token', demoToken)
      localStorage.setItem('vm_user', JSON.stringify(MOCK_USER))
    } else {
      throw new Error('Invalid credentials. Use demo@petronas.com / demo123')
    }
  }, [])

  const loginDemo = useCallback(async () => {
    await login('demo@petronas.com', 'demo123')
  }, [login])

  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('vm_token')
    localStorage.removeItem('vm_user')
  }, [])

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    login,
    loginDemo,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
