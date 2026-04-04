import { cn } from '@/lib/utils'

type BadgeVariant = 'healthy' | 'warning' | 'critical' | 'info' | 'expired' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  healthy: 'badge-healthy',
  warning: 'badge-warning',
  critical: 'badge-critical',
  info: 'badge-info',
  expired: 'badge-critical',
  default: 'bg-navy-700 text-gray-300 border border-navy-600 text-xs px-2 py-0.5 rounded-full',
}

export default function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn(variantClasses[variant], className)}>
      {children}
    </span>
  )
}
