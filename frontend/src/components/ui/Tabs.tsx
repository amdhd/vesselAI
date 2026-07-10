import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export interface TabItem<T extends string = string> {
  id: T
  label: string
  icon?: LucideIcon
}

interface TabsProps<T extends string = string> {
  tabs: readonly TabItem<T>[]
  activeId: T
  onChange: (id: T) => void
  className?: string
}

export default function Tabs<T extends string = string>({ tabs, activeId, onChange, className }: TabsProps<T>) {
  return (
    <div className={cn('flex items-center gap-0.5 border-b border-navy-700', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-[18px] py-[11px] text-[13px] font-medium border-b-2 -mb-px transition-colors',
              active ? 'border-teal-600 text-teal-400' : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
