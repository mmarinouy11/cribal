'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { TagInput } from '@/components/ui/tag-input'
import { LogoMark } from '@/components/ui/logo'
import { registerCompany } from '@/lib/actions/auth'
import { generateCompanyConfig, type GeneratedCompanyConfig } from '@/lib/actions/config'
import { lookupCompany } from '@/lib/actions/company-lookup'
import { ValidationStep } from '@/components/register/validation-step'
import { feedToLabel } from '@/lib/arce/catalog'

const COUNTRIES = [
  'Uruguay',
  'Argentina',
  'Brasil',
  'Chile',
  'Colombia',
  'México',
  'España',
  'Estados Unidos',
  'Otro',
]
const STEP_LABELS = ['Tu empresa', 'Tu cuenta', 'Qué buscás', 'Validá tu config', 'Resumen']
const LAST_STEP = STEP_LABELS.length - 1 // summary step index

/** Split a free-text capabilities field into a trimmed list. */
function capabilitiesToList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const inputClass =
  'w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]'
const labelClass = 'mb-1 block text-sm font-medium text-[#0c1e3c]'

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [companyName, setCompanyName] = useState('')
  const [country, setCountry] = useState(COUNTRIES[0])
  const [description, setDescription] = useState('')
  const [capabilitiesText, setCapabilitiesText] = useState('')
  const [looking, setLooking] = useState(false)
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)
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
  // Step 4 (validation)
  const [appliedExclusions, setAppliedExclusions] = useState<string[]>([])

  const EMPTY_CONFIG: GeneratedCompanyConfig = {
    relevantKeywords: [],
    excludedKeywords: [],
    excludedProducts: [],
    rssFeeds: [],
    minimumScore: 7,
    reasoning: '',
  }

  function buildDescription(): string {
    const suffix = country ? `(País: ${country})` : ''
    return [description.trim(), suffix].filter(Boolean).join(' ')
  }

  async function handleLookup() {
    // Confirm before overwriting content the user already typed.
    if (
      (description.trim() || capabilitiesText.trim()) &&
      !window.confirm('¿Reemplazar el contenido actual con la información encontrada?')
    ) {
      return
    }
    setLooking(true)
    setLookupMessage(null)
    try {
      const result = await lookupCompany(companyName, country)
      setDescription(result.description)
      setCapabilitiesText(result.capabilities)
      setLookupMessage(
        result.found
          ? '✅ Información encontrada — podés editarla antes de continuar'
          : 'No encontramos información pública. Completá los campos manualmente.'
      )
    } catch {
      setLookupMessage('Error al buscar. Completá los campos manualmente.')
    } finally {
      setLooking(false)
    }
  }

  async function runGeneration() {
    const capabilities = capabilitiesToList(capabilitiesText)
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
    if (step === 2) {
      // Guarantee an editable config object before the validation step so the
      // user can add categories even if AI generation failed.
      if (!config) setConfig(EMPTY_CONFIG)
    }
    setStep((s) => Math.min(LAST_STEP, s + 1))
  }

  function goBack() {
    setError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  /** Skip the validation step, jumping straight to the final summary. */
  function skipValidation() {
    setError(null)
    setStep(LAST_STEP)
  }

  const finalExcludedKeywords = Array.from(
    new Set([...(config?.excludedKeywords ?? []), ...appliedExclusions])
  )

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
      capabilities: capabilitiesToList(capabilitiesText),
      minimumScore: config?.minimumScore ?? 7,
      notificationEmail: notificationEmail || email,
      relevantKeywords: config?.relevantKeywords ?? [],
      excludedKeywords: finalExcludedKeywords,
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
    <div className="flex min-h-screen items-center justify-center bg-[#0c1e3c] px-4 py-10">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <LogoMark size={32} />
            <span
              className="text-2xl font-semibold text-[#0c1e3c]"
              style={{ letterSpacing: '-0.5px' }}
            >
              cribal
            </span>
          </div>
          <p className="mt-2 text-sm text-[#64748b]">Creá tu cuenta</p>
        </div>

        {/* Progress indicator */}
        <div className="mb-6 flex items-center justify-between">
          {STEP_LABELS.map((label, index) => (
            <div key={label} className="flex flex-1 flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  index <= step ? 'bg-[#06b6d4] text-white' : 'bg-[#cbd5e1] text-white'
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
              <label className={labelClass}>País *</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className={inputClass}
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {companyName.trim().length > 2 && country && (
              <div>
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={looking}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#0c1e3c] bg-white px-3 py-2 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff] disabled:opacity-60"
                >
                  {looking && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0c1e3c] border-t-transparent" />
                  )}
                  {looking ? 'Buscando…' : '🔍 Buscar información de la empresa'}
                </button>
                {lookupMessage && (
                  <p className="mt-2 text-xs text-[#6b7280]">{lookupMessage}</p>
                )}
              </div>
            )}

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
              <label className={labelClass}>Productos, capacidades o servicios</label>
              <textarea
                rows={3}
                value={capabilitiesText}
                onChange={(e) => setCapabilitiesText(e.target.value)}
                placeholder="¿Qué productos, capacidades o servicios ofrece tu empresa?"
                className={inputClass}
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
            <h2 className="text-lg font-semibold text-[#0c1e3c]">Qué buscás en ARCE</h2>

            {generating && (
              <div className="flex items-center gap-3 rounded-lg bg-[#f0f9ff] px-4 py-4">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#0c1e3c] border-t-transparent" />
                <span className="text-sm text-[#0c1e3c]">
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
                  className="rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff]"
                >
                  Generar configuración
                </button>
              </div>
            )}

            {!generating && config && (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#e0f2fe] p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#0c1e3c]">
                      Feeds RSS ({config.rssFeeds.length})
                    </span>
                  </div>
                  <ul className="space-y-0.5 text-sm text-[#334155]">
                    {config.rssFeeds.map((feed) => (
                      <li key={feed}>• {feedToLabel(feed)}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-[#e0f2fe] p-4">
                  <span className="text-sm font-semibold text-[#0c1e3c]">
                    Keywords relevantes ({config.relevantKeywords.length})
                  </span>
                  <p className="mt-1 text-sm text-[#334155]">
                    {config.relevantKeywords.join(' · ') || '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#e0f2fe] p-4">
                  <span className="text-sm font-semibold text-[#0c1e3c]">
                    Keywords excluidos ({config.excludedKeywords.length})
                  </span>
                  <p className="mt-1 text-sm text-[#334155]">
                    {config.excludedKeywords.join(' · ') || '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#e0f2fe] p-4 text-sm text-[#0c1e3c]">
                  Puntaje mínimo: <span className="font-semibold">{config.minimumScore}</span>
                </div>

                {config.reasoning && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-[#0c1e3c]">
                    💡 {config.reasoning}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="text-sm font-medium text-[#0e7490] hover:underline"
                >
                  {editing ? 'Ocultar ajustes' : 'Ajustar configuración'}
                </button>

                {editing && (
                  <div className="space-y-4 rounded-lg border border-[#e0f2fe] bg-[#f0f9ff] p-4">
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
                      <label className={labelClass}>Puntaje mínimo: {config.minimumScore}</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateConfig('minimumScore', Math.max(5, config.minimumScore - 1))
                          }
                          className="h-8 w-8 rounded-lg border border-[#e0f2fe] bg-white text-[#0c1e3c]"
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
                          className="h-8 w-8 rounded-lg border border-[#e0f2fe] bg-white text-[#0c1e3c]"
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

        {step === 3 && (
          <ValidationStep
            companyName={companyName}
            description={buildDescription()}
            capabilities={capabilitiesToList(capabilitiesText)}
            relevantKeywords={config?.relevantKeywords ?? []}
            feeds={config?.rssFeeds ?? []}
            generating={generating}
            onFeedsChange={(feeds) => {
              setConfig((prev) => (prev ? { ...prev, rssFeeds: feeds } : { ...EMPTY_CONFIG, rssFeeds: feeds }))
            }}
            appliedExclusions={appliedExclusions}
            onAppliedExclusionsChange={setAppliedExclusions}
          />
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-[#0c1e3c]">Resumen de tu configuración</h2>

            <div className="space-y-3 rounded-lg border border-[#e0f2fe] p-4 text-sm">
              <div>
                <span className="font-semibold text-[#0c1e3c]">
                  Categorías ({config?.rssFeeds.length ?? 0}):
                </span>{' '}
                <span className="text-[#334155]">
                  {config && config.rssFeeds.length > 0
                    ? config.rssFeeds.map((f) => feedToLabel(f)).join(', ')
                    : '—'}
                </span>
              </div>
              <div>
                <span className="font-semibold text-[#0c1e3c]">
                  Keywords excluidos ({finalExcludedKeywords.length}):
                </span>{' '}
                <span className="text-[#334155]">
                  {finalExcludedKeywords.length > 0 ? finalExcludedKeywords.join(', ') : '—'}
                </span>
              </div>
              <div>
                <span className="font-semibold text-[#0c1e3c]">Puntaje mínimo:</span>{' '}
                <span className="text-[#334155]">{config?.minimumScore ?? 7}</span>
              </div>
              <div>
                <span className="font-semibold text-[#0c1e3c]">Cadencia:</span>{' '}
                <span className="text-[#334155]">Diaria</span>
              </div>
            </div>
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
              className="flex-1 rounded-lg border border-[#e0f2fe] py-2.5 text-sm font-medium text-[#0c1e3c] hover:bg-[#f0f9ff] disabled:opacity-60"
            >
              {step === LAST_STEP ? '← Volver a ajustar' : 'Atrás'}
            </button>
          )}
          {step < LAST_STEP ? (
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-lg bg-[#06b6d4] py-2.5 text-sm font-medium text-white hover:bg-[#0891b2]"
            >
              {step === 3 ? 'Continuar →' : 'Siguiente'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || generating}
              className="flex-1 rounded-lg bg-[#06b6d4] py-2.5 text-sm font-medium text-white hover:bg-[#0891b2] disabled:opacity-60"
            >
              {loading ? 'Creando cuenta…' : '✓ Crear cuenta'}
            </button>
          )}
        </div>

        {step === 3 && (
          <button
            type="button"
            onClick={skipValidation}
            className="mt-3 block w-full text-center text-sm text-[#6b7280] hover:text-[#0c1e3c] hover:underline"
          >
            Omitir este paso →
          </button>
        )}

        <p className="mt-6 text-center text-sm text-[#6b7280]">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="font-medium text-[#0e7490] hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
