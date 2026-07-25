'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { TagInput } from '@/components/ui/tag-input'
import { registerCompany } from '@/lib/actions/auth'

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '200+']
const STEP_LABELS = ['Tu empresa', 'Tu cuenta', 'Qué buscás']

const inputClass =
  'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]'
const labelClass = 'mb-1 block text-sm font-medium text-[#111827]'

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [companyName, setCompanyName] = useState('')
  const [description, setDescription] = useState('')
  const [industry, setIndustry] = useState('')
  const [companySize, setCompanySize] = useState(COMPANY_SIZES[0])
  // Step 2
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Step 3
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [minimumScore, setMinimumScore] = useState(7)
  const [notificationEmail, setNotificationEmail] = useState('')

  function validateStep(current: number): string | null {
    if (current === 0) {
      if (!companyName.trim()) return 'El nombre de la empresa es obligatorio'
    }
    if (current === 1) {
      if (!userName.trim()) return 'Tu nombre es obligatorio'
      if (!email.trim()) return 'El email es obligatorio'
      if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
      if (password !== confirmPassword) return 'Las contraseñas no coinciden'
    }
    return null
  }

  function goNext() {
    const validation = validateStep(step)
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    if (step === 1 && !notificationEmail) setNotificationEmail(email)
    setStep((s) => Math.min(2, s + 1))
  }

  function goBack() {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)

    // Fold the non-persisted UI fields into the description.
    const extras = [
      industry.trim() ? `Sector: ${industry.trim()}` : '',
      `Tamaño: ${companySize}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const fullDescription = [description.trim(), extras ? `(${extras})` : '']
      .filter(Boolean)
      .join(' ')

    const result = await registerCompany({
      companyName,
      description: fullDescription,
      userName,
      email,
      password,
      capabilities,
      minimumScore,
      notificationEmail: notificationEmail || email,
    })

    if (!result.success) {
      setLoading(false)
      setError(result.error ?? 'No se pudo crear la cuenta')
      return
    }

    // Auto sign-in, then land on the dashboard with the onboarding banner.
    const signInResult = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    })

    setLoading(false)

    if (!signInResult || signInResult.error) {
      // Account created but sign-in failed — send them to login.
      router.push('/login')
      return
    }

    router.push('/?welcome=1')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 py-10">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-[#111827]">🔎 Cribal</h1>
          <p className="mt-1 text-sm text-[#6b7280]">Creá tu cuenta</p>
        </div>

        {/* Progress indicator */}
        <div className="mb-6 flex items-center justify-between">
          {STEP_LABELS.map((label, index) => (
            <div key={label} className="flex flex-1 flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  index <= step ? 'bg-[#1e3a5f] text-white' : 'bg-[#e5e7eb] text-[#6b7280]'
                }`}
              >
                {index + 1}
              </div>
              <span className="mt-1 text-center text-xs text-[#6b7280]">{label}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Nombre de la empresa *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Descripción</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Industria / sector</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Tecnología, Consultoría, Construcción…"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Tamaño de la empresa</label>
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className={inputClass}
              >
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Tu nombre *</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Contraseña * (mín. 8 caracteres)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Confirmar contraseña *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className={inputClass}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Capacidades</label>
              <TagInput
                values={capabilities}
                onChange={setCapabilities}
                placeholder="¿Qué servicios ofrece tu empresa?"
              />
            </div>
            <div>
              <label className={labelClass}>Score mínimo: {minimumScore}</label>
              <input
                type="range"
                min={5}
                max={10}
                step={1}
                value={minimumScore}
                onChange={(e) => setMinimumScore(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className={labelClass}>Email de notificación</label>
              <input
                type="email"
                value={notificationEmail}
                onChange={(e) => setNotificationEmail(e.target.value)}
                placeholder={email}
                className={inputClass}
              />
            </div>
            <p className="text-xs text-[#6b7280]">
              Podés configurar más detalles después de registrarte.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#dc2626]">{error}</p>
        )}

        <div className="mt-6 flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={loading}
              className="flex-1 rounded-lg border border-[#e5e7eb] py-2.5 text-sm font-medium text-[#111827] hover:bg-[#f8fafc] disabled:opacity-60"
            >
              Atrás
            </button>
          )}
          {step < 2 ? (
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg bg-[#1e3a5f] py-2.5 text-sm font-medium text-white hover:bg-[#16304e]"
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 rounded-lg bg-[#1e3a5f] py-2.5 text-sm font-medium text-white hover:bg-[#16304e] disabled:opacity-60"
            >
              {loading ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-[#6b7280]">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-medium text-[#2563eb] hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
