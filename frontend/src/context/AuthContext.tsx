import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { User } from '@/lib/types'
import { MOCK_USER } from '@/lib/mockData'
import { authApi } from '@/lib/api'
import { clearSessionData, currentSessionScope, SESSION_CLEARED_EVENT } from '@/lib/sessionData'

interface AuthContextType {
  user: User | null
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
  const [isLoading, setIsLoading] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionChange = useRef(0)

  useEffect(() => {
    const reset = () => {
      sessionChange.current++
      setUser(null)
      setSessionId(null)
    }
    const restore = () => {
      sessionChange.current++
      if (!currentSessionScope()) {
        reset()
        return
      }
      setUser(JSON.parse(localStorage.getItem('vm_user')!) as User)
      setSessionId(localStorage.getItem('vm_session_id'))
    }
    window.addEventListener(SESSION_CLEARED_EVENT, reset)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || ['vm_user', 'vm_session_id'].includes(event.key)) restore()
    }
    window.addEventListener('storage', handleStorage)
    // Earlier versions kept the login token here, readable by any script on the
    // page. The session is an httpOnly cookie now; drop any leftover token so a
    // long-lived credential does not sit in storage after the upgrade.
    localStorage.removeItem('vm_token')
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
    // Records WHO is signed in, never the credential: the backend set the
    // session as an httpOnly cookie, which this code cannot see or store.
    const saveSession = (nextUser: User) => {
      if (attempt !== sessionChange.current) throw new Error('Session changed during login')
      const nextSessionId = crypto.randomUUID()
      localStorage.setItem('vm_user', JSON.stringify(nextUser))
      localStorage.setItem('vm_session_id', nextSessionId)
      setUser(nextUser)
      setSessionId(nextSessionId)
    }
    // Try real API first, fall back to demo mode. Use authApi (the shared axios
    // instance) so login hits the SAME backend/base URL as every other request —
    // a hardcoded '/api/auth/login' would bypass VITE_API_URL and could sign the
    // token on a different backend than the one that later verifies it (→ 401).
    try {
      const data = await authApi.login(email, password)
      saveSession(data.user)
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

    // Demo fallback (development only — see above). There is no backend, so
    // no cookie and no credential at all: the UI can be worked on, and any
    // real request will 401.
    if (email === 'demo@petronas.com' && password === 'demo123') {
      saveSession(MOCK_USER)
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
    setSessionId(null)
    // Script cannot delete an httpOnly cookie, so ask the backend to. Best
    // effort: signing out locally must not depend on the network.
    try {
      await authApi.logout()
    } catch {
      /* offline or already expired: local data is still cleared below */
    }
    await clearSessionData()
  }, [])

  const value: AuthContextType = {
    user,
    sessionId,
    isAuthenticated: !!user,
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
