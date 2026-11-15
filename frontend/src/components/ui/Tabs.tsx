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
  // Dusk tabs: a ruled list with a dot on the chosen one, never boxed segments.
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-light/[0.07] overflow-x-auto', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-4 min-h-[44px] text-[14px] font-medium whitespace-nowrap transition-colors duration-micro',
              active ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {Icon && <Icon className={cn('w-4 h-4', active ? 'text-accent' : 'text-faint')} strokeWidth={1.7} />}
            {tab.label}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-4 right-4 -bottom-px h-[2px] rounded-full bg-accent transition-opacity duration-short',
                active ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
