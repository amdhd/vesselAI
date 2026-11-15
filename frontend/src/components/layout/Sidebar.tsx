import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Navigation,
  Wrench,
  FileCheck,
  Anchor,
  BookOpen,
  ClipboardList,
  BarChart3,
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
  { to: '/analytics', icon: BarChart3, label: 'Fleet Analytics' },
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
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 min-h-[38px] px-3 rounded-inner text-[13.5px] font-medium transition-colors duration-micro',
          active
            ? 'bg-light/[0.06] text-ink shadow-[inset_0_1px_0_oklch(var(--c-light)/0.06)]'
            : 'text-muted hover:text-ink hover:bg-light/[0.03]',
        )}
      >
        <Icon className={cn('shrink-0', active ? 'text-accent' : 'text-faint group-hover:text-ink-2')} size={17} strokeWidth={1.6} />
        <span className="flex-1">{label}</span>
        {active && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />}
      </NavLink>
    )
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[248px] bg-shade/60 border-r border-light/[0.06] flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center gap-3">
        <div className="w-8 h-8 shrink-0 rounded-full bg-accent/15 ring-1 ring-accent/30 flex items-center justify-center">
          <Waves className="w-4 h-4 text-accent" strokeWidth={1.8} />
        </div>
        <div className="leading-tight">
          <p className="font-display text-[15px] font-medium tracking-[-0.01em] text-ink">VesselMind AI</p>
          <p className="text-[12px] text-faint">Maritime intelligence</p>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pt-4 pb-3">
        <p className="text-[12px] font-medium text-faint px-3 pb-2">Operations</p>
        <div className="space-y-0.5">{operationsItems.map(renderItem)}</div>

        <p className="text-[12px] font-medium text-faint px-3 pt-6 pb-2">Intelligence</p>
        <div className="space-y-0.5">{intelligenceItems.map(renderItem)}</div>
      </nav>

      {/* Footer */}
      <div className="mx-3 mb-3 px-3 py-3 rounded-inner border-t border-light/[0.06] text-[12px] text-faint leading-relaxed">
        VesselMind AI v0.0.1
        <br />
        Maritime operations platform
      </div>
    </aside>
  )
}
