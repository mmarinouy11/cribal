'use client'

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { TagInput } from '@/components/ui/tag-input'
import { SaveStatusIndicator, type SaveStatus } from '@/components/config/save-status'
import { updateCompanyProfile } from '@/lib/actions/config'

export interface ProfileFormValues {
  // Identity / branding
  legalName: string
  rut: string
  isPyme: boolean
  logoUrl: string
  brandColorPrimary: string
  brandColorSecondary: string
  // Description
  longDescription: string
  founded: string
  teamSize: string
  // Capabilities & services
  capabilities: string[]
  relevantKeywords: string[]
  caseStudies: string
  certifications: string
  differentiators: string
  // Proposals
  proposalTemplate: string
}

// A logo pasted as a data URL is stored inline in the DB; keep it small.
const MAX_LOGO_BYTES = 500_000

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
  const [logoError, setLogoError] = useState<string | null>(null)

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

  function requestSave(state: ProfileFormValues) {
    pendingRef.current = state
    void flush()
  }

  // Update without saving; save fires on blur (text fields).
  function setField<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaveStatus('unsaved')
  }

  // Update and save immediately (chips, checkbox, color pickers, logo).
  function commitField<K extends keyof ProfileFormValues>(key: K, value: ProfileFormValues[K]) {
    const next = { ...form, [key]: value }
    setForm(next)
    requestSave(next)
  }

  function saveOnBlur() {
    requestSave(form)
  }

  function onLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file
    if (!file) return
    setLogoError(null)
    if (!file.type.startsWith('image/')) {
      setLogoError('El archivo debe ser una imagen.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('El logo debe pesar menos de 500 KB. Usá una URL para imágenes grandes.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') commitField('logoUrl', reader.result)
    }
    reader.onerror = () => setLogoError('No se pudo leer el archivo.')
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="rounded-xl border border-[#e0f2fe] bg-white p-6 shadow-sm">
        <Section title="Identidad">
          <Field label="Razón social">
            <input
              type="text"
              value={form.legalName}
              onChange={(e) => setField('legalName', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="Ej: Acme Tecnología S.A."
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="RUT">
              <input
                type="text"
                value={form.rut}
                onChange={(e) => setField('rut', e.target.value)}
                onBlur={saveOnBlur}
                placeholder="21 dígitos"
                className={inputClass}
              />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#0c1e3c]">
                <input
                  type="checkbox"
                  checked={form.isPyme}
                  onChange={(e) => commitField('isPyme', e.target.checked)}
                  className="h-4 w-4 rounded border-[#cbd5e1] text-[#06b6d4] focus:ring-[#06b6d4]"
                />
                ¿Es PYME?
              </label>
            </div>
          </div>

          <Field label="Logo" helper="Subí una imagen (máx. 500 KB) o pegá la URL de tu logo.">
            <div className="flex flex-wrap items-center gap-3">
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logoUrl}
                  alt="Logo de la empresa"
                  className="h-14 w-14 rounded-lg border border-[#e0f2fe] object-contain"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-[#cbd5e1] text-[#94a3b8]">
                  <i className="ti ti-photo" aria-hidden />
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-[#e0f2fe] bg-white px-3 py-2 text-sm text-[#0c1e3c] transition-colors hover:bg-[#f0f9ff]">
                <i className="ti ti-upload mr-1" aria-hidden />
                Subir imagen
                <input type="file" accept="image/*" onChange={onLogoFile} className="hidden" />
              </label>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={() => commitField('logoUrl', '')}
                  className="text-sm text-[#6b7280] hover:text-[#dc2626]"
                >
                  Quitar
                </button>
              )}
            </div>
            <input
              type="url"
              value={form.logoUrl.startsWith('data:') ? '' : form.logoUrl}
              onChange={(e) => setField('logoUrl', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="https://…/logo.png"
              className={`${inputClass} mt-2`}
            />
            {logoError && <p className="mt-1 text-xs text-[#dc2626]">{logoError}</p>}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Color primario de marca">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.brandColorPrimary}
                  onChange={(e) => commitField('brandColorPrimary', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-[#e0f2fe]"
                />
                <input
                  type="text"
                  value={form.brandColorPrimary}
                  onChange={(e) => setField('brandColorPrimary', e.target.value)}
                  onBlur={saveOnBlur}
                  className={inputClass}
                />
              </div>
            </Field>
            <Field label="Color secundario de marca">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.brandColorSecondary}
                  onChange={(e) => commitField('brandColorSecondary', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-[#e0f2fe]"
                />
                <input
                  type="text"
                  value={form.brandColorSecondary}
                  onChange={(e) => setField('brandColorSecondary', e.target.value)}
                  onBlur={saveOnBlur}
                  className={inputClass}
                />
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Descripción">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Fundada en">
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
          </div>
        </Section>

        <Section title="Capacidades y servicios">
          <Field
            label="Capacidades"
            helper="Las capacidades se usan para que la IA evalúe la relevancia de cada licitación"
          >
            <TagInput
              values={form.capabilities}
              onChange={(v) => commitField('capabilities', v)}
              placeholder="Agregar capacidad y Enter"
            />
          </Field>
          <Field
            label="Keywords relevantes"
            helper="Términos que describen tu rubro. Se usan para filtrar los llamados que llegan a la IA."
          >
            <TagInput
              values={form.relevantKeywords}
              onChange={(v) => commitField('relevantKeywords', v)}
              placeholder="Agregar keyword y Enter"
            />
          </Field>
          <Field
            label="Casos de éxito"
            helper="Describí proyectos relevantes realizados. La IA los usará para personalizar propuestas."
          >
            <textarea
              rows={6}
              value={form.caseStudies}
              onChange={(e) => setField('caseStudies', e.target.value)}
              onBlur={saveOnBlur}
              placeholder="Ejemplo: Implementamos una plataforma de gestión de turnos para el Ministerio de Salud Pública (2022), reduciendo tiempos de espera en un 40%..."
              className={inputClass}
            />
          </Field>
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

        <Section title="Para propuestas">
          <Field
            label="Plantilla de propuesta"
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
