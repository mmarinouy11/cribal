import { Badge } from './badge'

interface CategoryMeta {
  label: string
  className: string
}

// Spanish label + color per AI category. Colors follow the Phase 2 spec.
export const CATEGORY_META: Record<string, CategoryMeta> = {
  desarrollo_software: { label: 'Desarrollo software', className: 'bg-purple-100 text-purple-700' },
  soporte_tecnico: { label: 'Soporte técnico', className: 'bg-blue-100 text-blue-700' },
  cloud: { label: 'Cloud', className: 'bg-cyan-100 text-cyan-700' },
  datos_analytics: { label: 'Datos y analytics', className: 'bg-green-100 text-green-700' },
  ciberseguridad: { label: 'Ciberseguridad', className: 'bg-red-100 text-red-700' },
  qa_testing: { label: 'QA y testing', className: 'bg-orange-100 text-orange-700' },
  servicios_gestionados: { label: 'Servicios gestionados', className: 'bg-indigo-100 text-indigo-700' },
  licencias: { label: 'Licencias', className: 'bg-yellow-100 text-yellow-700' },
  consultoria: { label: 'Consultoría', className: 'bg-teal-100 text-teal-700' },
  no_relevante: { label: 'No relevante', className: 'bg-gray-100 text-gray-600' },
}

export const CATEGORY_OPTIONS: { value: string; label: string }[] = Object.entries(
  CATEGORY_META
).map(([value, meta]) => ({ value, label: meta.label }))

export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <span className="text-[#6b7280]">—</span>
  const meta = CATEGORY_META[category] ?? {
    label: category,
    className: 'bg-gray-100 text-gray-600',
  }
  return <Badge className={meta.className}>{meta.label}</Badge>
}
