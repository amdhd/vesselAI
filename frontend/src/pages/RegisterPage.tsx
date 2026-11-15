import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react'
import { authApi } from '@/lib/api'
import AuthShell from '@/components/layout/AuthShell'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [company, setCompany] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    try {
      await authApi.register(name, email, password, company)
      navigate('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      headline="Join the fleet intelligence network"
      lead="Register your fleet and start optimizing operations with AI-powered insights."
      note="Trusted by leading oil & gas operators in SE Asia & Middle East"
      aside={
        <ul className="divide-y divide-day-ink/10">
          {[
            'AI-powered route optimization',
            'Predictive maintenance alerts',
            'Real-time compliance monitoring',
            'Automated port communications',
          ].map((text) => (
            <li key={text} className="flex items-center gap-3 py-3 text-[15px] text-day-ink">
              <CheckCircle className="w-4 h-4 shrink-0 text-day-muted" />
              {text}
            </li>
          ))}
        </ul>
      }
    >
      <div className="mb-7">
        <h2 className="text-[28px] leading-tight text-ink">Create your account</h2>
        <p className="text-muted mt-1.5 text-[15px]">Register to manage your fleet with AI</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="flex items-center gap-2 px-3.5 py-3 bg-critical/[0.08] border border-critical/35 rounded-inner text-critical text-[14px]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div>
          <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Full name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Captain Ahmad Razali"
            className="input w-full min-h-[44px]"
            required
          />
        </div>

        <div>
          <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="captain@company.com"
            className="input w-full min-h-[44px]"
            required
          />
        </div>

        <div>
          <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Company name</label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="PETRONAS, Shell, etc."
            className="input w-full min-h-[44px]"
            required
          />
        </div>

        <div>
          <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Password</label>
          <div className="relative">
            <input
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
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-faint hover:text-ink-2 hover:bg-light/[0.05]"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Confirm password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="input w-full min-h-[44px] pr-11"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-faint hover:text-ink-2 hover:bg-light/[0.05]"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {confirmPassword && password !== confirmPassword && (
            <p className="text-critical text-xs mt-1">Passwords do not match</p>
          )}
          {confirmPassword && password === confirmPassword && confirmPassword.length > 0 && (
            <p className="text-accent text-xs mt-1 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Passwords match
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full btn-primary min-h-[46px] !mt-6"
        >
          {loading && <div className="w-4 h-4 border-2 border-accent-ink border-t-transparent rounded-full animate-spin" />}
          Create Account
        </button>
      </form>

      <p className="text-center text-muted text-[14px] mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-accent hover:text-accent-hi font-medium underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}
