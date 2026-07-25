'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import {
  generateProposal,
  saveProposal,
  type ProposalData,
} from '@/lib/actions/proposals'

interface ProposalGeneratorProps {
  opportunityId: string
  opportunity: {
    title: string
    organismo: string
  }
  savedProposal: ProposalData | null
}

const SECTIONS: { key: keyof ProposalData; label: string }[] = [
  { key: 'executiveSummary', label: 'Resumen ejecutivo' },
  { key: 'valueProposition', label: 'Propuesta de valor' },
  { key: 'relevantCapabilities', label: 'Capacidades relevantes' },
  { key: 'clarificationQuestions', label: 'Preguntas de aclaración sugeridas' },
  { key: 'nextSteps', label: 'Próximos pasos' },
]

export function ProposalGenerator({
  opportunityId,
  opportunity,
  savedProposal,
}: ProposalGeneratorProps) {
  const [proposal, setProposal] = useState<ProposalData | null>(savedProposal)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  function setField(key: keyof ProposalData, value: string) {
    setProposal((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function runGeneration() {
    setIsGenerating(true)
    try {
      const result = await generateProposal(opportunityId)
      setProposal(result)
      setToast({ message: 'Propuesta generada', type: 'success' })
    } catch {
      setToast({ message: 'No se pudo generar la propuesta', type: 'error' })
    } finally {
      setIsGenerating(false)
    }
  }

  function handleRegenerate() {
    if (
      !window.confirm('¿Regenerar? Se perderán los cambios no guardados')
    ) {
      return
    }
    void runGeneration()
  }

  async function handleSave() {
    if (!proposal) return
    setIsSaving(true)
    try {
      await saveProposal(opportunityId, proposal)
      setToast({ message: 'Borrador guardado', type: 'success' })
    } catch {
      setToast({ message: 'No se pudo guardar el borrador', type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleExport() {
    if (!proposal) return
    try {
      // Lazy-load the docx/file-saver bundle only when exporting.
      const { exportProposalToDocx } = await import('@/lib/export/proposal-docx')
      await exportProposalToDocx(proposal, opportunity)
    } catch {
      setToast({ message: 'No se pudo exportar a Word', type: 'error' })
    }
  }

  const textareaClass =
    'w-full rounded-lg border border-[#e5e7eb] px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]'

  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-4">
        <h2 className="font-semibold text-[#111827]">💡 Propuesta comercial</h2>
        {proposal && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleRegenerate} disabled={isGenerating}>
              {isGenerating ? 'Generando…' : 'Regenerar'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport}>
              ⬇ Word
            </Button>
          </div>
        )}
      </div>

      <div className="p-5">
        {!proposal ? (
          <div className="space-y-4">
            <p className="text-sm text-[#6b7280]">
              Generá un borrador de propuesta personalizado basado en el perfil de tu
              empresa y los detalles de esta licitación.
            </p>
            <Button onClick={runGeneration} disabled={isGenerating}>
              {isGenerating ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Generando propuesta…
                </span>
              ) : (
                '▶ Generar propuesta con IA'
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {SECTIONS.map((section) => (
              <div key={section.key}>
                <label className="mb-1 block text-sm font-semibold text-[#111827]">
                  {section.label}
                </label>
                <textarea
                  rows={5}
                  value={proposal[section.key]}
                  onChange={(e) => setField(section.key, e.target.value)}
                  className={textareaClass}
                />
              </div>
            ))}
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Guardando…' : 'Guardar borrador'}
            </Button>
          </div>
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
