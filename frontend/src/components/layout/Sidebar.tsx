import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Navigation,
  Wrench,
  FileCheck,
  Anchor,
  BookOpen,
  ClipboardList,
  Waves,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/voyage', icon: Navigation, label: 'Voyage & Routes' },
  { to: '/maintenance', icon: Wrench, label: 'Maintenance' },
  { to: '/compliance', icon: FileCheck, label: 'Compliance' },
  { to: '/ports', icon: Anchor, label: 'Port Scheduling' },
  { to: '/knowledge', icon: BookOpen, label: 'Knowledge' },
  { to: '/sire', icon: ClipboardList, label: 'SIRE Inspection' },
]

export default function Sidebar() {
  const location = useLocation()

  const isActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to
    return location.pathname.startsWith(to)
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-navy-950 border-r border-navy-800 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-navy-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
            <Waves className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">VesselMind AI</h1>
            <p className="text-gray-500 text-xs">Maritime Intelligence</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map(({ to, icon: Icon, label, exact }) => {
            const active = isActive(to, exact)
            return (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-teal-600/20 text-teal-400 border border-teal-600/30'
                    : 'text-gray-400 hover:bg-navy-800 hover:text-white',
                )}
              >
                <Icon className={cn('w-4.5 h-4.5', active ? 'text-teal-400' : 'text-gray-500')} size={18} />
                {label}
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-navy-800">
        <p className="text-gray-600 text-xs">VesselMind AI v0.0.1</p>
        <p className="text-gray-700 text-xs">Maritime SaaS Platform</p>
      </div>
    </aside>
  )
}
