// Shared, network-free catalog of ARCE (comprasestatales.gub.uy) families and
// subfamilies, plus helpers to build/label their RSS feed URLs. Kept as a plain
// module so both client components (register wizard) and server actions can use
// it. The family/subfamily set mirrors what the pipeline maps against the ARCE API.

export interface ArceFamily {
  name: string
  subfamilies: Record<number, string>
}

export const ARCE_FAMILIES: Record<number, ArceFamily> = {
  2: {
    name: 'Materiales y Suministros',
    subfamilies: {
      1: 'Alimentos y productos agropecuarios',
      3: 'Productos textiles, vestir y cuero',
      9: 'Otros materiales y suministros',
      12: 'Repuestos y accesorios',
      13: 'Medicamentos y antisépticos',
    },
  },
  3: {
    name: 'Servicios No Personales',
    subfamilies: {
      7: 'Mantenimiento y reparaciones menores',
      8: 'Servicios profesionales contratados',
      9: 'Otros servicios contratados',
      10: 'Servicios de Tecnologías de la Información (TIC)',
    },
  },
  4: {
    name: 'Maquinaria y Equipos',
    subfamilies: {
      1: 'Maquinaria y equipos de producción',
      2: 'Máquinas y equipos de oficina',
      5: 'Equipos de transporte',
      8: 'Mobiliario',
    },
  },
  5: {
    name: 'Bienes de Uso Existentes',
    subfamilies: {},
  },
  6: {
    name: 'Obras de Construcción e Infraestructura',
    subfamilies: {
      1: 'Vías de comunicación',
      2: 'Edificaciones',
      3: 'Obras hidráulicas y sanitarias',
      4: 'Obras urbanísticas',
    },
  },
  10: {
    name: 'Infraestructura Tecnológica (hardware)',
    subfamilies: {
      43: 'Infraestructura tecnológica',
    },
  },
  12: {
    name: 'Productos Exclusivos Entes (UTE/ANCAP/ANTEL)',
    subfamilies: {},
  },
}

const RSS_BASE = 'https://www.comprasestatales.gub.uy/consultas/rss'

/** RSS feed of active calls (llamados) for a whole family. */
export function familyFeedUrl(familia: number): string {
  return `${RSS_BASE}/tipo-pub/ALL/familia/${familia}`
}

/** RSS feed of active calls for a specific subfamily. */
export function subfamilyFeedUrl(familia: number, subfamilia: number): string {
  return `${RSS_BASE}/tipo-pub/ALL/familia/${familia}/subfamilia/${subfamilia}`
}

/** RSS feed of active calls matching a free-text term. */
export function textFeedUrl(term: string): string {
  return `${RSS_BASE}/tipo-pub/ALL/texto/${encodeURIComponent(term.trim())}`
}

/**
 * Turn an active-calls feed URL into the equivalent adjudications (ADJ) feed,
 * used to load a historical sample. Swaps the `tipo-pub/<X>` segment for
 * `tipo-pub/ADJ`, leaving the rest of the path intact.
 */
export function feedToAdjudicationUrl(url: string): string {
  if (/tipo-pub\/[^/]+/.test(url)) {
    return url.replace(/tipo-pub\/[^/]+/, 'tipo-pub/ADJ')
  }
  return url
}

function parseFeed(url: string): { familia?: number; subfamilia?: number; texto?: string } {
  const sub = url.match(/\/familia\/(\d+)\/subfamilia\/(\d+)/)
  if (sub) return { familia: Number(sub[1]), subfamilia: Number(sub[2]) }
  const fam = url.match(/\/familia\/(\d+)/)
  if (fam) return { familia: Number(fam[1]) }
  const texto = url.match(/\/texto\/([^/]+)/)
  if (texto) return { texto: decodeURIComponent(texto[1]) }
  return {}
}

/** Human-readable label for an ARCE RSS feed URL. */
export function feedToLabel(url: string): string {
  const { familia, subfamilia, texto } = parseFeed(url)
  if (texto !== undefined) return `Búsqueda: "${texto}"`
  if (familia !== undefined) {
    const family = ARCE_FAMILIES[familia]
    if (subfamilia !== undefined) {
      const subName = family?.subfamilies[subfamilia]
      return subName
        ? `${subName} (Fam. ${familia})`
        : `Subfamilia ${subfamilia} (Fam. ${familia})`
    }
    return family ? `${family.name} (Fam. ${familia})` : `Familia ${familia}`
  }
  return url
}

/** A concise label including subfamily number, for adjustment prompts. */
export function feedToDetailedLabel(url: string): string {
  const { familia, subfamilia, texto } = parseFeed(url)
  if (texto !== undefined) return `Búsqueda: "${texto}"`
  if (familia !== undefined && subfamilia !== undefined) {
    const subName = ARCE_FAMILIES[familia]?.subfamilies[subfamilia] ?? `Subfamilia ${subfamilia}`
    return `${subName} (Fam. ${familia}/Subfam. ${subfamilia})`
  }
  return feedToLabel(url)
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export interface CatalogResult {
  familia: number
  subfamilia?: number
  label: string
  feedUrl: string
}

/** Local (no-API) search across family and subfamily names. */
export function searchCatalog(query: string): CatalogResult[] {
  const q = normalize(query.trim())
  if (!q) return []
  const results: CatalogResult[] = []

  for (const [famKey, family] of Object.entries(ARCE_FAMILIES)) {
    const familia = Number(famKey)
    const subEntries = Object.entries(family.subfamilies)

    if (normalize(family.name).includes(q)) {
      results.push({ familia, label: `${family.name} (Fam. ${familia})`, feedUrl: familyFeedUrl(familia) })
    }
    for (const [subKey, subName] of subEntries) {
      const subfamilia = Number(subKey)
      if (normalize(subName).includes(q)) {
        results.push({
          familia,
          subfamilia,
          label: `${subName} (Fam. ${familia})`,
          feedUrl: subfamilyFeedUrl(familia, subfamilia),
        })
      }
    }
  }

  return results
}
