import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  change?: number
  changeLabel?: string
  icon?: LucideIcon
  iconColor?: string
  iconBg?: string
  className?: string
  variant?: 'default' | 'teal' | 'amber' | 'red'
}

const variantMap = {
  default: { icon: 'bg-navy-700', value: 'text-white' },
  teal: { icon: 'bg-teal-600/20', value: 'text-teal-400' },
  amber: { icon: 'bg-amber-600/20', value: 'text-amber-400' },
  red: { icon: 'bg-red-600/20', value: 'text-red-400' },
}

export default function StatCard({
  title,
  value,
  subtitle,
  change,
  changeLabel,
  icon: Icon,
  iconColor,
  iconBg,
  className,
  variant = 'default',
}: StatCardProps) {
  const vars = variantMap[variant]
  const isPositive = change !== undefined && change >= 0

  return (
    <div className={cn('card flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between">
        <p className="text-gray-400 text-sm font-medium">{title}</p>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', iconBg || vars.icon)}>
            <Icon className={cn('w-5 h-5', iconColor || 'text-gray-400')} />
          </div>
        )}
      </div>
      <div>
        <p className={cn('text-2xl font-bold', vars.value)}>{value}</p>
        {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {change !== undefined && (
        <div className={cn('flex items-center gap-1 text-xs', isPositive ? 'text-green-400' : 'text-red-400')}>
          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{isPositive ? '+' : ''}{change.toFixed(1)}%</span>
          {changeLabel && <span className="text-gray-500">{changeLabel}</span>}
        </div>
      )}
    </div>
  )
}
