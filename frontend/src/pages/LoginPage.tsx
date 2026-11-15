import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Waves, Eye, EyeOff, AlertCircle } from 'lucide-react'
import AuthShell from '@/components/layout/AuthShell'
import { useAuth } from '@/context/AuthContext'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, loginDemo } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDemo = async () => {
    setError('')
    setDemoLoading(true)
    try {
      await loginDemo()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo login failed')
    } finally {
      setDemoLoading(false)
    }
  }

  return (
    <AuthShell
      headline="AI-powered fleet intelligence"
      lead="Optimize routes, predict maintenance, ensure compliance, and reduce costs for your maritime fleet."
      note="Trusted by leading oil & gas operators in SE Asia & Middle East"
      aside={
        <dl className="grid grid-cols-2 gap-x-8">
          {[
            { label: 'Avg fuel savings', value: '18%' },
            { label: 'CO2 reduction', value: '22%' },
            { label: 'Maintenance cost saved', value: '$2.4M' },
            { label: 'Vessels managed', value: '340+' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-3 border-b border-day-ink/10 [&:nth-last-child(-n+2)]:border-b-0">
              <dt className="text-[14px] text-day-muted">{label}</dt>
              <dd className="font-display text-[22px] font-medium text-day-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      }
    >
      <div className="mb-7">
        <h2 className="text-[28px] leading-tight text-ink">Welcome back</h2>
        <p className="text-muted mt-1.5 text-[15px]">Sign in to your fleet dashboard</p>
      </div>

      {/* Demo button */}
      <button
        onClick={handleDemo}
        disabled={demoLoading}
        className="btn-secondary w-full min-h-[46px] mb-6 text-ink"
      >
        {demoLoading ? (
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        ) : (
          <Waves className="w-4 h-4 text-accent" />
        )}
        Try Demo Mode: PETRONAS Fleet
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 border-t border-light/[0.08]" />
        <span className="text-faint text-[13px]">or sign in</span>
        <div className="flex-1 border-t border-light/[0.08]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-center gap-2 px-3.5 py-3 bg-critical/[0.08] border border-critical/35 rounded-inner text-critical text-[14px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div>
          <label htmlFor="login-email" className="block text-[13px] font-medium text-ink-2 mb-1.5">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="captain@company.com"
            className="input w-full min-h-[44px]"
            required
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-[13px] font-medium text-ink-2 mb-1.5">Password</label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input w-full min-h-[44px] pr-11"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide typed characters' : 'Show typed characters'}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-faint hover:text-ink-2 hover:bg-light/[0.05]"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full btn-primary min-h-[46px] !mt-6"
        >
          {loading && <div className="w-4 h-4 border-2 border-accent-ink border-t-transparent rounded-full animate-spin" />}
          Sign In
        </button>
      </form>

      <div className="mt-6 px-4 py-3.5 rounded-inner bg-light/[0.04] border border-light/[0.06] text-[13px]">
        <p className="text-muted font-medium mb-1">Demo credentials</p>
        <p className="text-ink-2">Email: <span className="text-accent">demo@petronas.com</span></p>
        <p className="text-ink-2">Password: <span className="text-accent">demo123</span></p>
      </div>

      <p className="text-center text-muted text-[14px] mt-6">
        Don't have an account?{' '}
        <Link to="/register" className="text-accent hover:text-accent-hi font-medium underline-offset-4 hover:underline">
          Register
        </Link>
      </p>
    </AuthShell>
  )
}
