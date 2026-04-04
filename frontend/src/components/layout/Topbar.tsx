import { useState, useRef, useEffect } from 'react'
import { Bell, ChevronDown, LogOut, User, Ship, X, CheckCheck } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useFleet } from '@/context/FleetContext'
import { MOCK_NOTIFICATIONS } from '@/lib/mockData'
import { cn, timeAgo } from '@/lib/utils'
import type { Notification } from '@/lib/types'

const severityIcon: Record<string, string> = {
  critical: '🔴',
  warning: '⚠️',
  success: '✅',
  info: 'ℹ️',
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
    <header className="fixed top-0 left-60 right-0 h-14 bg-navy-950 border-b border-navy-800 flex items-center justify-between px-6 z-20">
      {/* Vessel selector */}
      <div ref={vesselRef} className="relative">
        <button
          onClick={() => setVesselMenuOpen(!vesselMenuOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-navy-800 hover:bg-navy-700 transition-colors border border-navy-700"
        >
          <Ship className="w-4 h-4 text-teal-400" />
          <span className="text-white text-sm font-medium">
            {selectedVessel?.name || 'Select Vessel'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        </button>
        {vesselMenuOpen && (
          <div className="absolute top-full left-0 mt-1.5 w-64 bg-navy-800 border border-navy-700 rounded-xl shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-navy-700">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Select Vessel</p>
            </div>
            {vessels.map((v) => (
              <button
                key={v.id}
                onClick={() => { setSelectedVessel(v); setVesselMenuOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-navy-700 transition-colors',
                  selectedVessel?.id === v.id ? 'text-teal-400' : 'text-white',
                )}
              >
                <div className="flex items-center gap-2">
                  <Ship className="w-3.5 h-3.5" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{v.name}</p>
                    <p className="text-gray-500 text-xs">IMO {v.imo}</p>
                  </div>
                </div>
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded font-medium',
                  v.status === 'underway' ? 'text-green-400 bg-green-900/30' :
                  v.status === 'at_anchor' ? 'text-amber-400 bg-amber-900/30' :
                  'text-blue-400 bg-blue-900/30'
                )}>
                  {v.status.replace('_', ' ')}
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
            className="relative w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-navy-800 hover:text-white transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-96 bg-navy-800 border border-navy-700 rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-navy-700">
                <div>
                  <p className="text-white font-semibold text-sm">Notifications</p>
                  <p className="text-gray-500 text-xs">{unreadCount} unread</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={markAllRead} className="text-teal-400 text-xs hover:text-teal-300 flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" />
                    Mark all read
                  </button>
                  <button onClick={() => setNotifOpen(false)} className="text-gray-500 hover:text-gray-300">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-navy-700">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={cn(
                      'px-4 py-3 cursor-pointer hover:bg-navy-700 transition-colors',
                      !n.read && 'bg-navy-750',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base mt-0.5">{severityIcon[n.severity]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={cn('text-sm font-medium truncate', !n.read ? 'text-white' : 'text-gray-300')}>
                            {n.title}
                          </p>
                          {!n.read && <span className="w-1.5 h-1.5 bg-teal-400 rounded-full shrink-0" />}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{n.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {n.vesselName && (
                            <span className="text-xs text-teal-500">{n.vesselName}</span>
                          )}
                          <span className="text-xs text-gray-600">{timeAgo(n.createdAt)}</span>
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
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-navy-800 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold">
              {user?.name.charAt(0) || 'U'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-white text-xs font-medium leading-tight">{user?.name}</p>
              <p className="text-gray-500 text-[10px]">{user?.role.replace('_', ' ')}</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>

          {userMenuOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-52 bg-navy-800 border border-navy-700 rounded-xl shadow-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-navy-700">
                <p className="text-white font-medium text-sm">{user?.name}</p>
                <p className="text-gray-400 text-xs">{user?.email}</p>
                <p className="text-teal-500 text-xs capitalize">{user?.company}</p>
              </div>
              <div className="py-1">
                <button className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-300 hover:bg-navy-700 hover:text-white transition-colors">
                  <User className="w-4 h-4" />
                  Profile Settings
                </button>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
