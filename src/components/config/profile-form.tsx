'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
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

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
  const [form, setForm] = useState<ProfileFormValues>(initial)

  function set<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateCompanyProfile(form)
        setToast({ message: 'Perfil guardado', type: 'success' })
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo guardar el perfil', type: 'error' })
      }
    })
  }

  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm">
      <Section title="Sobre la empresa">
        <Field
          label="Descripción completa"
          helper="Descripción completa que se incluye en las propuestas generadas por IA"
        >
          <textarea
            rows={6}
            value={form.longDescription}
            onChange={(e) => set('longDescription', e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Fundación">
          <input
            type="text"
            value={form.founded}
            onChange={(e) => set('founded', e.target.value)}
            placeholder="2015"
            className={inputClass}
          />
        </Field>
        <Field label="Tamaño del equipo">
          <input
            type="text"
            value={form.teamSize}
            onChange={(e) => set('teamSize', e.target.value)}
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
            onChange={(e) => set('caseStudies', e.target.value)}
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
            onChange={(e) => set('certifications', e.target.value)}
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
            onChange={(e) => set('differentiators', e.target.value)}
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
            onChange={(e) => set('proposalTemplate', e.target.value)}
            className={inputClass}
          />
        </Field>
      </Section>

      <div className="pt-4">
        <Button onClick={handleSave} disabled={isPending} className="w-full">
          {isPending ? 'Guardando…' : 'Guardar perfil'}
        </Button>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
