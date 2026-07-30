import Link from 'next/link'
import { cn } from '@/lib/cn'

interface PaginationProps {
  basePath: string
  currentPage: number
  totalPages: number
  // Current query params (excluding the page param) to preserve across navigation.
  searchParams: Record<string, string | undefined>
  // Name of the query param that carries the page number (default "page").
  pageParamName?: string
}

function buildHref(
  basePath: string,
  page: number,
  searchParams: Record<string, string | undefined>,
  pageParamName: string
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === pageParamName) continue
    if (value) params.set(key, value)
  }
  params.set(pageParamName, String(page))
  return `${basePath}?${params.toString()}`
}

/** URL-based pagination controls. Renders nothing when there is a single page. */
export function Pagination({
  basePath,
  currentPage,
  totalPages,
  searchParams,
  pageParamName = 'page',
}: PaginationProps) {
  if (totalPages <= 1) return null

  const prevDisabled = currentPage <= 1
  const nextDisabled = currentPage >= totalPages

  const linkClass = 'rounded-lg border border-[#e0f2fe] bg-white px-3 py-1.5 text-sm'

  return (
    <nav className="mt-4 flex items-center justify-between" aria-label="Paginación">
      <Link
        href={buildHref(basePath, currentPage - 1, searchParams, pageParamName)}
        aria-disabled={prevDisabled}
        className={cn(
          linkClass,
          prevDisabled
            ? 'pointer-events-none opacity-50'
            : 'hover:bg-[#f0f9ff]'
        )}
      >
        ← Anterior
      </Link>
      <span className="text-sm text-[#6b7280]">
        Página {currentPage} de {totalPages}
      </span>
      <Link
        href={buildHref(basePath, currentPage + 1, searchParams, pageParamName)}
        aria-disabled={nextDisabled}
        className={cn(
          linkClass,
          nextDisabled ? 'pointer-events-none opacity-50' : 'hover:bg-[#f0f9ff]'
        )}
      >
        Siguiente →
      </Link>
    </nav>
  )
}
