'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { TagInput } from '@/components/ui/tag-input'
import { SaveStatusIndicator, type SaveStatus } from '@/components/config/save-status'
import { nextRunDate } from '@/lib/cadence'
import { formatDateDMY } from '@/lib/format'
import {
  updateCompanyConfig,
  updateCompanyProfile,
  testRssFeeds,
  generateCompanyConfig,
  type FeedTestResult,
  type GeneratedCompanyConfig,
} from '@/lib/actions/config'

export interface ConfigFormValues {
  notificationEmails: string[]
  minimumScore: number
  lookbackDays: number
  rssFeeds: string[]
  excludedKeywords: string[]
  excludedProducts: string[]
  customAiPrompt: string
}

export interface RegenContext {
  companyName: string
  description: string
  capabilities: string[]
}

const LOOKBACK_OPTIONS = [1, 2, 3, 4, 5, 6, 7]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[#e0f2fe] py-6 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-lg font-semibold text-[#0c1e3c]">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  helper,
  children,
}: {
  label: string
  helper?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[#0c1e3c]">{label}</label>
      {children}
      {helper && <p className="mt-1 text-xs text-[#6b7280]">{helper}</p>}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]'

export function ConfigForm({
  initial,
  lastSuccessfulRunAt,
  regenContext,
}: {
  initial: ConfigFormValues
  lastSuccessfulRunAt: Date | null
  regenContext: RegenContext
}) {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
  const [form, setForm] = useState<ConfigFormValues>(initial)
  const [newFeed, setNewFeed] = useState('')
  const [feedResults, setFeedResults] = useState<FeedTestResult[] | null>(null)
  const [isTesting, startTesting] = useTransition()
  const [suggestion, setSuggestion] = useState<GeneratedCompanyConfig | null>(null)
  const [isSuggesting, startSuggesting] = useTransition()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // Auto-save plumbing: never overlap saves; queue the latest state instead.
  const savingRef = useRef(false)
  const pendingRef = useRef<ConfigFormValues | null>(null)
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function flush() {
    if (savingRef.current) return
    const state = pendingRef.current
    if (!state) return
    pendingRef.current = null
    savingRef.current = true
    setSaveStatus('saving')
    try {
      await updateCompanyConfig({
        notificationEmails: state.notificationEmails,
        minimumScore: state.minimumScore,
        lookbackDays: state.lookbackDays,
        rssFeeds: state.rssFeeds,
        excludedKeywords: state.excludedKeywords,
        excludedProducts: state.excludedProducts,
        customAiPrompt: state.customAiPrompt,
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 3000)
    } catch {
      setSaveStatus('error')
    } finally {
      savingRef.current = false
      if (pendingRef.current) void flush()
    }
  }

  function requestSave(state: ConfigFormValues) {
    pendingRef.current = state
    void flush()
  }

  // Update a field without saving (used by text fields; save fires on blur).
  function setField<K extends keyof ConfigFormValues>(key: K, value: ConfigFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaveStatus('unsaved')
  }

  // Update a field and save immediately (used by selects, chips, feed edits).
  function commitField<K extends keyof ConfigFormValues>(key: K, value: ConfigFormValues[K]) {
    const next = { ...form, [key]: value }
    setForm(next)
    requestSave(next)
  }

  function onScoreChange(value: number) {
    const next = { ...form, minimumScore: value }
    setForm(next)
    setSaveStatus('unsaved')
    if (scoreTimer.current) clearTimeout(scoreTimer.current)
    scoreTimer.current = setTimeout(() => requestSave(next), 500)
  }

  function handleRegenerate() {
    if (!regenContext.description.trim() && regenContext.capabilities.length === 0) {
      setToast({
        message:
          'Completá la descripción y las capacidades en "Mi empresa" para generar una configuración personalizada',
        type: 'error',
      })
      return
    }
    startSuggesting(async () => {
      try {
        const result = await generateCompanyConfig({
          companyName: regenContext.companyName,
          description: regenContext.description,
          capabilities: regenContext.capabilities,
        })
        setSuggestion(result)
      } catch {
        setToast({
          message: 'No se pudo generar la configuración. Intentá de nuevo.',
          type: 'error',
        })
      }
    })
  }

  function applySuggestion() {
    if (!suggestion) return
    // Apply the config-owned filters into the form and auto-save.
    const next: ConfigFormValues = {
      ...form,
      rssFeeds: suggestion.rssFeeds,
      excludedKeywords: suggestion.excludedKeywords,
      excludedProducts: suggestion.excludedProducts,
      minimumScore: suggestion.minimumScore,
    }
    setForm(next)
    requestSave(next)
    // Relevant keywords are edited in "Mi empresa"; persist them there.
    void updateCompanyProfile({ relevantKeywords: suggestion.relevantKeywords })
    setSuggestion(null)
  }

  function addFeed() {
    const url = newFeed.trim()
    if (!url || form.rssFeeds.includes(url)) {
      setNewFeed('')
      return
    }
    commitField('rssFeeds', [...form.rssFeeds, url])
    setNewFeed('')
  }

  function removeFeed(index: number) {
    commitField(
      'rssFeeds',
      form.rssFeeds.filter((_, i) => i !== index)
    )
  }

  function handleTestFeeds() {
    startTesting(async () => {
      try {
        const results = await testRssFeeds(form.rssFeeds)
        setFeedResults(results)
      } catch {
        setToast({ message: 'No se pudieron probar los feeds', type: 'error' })
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SaveStatusIndicator status={saveStatus} />
      </div>

      {suggestion && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-[#0c1e3c]">Configuración sugerida por IA</h2>
          {suggestion.reasoning && (
            <p className="mt-2 text-sm text-[#0c1e3c]">{suggestion.reasoning}</p>
          )}

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="font-medium text-[#0c1e3c]">Feeds RSS sugeridos:</p>
              <ul className="mt-1 space-y-0.5 text-[#334155]">
                {suggestion.rssFeeds.map((feed) => (
                  <li key={feed} className="break-all">
                    • {feed}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-[#0c1e3c]">
                Keywords relevantes (+{suggestion.relevantKeywords.length}, se guardan en Mi empresa):
              </p>
              <p className="mt-1 text-[#334155]">
                {suggestion.relevantKeywords.join(' · ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[#0c1e3c]">
                Keywords excluidos (+{suggestion.excludedKeywords.length}):
              </p>
              <p className="mt-1 text-[#334155]">
                {suggestion.excludedKeywords.join(' · ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[#0c1e3c]">
                Puntaje mínimo sugerido: {suggestion.minimumScore}
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={applySuggestion}>Aplicar sugerencias</Button>
            <Button variant="secondary" onClick={() => setSuggestion(null)}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#e0f2fe] bg-white p-6 shadow-sm">
        <Section title="Feeds RSS">
          <div className="space-y-2">
            {form.rssFeeds.length === 0 && (
              <p className="text-sm text-[#6b7280]">No hay feeds configurados.</p>
            )}
            {form.rssFeeds.map((feed, index) => (
              <div
                key={`${feed}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-[#e0f2fe] px-3 py-2"
              >
                <span className="flex-1 break-all text-sm text-[#0c1e3c]">{feed}</span>
                <button
                  type="button"
                  onClick={() => removeFeed(index)}
                  aria-label="Eliminar feed"
                  className="text-[#6b7280] hover:text-[#dc2626]"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={newFeed}
              onChange={(e) => setNewFeed(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFeed()
                }
              }}
              placeholder="https://www.comprasestatales.gub.uy/consultas/rss/..."
              className={inputClass}
            />
            <Button variant="secondary" onClick={addFeed}>
              Agregar
            </Button>
          </div>
          <div>
            <Button variant="secondary" onClick={handleTestFeeds} disabled={isTesting}>
              {isTesting ? 'Probando…' : 'Probar feeds'}
            </Button>
          </div>
          {feedResults && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[#6b7280]">
                  <th className="py-2">Feed</th>
                  <th className="py-2">Items</th>
                  <th className="py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0f2fe]">
                {feedResults.map((result) => (
                  <tr key={result.feed}>
                    <td className="break-all py-2 pr-4 text-[#374151]">{result.feed}</td>
                    <td className="py-2">{result.itemCount}</td>
                    <td className="py-2">
                      {result.error ? (
                        <span className="text-[#dc2626]">Error</span>
                      ) : (
                        <span className="text-[#065f46]">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Filtros">
          <Field label="Keywords excluidas">
            <TagInput
              values={form.excludedKeywords}
              onChange={(v) => commitField('excludedKeywords', v)}
              placeholder="Agregar keyword y Enter"
            />
          </Field>
          <Field
            label="Productos excluidos"
            helper="Ej: Veeam, Zimbra — se rechazan licitaciones que solo involucren licencias de estos productos"
          >
            <TagInput
              values={form.excludedProducts}
              onChange={(v) => commitField('excludedProducts', v)}
              placeholder="Agregar producto y Enter"
            />
          </Field>
        </Section>

        <Section title="Alertas y notificaciones">
          <Field label="Emails de notificación">
            <TagInput
              values={form.notificationEmails}
              onChange={(v) => commitField('notificationEmails', v)}
              placeholder="Agregar email y Enter"
              inputType="email"
            />
          </Field>
          <Field label={`Puntaje mínimo: ${form.minimumScore}`}>
            <input
              type="range"
              min={5}
              max={10}
              step={1}
              value={form.minimumScore}
              onChange={(e) => onScoreChange(Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field
            label="Cadencia de ejecución"
            helper="La criba se ejecutará cada N días. Valores más altos reducen el consumo de créditos pero detectan oportunidades con menos frecuencia."
          >
            <select
              value={form.lookbackDays}
              onChange={(e) => commitField('lookbackDays', Number(e.target.value))}
              className={inputClass}
            >
              {LOOKBACK_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} día{days === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-[#6b7280]">
              {lastSuccessfulRunAt ? (
                <>
                  <p>Última ejecución exitosa: {formatDateDMY(lastSuccessfulRunAt)}</p>
                  <p>
                    Próxima ejecución:{' '}
                    {formatDateDMY(nextRunDate(lastSuccessfulRunAt, form.lookbackDays))}
                  </p>
                </>
              ) : (
                <p>Nunca ejecutado — correrá en la próxima ejecución del cron (L-V 08:00)</p>
              )}
            </div>
          </Field>
        </Section>

        <Section title="IA avanzada">
          <Field
            label="Prompt personalizado"
            helper="Si se configura, reemplaza el prompt base de clasificación. Dejá vacío para usar el prompt estándar de Cribal."
          >
            <textarea
              rows={8}
              value={form.customAiPrompt}
              onChange={(e) => setField('customAiPrompt', e.target.value)}
              onBlur={() => requestSave(form)}
              className={inputClass}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => commitField('customAiPrompt', '')}>
              Restaurar prompt por defecto
            </Button>
            <Button variant="secondary" onClick={handleRegenerate} disabled={isSuggesting}>
              {isSuggesting ? 'Generando…' : 'Regenerar configuración con IA'}
            </Button>
          </div>
          <p className="text-xs text-[#6b7280]">
            La IA usa tu perfil (descripción y capacidades de Mi empresa) para inferir feeds y
            filtros.
          </p>
        </Section>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
