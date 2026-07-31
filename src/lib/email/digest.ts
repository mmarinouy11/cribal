import { Resend } from 'resend'
import type { CompanyConfig, NicheCategory, Opportunity } from '@prisma/client'
import type { NormalizedTender } from '../pipeline/normalizer'
import { getUrgentOpportunities, getBusinessDaysUntilClosing } from '../pipeline/urgency'
import { formatDateTime, formatRelativeTime } from '../format'

const ARCE_URL = 'https://www.comprasestatales.gub.uy'
const APP_URL = 'https://cribal-production.up.railway.app'

/** Minimal niche shape the digest needs — high-signal niches detected in a run. */
export interface NicheDigestItem {
  id: string
  label: string
  category: NicheCategory
  failureCount: number
  lastFailureAt: Date
}

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY)
  }
  return cachedResend
}

function formatSpanishDate(date: Date): string {
  return new Intl.DateTimeFormat('es-UY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function scoreBadgeColors(score: number): { color: string; background: string } {
  if (score >= 9) return { color: '#065f46', background: '#d1fae5' }
  if (score >= 7) return { color: '#0e7490', background: '#cffafe' }
  return { color: '#92400e', background: '#fef3c7' }
}

function renderOpportunityCard(opp: Opportunity): string {
  const badge = scoreBadgeColors(opp.score)
  const category = opp.category ? escapeHtml(opp.category) : ''
  const summary = opp.summary ? escapeHtml(opp.summary) : ''
  const play = opp.recommendedPlay ? escapeHtml(opp.recommendedPlay) : ''
  const organismo = opp.organismo ? escapeHtml(opp.organismo) : ''

  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;background:#ffffff;">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <span style="display:inline-block;font-weight:700;font-size:14px;padding:4px 10px;border-radius:9999px;color:${badge.color};background:${badge.background};">
          Score ${opp.score}
        </span>
        ${
          category
            ? `<span style="display:inline-block;margin-left:8px;font-size:12px;padding:4px 10px;border-radius:9999px;color:#334155;background:#f1f5f9;">${category}</span>`
            : ''
        }
      </div>
      <h3 style="margin:0 0 6px 0;font-size:16px;color:#0f172a;">${escapeHtml(opp.title)}</h3>
      ${organismo ? `<p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">${organismo}</p>` : ''}
      ${summary ? `<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">${summary}</p>` : ''}
      ${
        play
          ? `<p style="margin:0 0 12px 0;font-size:14px;color:#334155;"><strong>Ángulo comercial:</strong> ${play}</p>`
          : ''
      }
      <a href="${escapeHtml(opp.url)}" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#0c1e3c;padding:8px 14px;border-radius:6px;text-decoration:none;">Ver licitación →</a>
    </div>`
}

function renderUrgentCard(opp: Opportunity): string {
  const businessDays = opp.closingDate ? getBusinessDaysUntilClosing(opp.closingDate) : 0
  const closing = opp.closingDate ? formatDateTime(opp.closingDate) : ''
  const organismo = opp.organismo ? escapeHtml(opp.organismo) : ''
  const link = `${APP_URL}/oportunidades/${opp.id}?tab=detalle`

  return `
    <div style="border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:14px;margin-bottom:12px;background:#fef2f2;">
      <h3 style="margin:0 0 4px 0;font-size:15px;color:#0f172a;">${escapeHtml(opp.title)}</h3>
      <p style="margin:0 0 4px 0;font-size:13px;font-weight:700;color:#dc2626;">
        CIERRA EN ${businessDays} DÍA(S) HÁBIL(ES) — ${escapeHtml(closing)}
      </p>
      <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
        Score: ${opp.score}/10 · ${organismo}
      </p>
      <a href="${link}" style="font-size:13px;font-weight:600;color:#dc2626;text-decoration:none;">Ver oportunidad →</a>
    </div>`
}

function renderOtherTender(tender: NormalizedTender): string {
  const description = tender.description
    ? escapeHtml(tender.description.slice(0, 120))
    : ''
  const organismo = tender.organismo ? escapeHtml(tender.organismo) : ''

  return `
    <li style="margin-bottom:12px;list-style:none;">
      <a href="${escapeHtml(tender.url)}" style="font-size:15px;font-weight:600;color:#0c1e3c;text-decoration:none;">${escapeHtml(tender.title)}</a>
      ${description ? `<p style="margin:2px 0 2px 0;font-size:13px;color:#475569;">${description}</p>` : ''}
      ${organismo ? `<p style="margin:0;font-size:12px;color:#94a3b8;">${organismo}</p>` : ''}
    </li>`
}

function nicheCategoryLabel(category: NicheCategory): string {
  if (category === 'NUCLEO') return 'Núcleo'
  if (category === 'ADYACENTE') return 'Adyacente'
  return 'Fuera'
}

function renderNicheItem(niche: NicheDigestItem): string {
  const link = `${APP_URL}/nichos/${niche.id}`
  const category = nicheCategoryLabel(niche.category)
  const relative = formatRelativeTime(niche.lastFailureAt)
  return `
    <div style="border:1px solid #e5e7eb;border-left:4px solid #8b5cf6;border-radius:8px;padding:14px;margin-bottom:12px;background:#ffffff;">
      <h3 style="margin:0 0 4px 0;font-size:15px;color:#0f172a;">${escapeHtml(niche.label)}</h3>
      <p style="margin:0 0 8px 0;font-size:13px;color:#64748b;">
        ${escapeHtml(category)} · ${niche.failureCount} llamado(s) fallido(s) · último ${escapeHtml(relative)}
      </p>
      <a href="${link}" style="font-size:13px;font-weight:600;color:#5b21b6;text-decoration:none;">Ver nicho →</a>
    </div>`
}

function buildHtml(
  savedOpportunities: Opportunity[],
  otherTenders: NormalizedTender[],
  urgentOpportunities: Opportunity[],
  niches: NicheDigestItem[],
  company: CompanyConfig,
  formattedDate: string,
  totalFound: number
): string {
  const relevantCount = savedOpportunities.length
  const otherCount = otherTenders.length

  const urgentSection =
    urgentOpportunities.length > 0
      ? `<div style="background:#ffffff;padding:24px 24px 0 24px;">
      <h2 style="font-size:18px;color:#dc2626;margin:0 0 16px 0;">⚡ Oportunidades con cierre próximo</h2>
      ${urgentOpportunities.map(renderUrgentCard).join('')}
    </div>`
      : ''

  const opportunityCards =
    relevantCount > 0
      ? savedOpportunities.map(renderOpportunityCard).join('')
      : `<p style="font-size:14px;color:#64748b;">No hay oportunidades relevantes para postular hoy.</p>`

  const otherList =
    otherCount > 0
      ? `<ul style="padding:0;margin:0;">${otherTenders.map(renderOtherTender).join('')}</ul>`
      : `<p style="font-size:14px;color:#64748b;">No hay otros llamados nuevos hoy.</p>`

  const nichesSection =
    niches.length > 0
      ? `<div style="background:#ffffff;padding:0 24px 24px 24px;">
      <h2 style="font-size:18px;color:#0f172a;margin:8px 0 16px 0;">Nichos detectados (${niches.length})</h2>
      ${niches.map(renderNicheItem).join('')}
    </div>`
      : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#0c1e3c;color:#ffffff;padding:24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:22px;">${escapeHtml(company.companyName)}</h1>
      <p style="margin:6px 0 0 0;font-size:14px;color:#cbd5e1;">${escapeHtml(formattedDate)}</p>
    </div>

    <div style="display:flex;background:#0f2740;color:#ffffff;padding:16px 24px;">
      <div style="flex:1;text-align:center;">
        <div style="font-size:20px;font-weight:700;">${totalFound}</div>
        <div style="font-size:12px;color:#cbd5e1;">Total encontrados</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:20px;font-weight:700;">${otherCount + relevantCount}</div>
        <div style="font-size:12px;color:#cbd5e1;">Nuevos hoy</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="font-size:20px;font-weight:700;">${relevantCount}</div>
        <div style="font-size:12px;color:#cbd5e1;">Relevantes</div>
      </div>
    </div>

    ${urgentSection}

    <div style="background:#ffffff;padding:24px;">
      <h2 style="font-size:18px;color:#0f172a;margin:0 0 16px 0;">Relevantes para postular (${relevantCount})</h2>
      ${opportunityCards}

      <h2 style="font-size:18px;color:#0f172a;margin:24px 0 16px 0;">Otros llamados nuevos (${otherCount})</h2>
      ${otherList}
    </div>

    ${nichesSection}

    <div style="background:#e2e8f0;padding:16px 24px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0 0 4px 0;font-size:13px;">
        <a href="${ARCE_URL}" style="color:#0c1e3c;text-decoration:none;">Ir a Compras Estatales (ARCE)</a>
      </p>
      <p style="margin:0;font-size:12px;color:#64748b;">Generado automáticamente por Cribal</p>
    </div>
  </div>
</body>
</html>`
}

/**
 * Send the daily digest email via Resend. Section 1 lists the saved (relevant)
 * opportunities; section 2 lists the other new tenders. Nothing is sent when
 * both lists are empty.
 */
export async function sendDigest(
  savedOpportunities: Opportunity[],
  allNewTenders: NormalizedTender[],
  company: CompanyConfig,
  runId: string,
  niches: NicheDigestItem[] = []
): Promise<void> {
  if (savedOpportunities.length === 0 && allNewTenders.length === 0) {
    console.log(
      `[CRIBAL][EMAIL] Sin oportunidades ni llamados nuevos — no se envía email (run ${runId})`
    )
    return
  }

  // Section 2 shows new tenders that were not saved as relevant opportunities.
  const savedIds = new Set(savedOpportunities.map((o) => o.opportunityId))
  const otherTenders = allNewTenders.filter((t) => !savedIds.has(t.opportunityId))

  // Urgent section: opportunities closing within 3 business days (from the DB,
  // enriched on previous runs).
  const urgentOpportunities = (await getUrgentOpportunities(company.id)).filter(
    (opp) => opp.closingDate !== null && getBusinessDaysUntilClosing(opp.closingDate) <= 3
  )

  const now = new Date()
  const formattedDate = formatSpanishDate(now)
  const relevantCount = savedOpportunities.length
  const subject = `Cribal — ${relevantCount} oportunidad(es) relevante(s) · ${formattedDate}`

  const html = buildHtml(
    savedOpportunities,
    otherTenders,
    urgentOpportunities,
    niches,
    company,
    formattedDate,
    allNewTenders.length
  )

  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  await getResend().emails.send({
    from,
    to: company.notificationEmails,
    subject,
    html,
  })

  console.log(
    `[CRIBAL][EMAIL] Email enviado a ${company.notificationEmails.join(', ')} — ${relevantCount} relevantes, ${otherTenders.length} otros nuevos`
  )
}
