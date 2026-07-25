import { Card, CardBody } from '@/components/ui/card'

export default function ConfigurationPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#111827]">Configuración</h1>
        <p className="text-sm text-[#6b7280]">Ajustes de la empresa y del pipeline.</p>
      </header>

      <Card>
        <CardBody className="py-16 text-center">
          <div className="text-4xl" aria-hidden>
            ⚙️
          </div>
          <p className="mt-3 text-sm text-[#6b7280]">
            La configuración estará disponible en la Fase 3.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
