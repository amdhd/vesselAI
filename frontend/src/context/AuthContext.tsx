import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { User } from '@/lib/types'
import { MOCK_USER } from '@/lib/mockData'
import { authApi } from '@/lib/api'
import { clearSessionData, currentSessionScope, SESSION_CLEARED_EVENT } from '@/lib/sessionData'

interface AuthContextType {
  user: User | null
  token: string | null
  sessionId: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  loginDemo: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionChange = useRef(0)

  useEffect(() => {
    const reset = () => {
      sessionChange.current++
      setUser(null)
      setToken(null)
      setSessionId(null)
    }
    const restore = () => {
      sessionChange.current++
      if (!currentSessionScope()) {
        reset()
        return
      }
      setToken(localStorage.getItem('vm_token'))
      setUser(JSON.parse(localStorage.getItem('vm_user')!) as User)
      setSessionId(localStorage.getItem('vm_session_id'))
    }
    window.addEventListener(SESSION_CLEARED_EVENT, reset)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || ['vm_token', 'vm_user', 'vm_session_id'].includes(event.key)) restore()
    }
    window.addEventListener('storage', handleStorage)
    // Old unscoped sessions cannot prove who owns their retained data. Require
    // a fresh login once, rather than migrating private data to an assumed owner.
    if (currentSessionScope()) {
      restore()
      setIsLoading(false)
    } else {
      // No authenticated subtree mounts while unowned legacy data is removed.
      void clearSessionData().catch(() => {})
      setIsLoading(false)
    }
    return () => {
      window.removeEventListener(SESSION_CLEARED_EVENT, reset)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const cleanup = clearSessionData()
    const attempt = ++sessionChange.current
    await cleanup
    if (attempt !== sessionChange.current) throw new Error('Session changed during login')
    const saveSession = (nextToken: string, nextUser: User) => {
      if (attempt !== sessionChange.current) throw new Error('Session changed during login')
      const nextSessionId = crypto.randomUUID()
      localStorage.setItem('vm_token', nextToken)
      localStorage.setItem('vm_user', JSON.stringify(nextUser))
      localStorage.setItem('vm_session_id', nextSessionId)
      setToken(nextToken)
      setUser(nextUser)
      setSessionId(nextSessionId)
    }
    // Try real API first, fall back to demo mode. Use authApi (the shared axios
    // instance) so login hits the SAME backend/base URL as every other request —
    // a hardcoded '/api/auth/login' would bypass VITE_API_URL and could sign the
    // token on a different backend than the one that later verifies it (→ 401).
    try {
      const data = await authApi.login(email, password)
      saveSession(data.token, data.user)
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
      saveSession(demoToken, MOCK_USER)
    } else {
      throw new Error('Invalid credentials. Use demo@petronas.com / demo123')
    }
  }, [])

  const loginDemo = useCallback(async () => {
    await login('demo@petronas.com', 'demo123')
  }, [login])

  const logout = useCallback(async () => {
    sessionChange.current++
    setUser(null)
    setToken(null)
    setSessionId(null)
    await clearSessionData()
  }, [])

  const value: AuthContextType = {
    user,
    token,
    sessionId,
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
