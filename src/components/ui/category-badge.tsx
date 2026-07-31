import { Badge } from './badge'

interface CategoryMeta {
  label: string
  className: string
}

// Spanish label + color per AI category. Cyan family for TIC/tech categories.
// Labels are kept short so badges stay compact in table rows.
export const CATEGORY_META: Record<string, CategoryMeta> = {
  desarrollo_software: { label: 'Desarrollo', className: 'bg-[#cffafe] text-[#0e7490]' },
  soporte_tecnico: { label: 'Soporte TI', className: 'bg-[#dbeafe] text-[#1e40af]' },
  cloud: { label: 'Cloud', className: 'bg-[#e0f2fe] text-[#0369a1]' },
  datos_analytics: { label: 'Datos', className: 'bg-[#d1fae5] text-[#065f46]' },
  ciberseguridad: { label: 'Seguridad', className: 'bg-red-100 text-red-700' },
  qa_testing: { label: 'QA', className: 'bg-orange-100 text-orange-700' },
  servicios_gestionados: { label: 'Serv. Gestionados', className: 'bg-indigo-100 text-indigo-700' },
  licencias: { label: 'Licencias', className: 'bg-yellow-100 text-yellow-700' },
  consultoria: { label: 'Consultoría', className: 'bg-[#f0f9ff] text-[#0c1e3c]' },
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
