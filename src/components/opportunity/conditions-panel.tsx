'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { analyzeConditions } from '@/lib/actions/opportunities'
import type { ConditionsAnalysis } from '@/lib/conditions'

interface ConditionsPanelProps {
  opportunityId: string
  analysis: ConditionsAnalysis | null
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="shrink-0 text-sm font-semibold text-[#0c1e3c]">{label}:</span>
      <span className="text-sm text-[#334155]">{value}</span>
    </div>
  )
}

export function ConditionsPanel({ opportunityId, analysis }: ConditionsPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  function run() {
    startTransition(async () => {
      const result = await analyzeConditions(opportunityId)
      if (result.success) {
        router.refresh()
      } else {
        setToast({ message: result.error ?? 'No se pudieron analizar las condiciones', type: 'error' })
      }
    })
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-[#0c1e3c]">Condiciones para presentarse</h3>
          <Button
            variant={analysis ? 'secondary' : 'primary'}
            size="sm"
            onClick={run}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Analizando…
              </>
            ) : analysis ? (
              'Regenerar'
            ) : (
              'Analizar condiciones'
            )}
          </Button>
        </div>

        {analysis ? (
          <div className="space-y-2.5">
            {analysis.experienciaMinima && (
              <Field label="Experiencia mínima" value={analysis.experienciaMinima} />
            )}
            {analysis.certificaciones.length > 0 && (
              <Field label="Certificaciones" value={analysis.certificaciones.join(', ')} />
            )}
            {analysis.garantias && <Field label="Garantía" value={analysis.garantias} />}
            {analysis.documentacionRequerida.length > 0 && (
              <Field label="Documentación" value={analysis.documentacionRequerida.join(', ')} />
            )}
            {analysis.restricciones.length > 0 && (
              <Field label="Restricciones" value={analysis.restricciones.join(', ')} />
            )}
            {analysis.plazoEjecucion && (
              <Field label="Plazo de ejecución" value={analysis.plazoEjecucion} />
            )}
            {analysis.criterioEvaluacion && (
              <Field label="Criterio de evaluación" value={analysis.criterioEvaluacion} />
            )}
            <blockquote className="mt-3 border-l-2 border-[#06b6d4] pl-3 text-sm italic text-[#475569]">
              {analysis.resumenGeneral}
            </blockquote>
          </div>
        ) : (
          <p className="text-sm text-[#6b7280]">
            Identificá con IA los requisitos para presentar oferta (experiencia, certificaciones,
            garantías, documentación, plazos y criterio de evaluación) a partir del pliego y los
            datos del llamado.
          </p>
        )}
      </CardBody>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Card>
  )
}
