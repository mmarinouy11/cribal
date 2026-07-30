'use client'

import { useRef, useState, type ReactNode } from 'react'
import { SaveStatusIndicator, type SaveStatus } from '@/components/config/save-status'
import { updateCompanyProfile } from '@/lib/actions/config'

export interface ProfileFormValues {
  longDescription: string
  founded: string
  teamSize: string
  caseStudies: string
  certifications: string
  differentiators: string
  proposalTemplate: string
}

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

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const [form, setForm] = useState<ProfileFormValues>(initial)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // Auto-save plumbing: never overlap saves; queue the latest state instead.
  const savingRef = useRef(false)
  const pendingRef = useRef<ProfileFormValues | null>(null)

  async function flush() {
    if (savingRef.current) return
    const state = pendingRef.current
    if (!state) return
    pendingRef.current = null
    savingRef.current = true
    setSaveStatus('saving')
    try {
      await updateCompanyProfile(state)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 3000)
    } catch {
      setSaveStatus('error')
    } finally {
      savingRef.current = false
      if (pendingRef.current) void flush()
    }
  }

  function setField<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaveStatus('unsaved')
  }

  function saveOnBlur() {
    pendingRef.current = form
    void flush()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="rounded-xl border border-[#e0f2fe] bg-white p-6 shadow-sm">
        <Section title="Sobre la empresa">
          <Field
            label="Descripción completa"
            helper="Descripción completa que se incluye en las propuestas generadas por IA"
          >
            <textarea
              rows={6}
              value={form.longDescription}
              onChange={(e) => setField('longDescription', e.target.value)}
              onBlur={saveOnBlur}
              className={inputClass}
            />
          </Field>
          <Field label="Fundación">
            <input
              type="text"
              value={form.founded}
              onChange={(e) => setField('founded', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="2015"
              className={inputClass}
            />
          </Field>
          <Field label="Tamaño del equipo">
            <input
              type="text"
              value={form.teamSize}
              onChange={(e) => setField('teamSize', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="50-100 personas"
              className={inputClass}
            />
          </Field>
        </Section>

        <Section title="Casos de éxito">
          <Field
            label="Casos de éxito"
            helper="Describí proyectos relevantes realizados. La IA los usará para personalizar propuestas."
          >
            <textarea
              rows={8}
              value={form.caseStudies}
              onChange={(e) => setField('caseStudies', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="Ejemplo: Implementamos una plataforma de gestión de turnos para el Ministerio de Salud Pública (2022), reduciendo tiempos de espera en un 40%..."
              className={inputClass}
            />
          </Field>
        </Section>

        <Section title="Diferenciadores">
          <Field label="Certificaciones">
            <input
              type="text"
              value={form.certifications}
              onChange={(e) => setField('certifications', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="ISO 27001, CMMI Level 3"
              className={inputClass}
            />
          </Field>
          <Field
            label="Diferenciadores"
            helper="¿Qué hace única a tu empresa? La IA lo destacará en las propuestas."
          >
            <textarea
              rows={4}
              value={form.differentiators}
              onChange={(e) => setField('differentiators', e.target.value)}
              onBlur={saveOnBlur}
              className={inputClass}
            />
          </Field>
        </Section>

        <Section title="Plantilla de propuesta">
          <Field
            label="Instrucciones para la IA"
            helper="Instrucciones adicionales para la IA al generar propuestas. Ej: 'Siempre mencionar nuestra experiencia con organismos del Estado' o 'Usar tono formal'"
          >
            <textarea
              rows={6}
              value={form.proposalTemplate}
              onChange={(e) => setField('proposalTemplate', e.target.value)}
              onBlur={saveOnBlur}
              className={inputClass}
            />
          </Field>
        </Section>
      </div>
    </div>
  )
}
