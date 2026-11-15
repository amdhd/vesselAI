import { cn } from '@/lib/utils'

type BadgeVariant = 'healthy' | 'warning' | 'critical' | 'info' | 'expired' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variantColor: Record<BadgeVariant, string> = {
  healthy: 'text-status-green border-status-green/35 bg-status-green/[0.08]',
  warning: 'text-status-amber border-status-amber/35 bg-status-amber/[0.08]',
  critical: 'text-status-red border-status-red/40 bg-status-red/[0.08]',
  expired: 'text-status-red border-status-red/40 bg-status-red/[0.08]',
  info: 'text-ink-2 border-light/15 bg-light/[0.04]',
  default: 'text-muted border-light/10 bg-transparent',
}

const dotColor: Record<BadgeVariant, string> = {
  healthy: 'bg-status-green',
  warning: 'bg-status-amber',
  critical: 'bg-status-red',
  expired: 'bg-status-red',
  info: 'bg-ink-2',
  default: 'bg-faint',
}

// Status words: sentence case, a small dot, a pill. Never tracked capitals.
export default function Badge({ variant = 'default', children, className, dot = true }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border rounded-pill text-[12px] font-medium leading-5 px-2.5 whitespace-nowrap',
        variantColor[variant],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor[variant])} />}
      {typeof children === 'string' ? children.charAt(0).toUpperCase() + children.slice(1) : children}
    </span>
  )
}
