import { cn } from '@/lib/utils'

type BadgeVariant = 'healthy' | 'warning' | 'critical' | 'info' | 'expired' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variantColor: Record<BadgeVariant, string> = {
  healthy: 'text-status-green border-status-green',
  warning: 'text-status-amber border-status-amber',
  critical: 'text-status-red border-status-red',
  expired: 'text-status-red border-status-red',
  info: 'text-teal-400 border-teal-600',
  default: 'text-gray-400 border-navy-700',
}

const dotColor: Record<BadgeVariant, string> = {
  healthy: 'bg-status-green',
  warning: 'bg-status-amber',
  critical: 'bg-status-red',
  expired: 'bg-status-red',
  info: 'bg-teal-400',
  default: 'bg-gray-500',
}

export default function Badge({ variant = 'default', children, className, dot = true }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border bg-transparent rounded-[2px] text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 whitespace-nowrap',
        variantColor[variant],
        className,
      )}
    >
      {dot && <span className={cn('w-[5px] h-[5px] shrink-0', dotColor[variant])} />}
      {children}
    </span>
  )
}
