import { useState, useRef, useEffect } from 'react'
import { Bell, ChevronDown, LogOut, User, Ship, X, CheckCheck, AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useFleet } from '@/context/FleetContext'
import { MOCK_NOTIFICATIONS } from '@/lib/mockData'
import { cn, timeAgo } from '@/lib/utils'
import type { Notification } from '@/lib/types'

const severityIcon: Record<string, { icon: LucideIcon; className: string }> = {
  critical: { icon: AlertCircle, className: 'text-critical' },
  warning: { icon: AlertTriangle, className: 'text-apricot' },
  success: { icon: CheckCircle2, className: 'text-accent' },
  info: { icon: Info, className: 'text-ink-2' },
}

export default function Topbar() {
  const { user, logout } = useAuth()
  const { vessels, selectedVessel, setSelectedVessel } = useFleet()
  const [notifOpen, setNotifOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [vesselMenuOpen, setVesselMenuOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(MOCK_NOTIFICATIONS)

  const notifRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const vesselRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const markRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserMenuOpen(false)
      if (vesselRef.current && !vesselRef.current.contains(e.target as Node)) setVesselMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header className="fixed top-0 left-[248px] right-0 h-16 bg-paper/75 backdrop-blur-xl backdrop-saturate-150 border-b border-light/[0.06] flex items-center justify-between px-10 z-20">
      {/* Vessel selector */}
      <div ref={vesselRef} className="relative">
        <button
          onClick={() => setVesselMenuOpen(!vesselMenuOpen)}
          className="flex items-center gap-2.5 min-h-[38px] pl-3 pr-3.5 rounded-pill bg-light/[0.04] hover:bg-light/[0.07] transition-colors border border-light/[0.08] text-[13.5px] font-medium"
        >
          <Ship className="w-3.5 h-3.5 text-accent" strokeWidth={1.8} />
          <span className="text-ink-2">
            {selectedVessel?.name || 'Select vessel'}
          </span>
          <ChevronDown className="w-3 h-3 text-faint" />
        </button>
        {vesselMenuOpen && (
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-paper-2 border border-light/[0.08] rounded-card shadow-pop overflow-hidden z-40">
            <div className="px-3 py-2 border-b border-rule">
              <p className="text-[12px] text-faint font-medium">Select vessel</p>
            </div>
            {vessels.map((v) => (
              <button
                key={v.id}
                onClick={() => { setSelectedVessel(v); setVesselMenuOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-paper-3 transition-colors',
                  selectedVessel?.id === v.id ? 'text-accent' : 'text-ink',
                )}
              >
                <div className="flex items-center gap-2">
                  <Ship className="w-3.5 h-3.5" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{v.name}</p>
                    <p className="text-faint text-xs">IMO {v.imo}</p>
                  </div>
                </div>
                <span className={cn(
                  v.status === 'underway' ? 'badge-healthy' :
                  v.status === 'at_anchor' ? 'badge-warning' :
                  'badge-info'
                )}>
                  {v.status.charAt(0).toUpperCase() + v.status.slice(1).replace('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative w-10 h-10 rounded-full flex items-center justify-center text-muted hover:bg-paper-2 hover:text-ink transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 bg-apricot text-accent-ink text-[10.5px] rounded-full flex items-center justify-center font-semibold tabular-nums ring-2 ring-paper">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-96 bg-paper-2 border border-light/[0.08] rounded-card shadow-pop overflow-hidden z-40">
              <div className="flex items-center justify-between px-4 py-3 border-b border-rule">
                <div>
                  <p className="text-ink font-semibold text-sm">Notifications</p>
                  <p className="text-faint text-xs">{unreadCount} unread</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={markAllRead} className="text-accent text-xs hover:text-accent-hi flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" />
                    Mark all read
                  </button>
                  <button onClick={() => setNotifOpen(false)} className="text-faint hover:text-ink-2">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-rule">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={cn(
                      'px-4 py-3 cursor-pointer hover:bg-paper-3 transition-colors',
                      !n.read && 'bg-paper-3',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {(() => {
                        const s = severityIcon[n.severity] ?? severityIcon.info
                        const SevIcon = s.icon
                        return <SevIcon className={cn('w-4 h-4 mt-0.5 shrink-0', s.className)} aria-label={n.severity} />
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('text-sm font-medium truncate', !n.read ? 'text-ink' : 'text-ink-2')}>
                            {n.title}
                          </p>
                          {!n.read && <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />}
                        </div>
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.vesselName && (
                            <span className="text-xs text-accent">{n.vesselName}</span>
                          )}
                          <span className="text-xs text-faint-2">{timeAgo(n.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-pill hover:bg-light/[0.05] transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-ink text-xs font-semibold">
              {user?.name.charAt(0) || 'U'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-ink text-xs font-medium leading-tight">{user?.name}</p>
              <p className="text-faint text-[11px]">{user?.role.replace('_', ' ')}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-muted" />
          </button>

          {userMenuOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-52 bg-paper-2 border border-light/[0.08] rounded-card shadow-pop overflow-hidden z-40">
              <div className="px-4 py-3 border-b border-rule">
                <p className="text-ink font-medium text-sm">{user?.name}</p>
                <p className="text-muted text-xs">{user?.email}</p>
                <p className="text-accent text-xs capitalize">{user?.company}</p>
              </div>
              <div className="py-1">
                <button className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-ink-2 hover:bg-paper-3 hover:text-ink transition-colors">
                  <User className="w-4 h-4" />
                  Profile settings
                </button>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-status-red hover:bg-status-red/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
