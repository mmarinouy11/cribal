import { Badge } from './badge'
import { categoryLabel } from '@/lib/categories'

// Legacy fixed categories, kept only to populate the opportunities filter
// dropdown. New categories are free short Spanish labels chosen per tender.
export const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'desarrollo_software', label: 'Desarrollo' },
  { value: 'soporte_tecnico', label: 'Soporte TI' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'datos_analytics', label: 'Datos' },
  { value: 'ciberseguridad', label: 'Seguridad' },
  { value: 'qa_testing', label: 'QA' },
  { value: 'servicios_gestionados', label: 'Servicios gestionados' },
  { value: 'licencias', label: 'Licencias' },
  { value: 'consultoria', label: 'Consultoría' },
]

export function CategoryBadge({ category }: { category: string | null }) {
  const label = categoryLabel(category)
  if (!label) return <span className="text-[#6b7280]">—</span>
  return <Badge className="bg-[#e0f2fe] text-[#0e7490]">{label}</Badge>
}
