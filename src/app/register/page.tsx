'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { TagInput } from '@/components/ui/tag-input'
import { registerCompany } from '@/lib/actions/auth'
import { generateCompanyConfig, type GeneratedCompanyConfig } from '@/lib/actions/config'

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '200+']
const STEP_LABELS = ['Tu empresa', 'Tu cuenta', 'Qué buscás']

const inputClass =
  'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]'
const labelClass = 'mb-1 block text-sm font-medium text-[#111827]'

/** Human-readable label for an ARCE RSS feed URL. */
function feedLabel(url: string): string {
  const familia = url.match(/\/familia\/(\d+)/)
  if (familia) {
    const names: Record<string, string> = {
      '1': 'Familia 1 — Obras',
      '2': 'Familia 2 — Bienes',
      '3': 'Familia 3 — Servicios no personales',
      '4': 'Familia 4 — Servicios personales',
      '5': 'Familia 5 — Arrendamientos',
      '10': 'Familia 10 — TIC',
    }
    return names[familia[1]] ?? `Familia ${familia[1]}`
  }
  const texto = url.match(/\/texto\/([^/]+)/)
  if (texto) return `Búsqueda: "${decodeURIComponent(texto[1])}"`
  return url
}

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
  const [capabilities, setCapabilities] = useState<string[]>([])
  // Step 2
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Step 3
  const [notificationEmail, setNotificationEmail] = useState('')
  const [config, setConfig] = useState<GeneratedCompanyConfig | null>(null)
  const [generating, setGenerating] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  function buildDescription(): string {
    const extras = [
      industry.trim() ? `Sector: ${industry.trim()}` : '',
      `Tamaño: ${companySize}`,
    ]
      .filter(Boolean)
      .join(' · ')
    return [description.trim(), extras ? `(${extras})` : ''].filter(Boolean).join(' ')
  }

  async function runGeneration() {
    if (!description.trim() && capabilities.length === 0) {
      setConfig(null)
      setConfigError(
        'Completá la descripción de tu empresa para generar una configuración personalizada'
      )
      return
    }
    setGenerating(true)
    setConfigError(null)
    try {
      const result = await generateCompanyConfig({
        companyName,
        description: buildDescription(),
        capabilities,
      })
      setConfig(result)
    } catch {
      setConfigError('No se pudo generar la configuración. Intentá de nuevo.')
    } finally {
      setGenerating(false)
    }
  }

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
    if (step === 1) {
      if (!notificationEmail) setNotificationEmail(email)
      // Auto-generate the configuration when reaching Step 3.
      if (!config && !generating) void runGeneration()
    }
    setStep((s) => Math.min(2, s + 1))
  }

  function goBack() {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  function updateConfig<K extends keyof GeneratedCompanyConfig>(
    key: K,
    value: GeneratedCompanyConfig[K]
  ) {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)

    const result = await registerCompany({
      companyName,
      description: buildDescription(),
      userName,
      email,
      password,
      capabilities,
      minimumScore: config?.minimumScore ?? 7,
      notificationEmail: notificationEmail || email,
      relevantKeywords: config?.relevantKeywords ?? [],
      excludedKeywords: config?.excludedKeywords ?? [],
      excludedProducts: config?.excludedProducts ?? [],
      rssFeeds: config?.rssFeeds ?? [],
    })

    if (!result.success) {
      setLoading(false)
      setError(result.error ?? 'No se pudo crear la cuenta')
      return
    }

    const signInResult = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    })

    setLoading(false)

    if (!signInResult || signInResult.error) {
      router.push('/login')
      return
    }

    router.push('/?welcome=1')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 py-10">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-2xl">
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
                placeholder="¿A qué se dedica tu empresa?"
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
            <div>
              <label className={labelClass}>Capacidades y servicios</label>
              <TagInput
                values={capabilities}
                onChange={setCapabilities}
                placeholder="¿Qué servicios ofrece tu empresa?"
              />
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
            <h2 className="text-lg font-semibold text-[#111827]">Qué buscás en ARCE</h2>

            {generating && (
              <div className="flex items-center gap-3 rounded-lg bg-[#f8fafc] px-4 py-4">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#1e3a5f] border-t-transparent" />
                <span className="text-sm text-[#111827]">
                  Analizando el perfil de tu empresa…
                </span>
              </div>
            )}

            {!generating && configError && (
              <div className="space-y-2 rounded-lg bg-amber-50 px-4 py-3">
                <p className="text-sm text-[#92400e]">{configError}</p>
                <button
                  type="button"
                  onClick={runGeneration}
                  className="rounded-lg border border-[#e5e7eb] bg-white px-3 py-1.5 text-sm font-medium text-[#111827] hover:bg-[#f8fafc]"
                >
                  Generar configuración
                </button>
              </div>
            )}

            {!generating && config && (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#e5e7eb] p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#111827]">
                      Feeds RSS ({config.rssFeeds.length})
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-sm text-[#334155]">
                    {config.rssFeeds.map((feed) => (
                      <li key={feed}>• {feedLabel(feed)}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-[#e5e7eb] p-4">
                  <span className="text-sm font-semibold text-[#111827]">
                    Keywords relevantes ({config.relevantKeywords.length})
                  </span>
                  <p className="mt-1 text-sm text-[#334155]">
                    {config.relevantKeywords.join(' · ') || '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#e5e7eb] p-4">
                  <span className="text-sm font-semibold text-[#111827]">
                    Keywords excluidos ({config.excludedKeywords.length})
                  </span>
                  <p className="mt-1 text-sm text-[#334155]">
                    {config.excludedKeywords.join(' · ') || '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#e5e7eb] p-4 text-sm text-[#111827]">
                  Score mínimo: <span className="font-semibold">{config.minimumScore}</span>
                </div>

                {config.reasoning && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-[#111827]">
                    💡 {config.reasoning}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="text-sm font-medium text-[#2563eb] hover:underline"
                >
                  {editing ? 'Ocultar ajustes' : 'Ajustar configuración'}
                </button>

                {editing && (
                  <div className="space-y-4 rounded-lg border border-[#e5e7eb] bg-[#f8fafc] p-4">
                    <div>
                      <label className={labelClass}>Feeds RSS</label>
                      <TagInput
                        values={config.rssFeeds}
                        onChange={(v) => updateConfig('rssFeeds', v)}
                        placeholder="URL de feed y Enter"
                        inputType="url"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Keywords relevantes</label>
                      <TagInput
                        values={config.relevantKeywords}
                        onChange={(v) => updateConfig('relevantKeywords', v)}
                        placeholder="Agregar keyword y Enter"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Keywords excluidos</label>
                      <TagInput
                        values={config.excludedKeywords}
                        onChange={(v) => updateConfig('excludedKeywords', v)}
                        placeholder="Agregar keyword y Enter"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Productos excluidos</label>
                      <TagInput
                        values={config.excludedProducts}
                        onChange={(v) => updateConfig('excludedProducts', v)}
                        placeholder="Agregar producto y Enter"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Score mínimo: {config.minimumScore}</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig('minimumScore', Math.max(5, config.minimumScore - 1))
                          }
                          className="h-8 w-8 rounded-lg border border-[#e5e7eb] bg-white text-[#111827]"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-sm font-semibold">
                          {config.minimumScore}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig('minimumScore', Math.min(10, config.minimumScore + 1))
                          }
                          className="h-8 w-8 rounded-lg border border-[#e5e7eb] bg-white text-[#111827]"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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
              disabled={loading || generating}
              className="flex-1 rounded-lg bg-[#1e3a5f] py-2.5 text-sm font-medium text-white hover:bg-[#16304e] disabled:opacity-60"
            >
              {loading ? 'Creando cuenta…' : 'Usar esta configuración →'}
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
