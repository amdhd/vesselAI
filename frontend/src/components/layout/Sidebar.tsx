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

type NavItem = {
  to: string
  icon: typeof LayoutDashboard
  label: string
  exact?: boolean
}

const operationsItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { to: '/voyage', icon: Navigation, label: 'Voyage & Routes' },
  { to: '/maintenance', icon: Wrench, label: 'Maintenance' },
  { to: '/compliance', icon: FileCheck, label: 'Compliance' },
  { to: '/ports', icon: Anchor, label: 'Port Scheduling' },
]

const intelligenceItems: NavItem[] = [
  { to: '/knowledge', icon: BookOpen, label: 'Knowledge' },
  { to: '/sire', icon: ClipboardList, label: 'SIRE Inspection' },
]

export default function Sidebar() {
  const location = useLocation()

  const isActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to
    return location.pathname.startsWith(to)
  }

  const renderItem = ({ to, icon: Icon, label, exact }: NavItem) => {
    const active = isActive(to, exact)
    return (
      <NavLink
        key={to}
        to={to}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium border-l-2 transition-colors',
          active
            ? 'border-teal-600 bg-white/[0.045] text-[#eceef0]'
            : 'border-transparent text-[#8a919d] hover:text-[#eceef0] hover:bg-white/[0.025]',
        )}
      >
        <Icon className={cn('shrink-0', active ? 'text-teal-600' : 'text-[#5c6470]')} size={16} strokeWidth={1.6} />
        {label}
      </NavLink>
    )
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[236px] bg-navy-800 border-r border-navy-700 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-[18px] border-b border-navy-700 flex items-center gap-2.5">
        <div className="w-[30px] h-[30px] shrink-0 bg-[#12181a] border border-teal-600/40 rounded-[2px] flex items-center justify-center">
          <Waves className="w-4 h-4 text-teal-600" strokeWidth={1.6} />
        </div>
        <div className="leading-tight">
          <h1 className="text-[13.5px] font-semibold tracking-wide text-[#eceef0]">VesselMind AI</h1>
          <p className="text-[10.5px] text-[#5c6470] uppercase tracking-wider">Maritime Intelligence</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3.5">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#454b55] px-2.5 pt-1.5 pb-2">
          Operations
        </div>
        <div>{operationsItems.map(renderItem)}</div>

        <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#454b55] px-2.5 pt-[18px] pb-2">
          Intelligence
        </div>
        <div>{intelligenceItems.map(renderItem)}</div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-navy-700 text-[10.5px] text-[#454b55] leading-relaxed">
        VesselMind AI v0.0.1
        <br />
        Maritime Operations Platform
      </div>
    </aside>
  )
}
