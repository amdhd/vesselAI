import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import type { CIIRating } from './types'

// ─── Class Name Merger ─────────────────────────────────────────────────────────

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date Formatting ──────────────────────────────────────────────────────────

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy')
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy HH:mm')
}

export function formatTime(date: string | Date): string {
  return format(new Date(date), 'HH:mm')
}

export function timeAgo(date: string | Date): string {
  const now = new Date()
  const then = new Date(date)
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ─── Number Formatting ────────────────────────────────────────────────────────

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`
  }
  return `$${formatNumber(amount)}`
}

export function formatCurrencyFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

// ─── Maritime Units ───────────────────────────────────────────────────────────

export function formatDistance(nm: number): string {
  return `${formatNumber(nm)} nm`
}

export function formatSpeed(knots: number): string {
  return `${knots.toFixed(1)} kn`
}

export function formatWeight(mt: number): string {
  return `${formatNumber(mt, 1)} MT`
}

export function formatFuel(mt: number): string {
  return `${mt.toFixed(1)} MT`
}

// ─── Color Helpers ────────────────────────────────────────────────────────────

export function getCIIColor(rating: CIIRating): string {
  switch (rating) {
    case 'A':
    case 'B': return 'text-status-green'
    case 'C': return 'text-status-amber'
    case 'D':
    case 'E': return 'text-status-red'
    default: return 'text-gray-400'
  }
}

export function getCIIBgColor(rating: CIIRating): string {
  switch (rating) {
    case 'A':
    case 'B': return 'bg-transparent border-status-green text-status-green'
    case 'C': return 'bg-transparent border-status-amber text-status-amber'
    case 'D':
    case 'E': return 'bg-transparent border-status-red text-status-red'
    default: return 'bg-transparent border-navy-700 text-gray-400'
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy':
    case 'underway':
    case 'on_schedule':
    case 'active':
      return 'text-status-green'
    case 'warning':
    case 'at_anchor':
    case 'at_risk':
      return 'text-status-amber'
    case 'critical':
    case 'delayed':
    case 'expired':
      return 'text-status-red'
    case 'offline':
    case 'off_hire':
      return 'text-gray-400'
    case 'in_port':
      return 'text-teal-400'
    default:
      return 'text-gray-400'
  }
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'healthy':
    case 'active':
    case 'indexed':
    case 'valid':
      return 'badge-healthy'
    case 'warning':
    case 'expiring_soon':
    case 'processing':
      return 'badge-warning'
    case 'critical':
    case 'expired':
    case 'error':
      return 'badge-critical'
    default:
      return 'badge-info'
  }
}

export function getHealthColor(score: number): string {
  if (score >= 80) return 'text-status-green'
  if (score >= 60) return 'text-status-amber'
  return 'text-status-red'
}

export function getHealthBg(score: number): string {
  if (score >= 80) return '#4a9d6f'
  if (score >= 60) return '#c99a54'
  return '#a8443b'
}

export function getCongestionColor(level: string): string {
  switch (level) {
    case 'low': return 'badge-healthy'
    case 'medium': return 'badge-info'
    case 'high': return 'badge-warning'
    case 'congested': return 'badge-critical'
    default: return 'badge-info'
  }
}

// ─── CO2 Calculation ──────────────────────────────────────────────────────────

const CO2_FACTORS: Record<string, number> = {
  HFO: 3.114,
  VLSFO: 3.151,
  MGO: 3.206,
  LNG: 2.750,
}

export function calculateCO2(fuelMT: number, fuelType: string): number {
  const factor = CO2_FACTORS[fuelType] ?? 3.114
  return fuelMT * factor
}

// ─── Vessel ID mapping ────────────────────────────────────────────────────────
// Frontend mock uses 'v1/v2/v3'; backend routes use 'vessel-001/vessel-002/vessel-003'
const VESSEL_ID_MAP: Record<string, string> = {
  v1: 'vessel-001',
  v2: 'vessel-002',
  v3: 'vessel-003',
}

export function toBackendVesselId(id: string | undefined, fallback = 'vessel-001'): string {
  if (!id) return fallback
  return VESSEL_ID_MAP[id] ?? id
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function fileSizeFormat(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}
