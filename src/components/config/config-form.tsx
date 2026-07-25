'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { TagInput } from '@/components/ui/tag-input'
import {
  updateCompanyConfig,
  testRssFeeds,
  generateCompanyConfig,
  type FeedTestResult,
  type GeneratedCompanyConfig,
} from '@/lib/actions/config'

export interface ConfigFormValues {
  companyName: string
  description: string
  notificationEmails: string[]
  minimumScore: number
  lookbackDays: number
  capabilities: string[]
  rssFeeds: string[]
  relevantKeywords: string[]
  excludedKeywords: string[]
  excludedProducts: string[]
  customAiPrompt: string
}

const LOOKBACK_OPTIONS = [1, 3, 7, 14, 30]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[#e5e7eb] py-6 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-lg font-semibold text-[#111827]">{title}</h2>
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
      <label className="mb-1 block text-sm font-medium text-[#111827]">{label}</label>
      {children}
      {helper && <p className="mt-1 text-xs text-[#6b7280]">{helper}</p>}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]'

export function ConfigForm({ initial }: { initial: ConfigFormValues }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
  const [form, setForm] = useState<ConfigFormValues>(initial)
  const [newFeed, setNewFeed] = useState('')
  const [feedResults, setFeedResults] = useState<FeedTestResult[] | null>(null)
  const [isTesting, startTesting] = useTransition()
  const [suggestion, setSuggestion] = useState<GeneratedCompanyConfig | null>(null)
  const [isSuggesting, startSuggesting] = useTransition()

  function set<K extends keyof ConfigFormValues>(key: K, value: ConfigFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleRegenerate() {
    if (!form.description.trim() && form.capabilities.length === 0) {
      setToast({
        message:
          'Completá la descripción de tu empresa para generar una configuración personalizada',
        type: 'error',
      })
      return
    }
    startSuggesting(async () => {
      try {
        const result = await generateCompanyConfig({
          companyName: form.companyName,
          description: form.description,
          capabilities: form.capabilities,
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
    // Replace fields in the form only — the user still has to click "Guardar".
    setForm((prev) => ({
      ...prev,
      rssFeeds: suggestion.rssFeeds,
      relevantKeywords: suggestion.relevantKeywords,
      excludedKeywords: suggestion.excludedKeywords,
      excludedProducts: suggestion.excludedProducts,
      minimumScore: suggestion.minimumScore,
    }))
    setSuggestion(null)
    setToast({
      message: 'Sugerencias aplicadas. Revisá y guardá los cambios.',
      type: 'success',
    })
  }

  function addFeed() {
    const url = newFeed.trim()
    if (!url || form.rssFeeds.includes(url)) {
      setNewFeed('')
      return
    }
    set('rssFeeds', [...form.rssFeeds, url])
    setNewFeed('')
  }

  function removeFeed(index: number) {
    set(
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

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCompanyConfig({
          companyName: form.companyName,
          description: form.description,
          notificationEmails: form.notificationEmails,
          minimumScore: form.minimumScore,
          lookbackDays: form.lookbackDays,
          capabilities: form.capabilities,
          rssFeeds: form.rssFeeds,
          relevantKeywords: form.relevantKeywords,
          excludedKeywords: form.excludedKeywords,
          excludedProducts: form.excludedProducts,
          customAiPrompt: form.customAiPrompt,
        })
        setToast({ message: 'Configuración guardada', type: 'success' })
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo guardar la configuración', type: 'error' })
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="secondary" onClick={handleRegenerate} disabled={isSuggesting}>
          {isSuggesting ? 'Generando…' : '🤖 Regenerar configuración con IA'}
        </Button>
      </div>

      {suggestion && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-[#1e3a5f]">🤖 Configuración sugerida por IA</h2>
          {suggestion.reasoning && (
            <p className="mt-2 text-sm text-[#111827]">💡 {suggestion.reasoning}</p>
          )}

          <div className="mt-4 space-y-3 text-sm">
            <div>
              <p className="font-medium text-[#111827]">Feeds RSS sugeridos:</p>
              <ul className="mt-1 space-y-0.5 text-[#334155]">
                {suggestion.rssFeeds.map((feed) => (
                  <li key={feed} className="break-all">
                    • {feed}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-[#111827]">
                Keywords relevantes (+{suggestion.relevantKeywords.length}):
              </p>
              <p className="mt-1 text-[#334155]">
                {suggestion.relevantKeywords.join(' · ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[#111827]">
                Keywords excluidos (+{suggestion.excludedKeywords.length}):
              </p>
              <p className="mt-1 text-[#334155]">
                {suggestion.excludedKeywords.join(' · ') || '—'}
              </p>
            </div>
            <div>
              <p className="font-medium text-[#111827]">
                Score mínimo sugerido: {suggestion.minimumScore}
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

      <div className="rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm">
        <Section title="Información general">
        <Field label="Nombre de la empresa">
          <input
            type="text"
            value={form.companyName}
            onChange={(e) => set('companyName', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Descripción">
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Emails de notificación">
          <TagInput
            values={form.notificationEmails}
            onChange={(v) => set('notificationEmails', v)}
            placeholder="Agregar email y Enter"
            inputType="email"
          />
        </Field>
        <Field label={`Score mínimo: ${form.minimumScore}`}>
          <input
            type="range"
            min={5}
            max={10}
            step={1}
            value={form.minimumScore}
            onChange={(e) => set('minimumScore', Number(e.target.value))}
            className="w-full"
          />
        </Field>
        <Field label="Días de ventana (lookback)">
          <select
            value={form.lookbackDays}
            onChange={(e) => set('lookbackDays', Number(e.target.value))}
            className={inputClass}
          >
            {LOOKBACK_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} día{days === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Capacidades">
        <Field
          label="Capacidades"
          helper="Las capacidades se usan para que la IA evalúe la relevancia de cada licitación"
        >
          <TagInput
            values={form.capabilities}
            onChange={(v) => set('capabilities', v)}
            placeholder="Agregar capacidad y Enter"
          />
        </Field>
      </Section>

      <Section title="Feeds RSS">
        <div className="space-y-2">
          {form.rssFeeds.length === 0 && (
            <p className="text-sm text-[#6b7280]">No hay feeds configurados.</p>
          )}
          {form.rssFeeds.map((feed, index) => (
            <div
              key={`${feed}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] px-3 py-2"
            >
              <span className="flex-1 break-all text-sm text-[#111827]">{feed}</span>
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
            <tbody className="divide-y divide-[#e5e7eb]">
              {feedResults.map((result) => (
                <tr key={result.feed}>
                  <td className="break-all py-2 pr-4 text-[#374151]">{result.feed}</td>
                  <td className="py-2">{result.itemCount}</td>
                  <td className="py-2">
                    {result.error ? (
                      <span className="text-[#dc2626]">Error</span>
                    ) : (
                      <span className="text-[#16a34a]">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Filtros de keywords">
        <Field
          label="Keywords relevantes"
          helper="Además de estos, el sistema usa una lista base de keywords de TI que siempre se aplican"
        >
          <TagInput
            values={form.relevantKeywords}
            onChange={(v) => set('relevantKeywords', v)}
            placeholder="Agregar keyword y Enter"
          />
        </Field>
        <Field label="Keywords excluidas">
          <TagInput
            values={form.excludedKeywords}
            onChange={(v) => set('excludedKeywords', v)}
            placeholder="Agregar keyword y Enter"
          />
        </Field>
        <Field
          label="Productos excluidos"
          helper="Ej: Veeam, Zimbra — se rechazan licitaciones que solo involucren licencias de estos productos"
        >
          <TagInput
            values={form.excludedProducts}
            onChange={(v) => set('excludedProducts', v)}
            placeholder="Agregar producto y Enter"
          />
        </Field>
      </Section>

      <Section title="Prompt de IA personalizado">
        <Field
          label="Prompt personalizado"
          helper="Si se configura, reemplaza el prompt base de clasificación. Dejá vacío para usar el prompt estándar de Cribal."
        >
          <textarea
            rows={8}
            value={form.customAiPrompt}
            onChange={(e) => set('customAiPrompt', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button variant="secondary" onClick={() => set('customAiPrompt', '')}>
          Restaurar prompt por defecto
        </Button>
      </Section>

        <div className="pt-4">
          <Button onClick={handleSave} disabled={isPending} className="w-full">
            {isPending ? 'Guardando…' : 'Guardar configuración'}
          </Button>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
