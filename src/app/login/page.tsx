'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { LogoMark } from '@/components/ui/logo'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    setLoading(false)

    if (!result || result.error) {
      setError('Credenciales inválidas. Verificá tu email y contraseña.')
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0c1e3c] px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <LogoMark size={32} />
            <span
              className="text-2xl font-semibold text-[#0c1e3c]"
              style={{ letterSpacing: '-0.5px' }}
            >
              cribal
            </span>
          </div>
          <p className="mt-2 text-sm text-[#64748b]">Inteligencia de oportunidades</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-[#0c1e3c]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-[#0c1e3c]"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[#dc2626]">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#06b6d4] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0891b2] active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  )
}
