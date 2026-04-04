import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Waves, Eye, EyeOff, AlertCircle } from 'lucide-react'
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
    <div className="min-h-screen bg-navy-900 flex">
      {/* Left: Branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 p-12 relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-5">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

        {/* Ship silhouette */}
        <div className="absolute bottom-0 right-0 opacity-10">
          <svg viewBox="0 0 400 200" width="400" height="200">
            <path d="M20 160 L380 160 L360 120 L320 100 L280 90 L240 85 L200 80 L160 85 L120 90 L80 100 L40 120 Z" fill="white"/>
            <rect x="160" y="40" width="80" height="40" fill="white"/>
            <rect x="190" y="10" width="8" height="30" fill="white"/>
          </svg>
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center">
              <Waves className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl">VesselMind AI</h1>
              <p className="text-gray-400 text-sm">Maritime Intelligence Platform</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              AI-Powered<br />Fleet Intelligence
            </h2>
            <p className="text-gray-400 mt-4 text-lg leading-relaxed">
              Optimize routes, predict maintenance, ensure compliance, and reduce costs for your maritime fleet.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Avg Fuel Savings', value: '18%' },
              { label: 'CO2 Reduction', value: '22%' },
              { label: 'Maintenance Cost Saved', value: '$2.4M' },
              { label: 'Vessels Managed', value: '340+' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                <p className="text-teal-400 font-bold text-2xl">{value}</p>
                <p className="text-gray-400 text-sm mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-gray-600 text-sm">Trusted by leading oil & gas operators in SE Asia & Middle East</p>
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center">
              <Waves className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-xl">VesselMind AI</h1>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white">Welcome back</h2>
            <p className="text-gray-400 mt-1">Sign in to your fleet dashboard</p>
          </div>

          {/* Demo button */}
          <button
            onClick={handleDemo}
            disabled={demoLoading}
            className="w-full bg-teal-600/20 hover:bg-teal-600/30 border border-teal-600/50 text-teal-400 py-3 rounded-xl font-semibold transition-colors mb-6 flex items-center justify-center gap-2"
          >
            {demoLoading ? (
              <div className="w-4 h-4 border border-teal-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Waves className="w-4 h-4" />
            )}
            Try Demo Mode — PETRONAS Fleet
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 border-t border-navy-700" />
            <span className="text-gray-600 text-sm">or sign in</span>
            <div className="flex-1 border-t border-navy-700" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="captain@company.com"
                className="w-full bg-navy-800 border border-navy-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-teal-600 transition-colors text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-navy-800 border border-navy-700 rounded-lg px-4 py-2.5 pr-10 text-white placeholder-gray-600 focus:outline-none focus:border-teal-600 transition-colors text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-2.5 flex items-center justify-center gap-2"
            >
              {loading && <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />}
              Sign In
            </button>
          </form>

          <div className="mt-6 p-4 bg-navy-800 rounded-xl border border-navy-700">
            <p className="text-gray-500 text-xs font-medium mb-1.5">Demo Credentials</p>
            <p className="text-gray-400 text-xs">Email: <span className="text-teal-400 font-mono">demo@petronas.com</span></p>
            <p className="text-gray-400 text-xs">Password: <span className="text-teal-400 font-mono">demo123</span></p>
          </div>

          <p className="text-center text-gray-500 text-sm mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-teal-400 hover:text-teal-300 font-medium">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
