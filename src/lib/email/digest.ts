import { Resend } from 'resend'
import type { CompanyConfig, NicheCategory, Opportunity } from '@prisma/client'
import type { NormalizedTender } from '../pipeline/normalizer'
import { getUrgentOpportunities, getBusinessDaysUntilClosing } from '../pipeline/urgency'
import { formatDateTime, formatRelativeTime } from '../format'
import {
  APP_URL,
  emailShell,
  escapeHtml,
  longDate,
  renderFooter,
  renderHeader,
  scoreBadgeColors,
  shortDate,
} from './branding'

/** Minimal niche shape the digest needs — high-signal niches detected in a run. */
export interface NicheDigestItem {
  id: string
  label: string
  category: NicheCategory
  failureCount: number
  lastFailureAt: Date
}

const MAX_OTHER_TENDERS = 15

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY)
  }
  return cachedResend
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

/**
 * "Cribal · {companyName} — {headline} · {dd/mm}". The headline is the relevant
 * count when there are relevants, otherwise the new-tender count; niches are
 * appended only when some were detected. No emoji.
 */
export function buildSubject(
  companyName: string,
  relevantCount: number,
  newCount: number,
  nicheCount: number,
  date: Date
): string {
  let headline: string
  if (relevantCount > 0) {
    headline = `${relevantCount} relevante${relevantCount === 1 ? '' : 's'}`
  } else {
    headline = `${newCount} nuevo${newCount === 1 ? '' : 's'} llamado${newCount === 1 ? '' : 's'}`
  }
  if (nicheCount > 0) {
    headline += ` · ${nicheCount} nicho${nicheCount === 1 ? '' : 's'}`
  }
  return `Cribal · ${companyName} — ${headline} · ${shortDate(date)}`
}

// ---------------------------------------------------------------------------
// Stats bar (table-based — reliable across email clients)
// ---------------------------------------------------------------------------

function renderStats(totalFound: number, newToday: number, relevantCount: number): string {
  const cell = (value: number, label: string, valueColor: string, borders: boolean) => `
        <td width="33.33%" align="center" style="padding:16px 8px;${
          borders ? 'border-left:1px solid #1e3a5f;border-right:1px solid #1e3a5f;' : ''
        }">
          <div style="font-size:24px;font-weight:700;color:${valueColor};line-height:1;">${value}</div>
          <div style="font-size:11px;color:#7dd3fc;margin-top:4px;">${label}</div>
        </td>`

  return `
  <tr>
    <td style="background-color:#0c1e3c;padding:0 28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${cell(totalFound, 'Total encontrados', '#ffffff', false)}
          ${cell(newToday, 'Nuevos hoy', '#ffffff', true)}
          ${cell(relevantCount, 'Relevantes', '#06b6d4', false)}
        </tr>
      </table>
    </td>
  </tr>`
}

// ---------------------------------------------------------------------------
// Content sections
// ---------------------------------------------------------------------------

function renderUrgentItem(opp: Opportunity): string {
  const businessDays = opp.closingDate ? getBusinessDaysUntilClosing(opp.closingDate) : 0
  const closing = opp.closingDate ? escapeHtml(formatDateTime(opp.closingDate)) : ''
  const organismo = opp.organismo ? escapeHtml(opp.organismo) : '—'
  const link = `${APP_URL}/oportunidades/${opp.id}?tab=detalle`
  return `
      <a href="${link}" target="_blank" style="font-size:15px;font-weight:700;color:#0c1e3c;text-decoration:none;">${escapeHtml(opp.title)}</a>
      <div style="font-size:13px;font-weight:700;color:#dc2626;margin-top:4px;">CIERRA EN ${businessDays} DÍA${businessDays === 1 ? '' : 'S'} HÁBIL${businessDays === 1 ? '' : 'ES'}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${organismo} · ${closing} · Score ${opp.score}</div>
      <div style="margin-top:6px;"><a href="${link}" target="_blank" style="font-size:13px;font-weight:600;color:#06b6d4;text-decoration:none;">Ver oportunidad →</a></div>`
}

function renderUrgentSection(urgent: Opportunity[]): string {
  if (urgent.length === 0) return ''
  const items = urgent
    .map(renderUrgentItem)
    .join('<div style="height:1px;background:#fecaca;margin:14px 0;"></div>')
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:8px;padding:16px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.5px;color:#dc2626;margin-bottom:12px;">CIERRAN PRONTO</div>
            ${items}
          </td>
        </tr>
      </table>`
}

function renderRelevantCard(opp: Opportunity): string {
  const badge = scoreBadgeColors(opp.score)
  const category = opp.category ? escapeHtml(opp.category) : ''
  const summary = opp.summary ? escapeHtml(opp.summary) : ''
  const play = opp.recommendedPlay ? escapeHtml(opp.recommendedPlay) : ''
  const organismo = opp.organismo ? escapeHtml(opp.organismo) : ''
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="border:1px solid #e0f2fe;border-radius:8px;padding:16px;background:#ffffff;">
            <span style="display:inline-block;font-weight:700;font-size:13px;padding:3px 10px;border-radius:9999px;color:${badge.color};background:${badge.background};">Score ${opp.score}</span>
            ${
              category
                ? `<span style="display:inline-block;margin-left:6px;font-size:12px;padding:3px 10px;border-radius:9999px;color:#0e7490;background:#e0f2fe;">${category}</span>`
                : ''
            }
            <div style="font-size:16px;font-weight:600;color:#0c1e3c;margin-top:10px;">${escapeHtml(opp.title)}</div>
            ${organismo ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">${organismo}</div>` : ''}
            ${summary ? `<div style="font-size:14px;color:#0c1e3c;margin-top:8px;">${summary}</div>` : ''}
            ${
              play
                ? `<div style="font-size:14px;color:#0c1e3c;margin-top:8px;"><strong>Ángulo comercial:</strong> ${play}</div>`
                : ''
            }
            <div style="margin-top:14px;">
              <a href="${escapeHtml(opp.url)}" target="_blank" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#0c1e3c;padding:9px 16px;border-radius:6px;text-decoration:none;">Ver licitación →</a>
            </div>
          </td>
        </tr>
      </table>`
}

function renderRelevantSection(relevant: Opportunity[]): string {
  if (relevant.length === 0) {
    // No empty block — just one explanatory line.
    return `<div style="font-size:14px;color:#64748b;margin-bottom:8px;">Sin oportunidades relevantes hoy. Abajo, los llamados nuevos del período.</div>`
  }
  return `
      <div style="font-size:18px;font-weight:700;color:#0c1e3c;margin:0 0 16px 0;">Relevantes para postular (${relevant.length})</div>
      ${relevant.map(renderRelevantCard).join('')}`
}

function renderOtherItem(tender: NormalizedTender): string {
  const description = tender.description ? escapeHtml(tender.description.slice(0, 100)) : ''
  const organismo = tender.organismo ? escapeHtml(tender.organismo) : ''
  return `
      <div style="padding:10px 0;border-top:1px solid #e0f2fe;">
        <a href="${escapeHtml(tender.url)}" target="_blank" style="font-size:14px;font-weight:600;color:#0c1e3c;text-decoration:none;">${escapeHtml(tender.title)}</a>
        ${description ? `<div style="font-size:13px;color:#64748b;margin-top:2px;">${description}</div>` : ''}
        ${organismo ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px;">${organismo}</div>` : ''}
      </div>`
}

function renderOtherSection(others: NormalizedTender[]): string {
  const heading = `<div style="font-size:18px;font-weight:700;color:#0c1e3c;margin:24px 0 8px 0;">Otros llamados nuevos (${others.length})</div>`
  if (others.length === 0) {
    return `${heading}<div style="font-size:14px;color:#64748b;">No hay otros llamados nuevos hoy.</div>`
  }
  const shown = others.slice(0, MAX_OTHER_TENDERS)
  const rest = others.length - shown.length
  const more =
    rest > 0
      ? `<div style="padding-top:12px;"><a href="${APP_URL}/oportunidades" target="_blank" style="font-size:13px;font-weight:600;color:#06b6d4;text-decoration:none;">y ${rest} llamado${rest === 1 ? '' : 's'} más — ver todos en Cribal →</a></div>`
      : ''
  return `${heading}${shown.map(renderOtherItem).join('')}${more}`
}

function nicheCategoryLabel(category: NicheCategory): string {
  if (category === 'NUCLEO') return 'Núcleo'
  if (category === 'ADYACENTE') return 'Adyacente'
  return 'Fuera'
}

function renderNicheItem(niche: NicheDigestItem): string {
  const link = `${APP_URL}/nichos/${niche.id}`
  const category = escapeHtml(nicheCategoryLabel(niche.category))
  const relative = escapeHtml(formatRelativeTime(niche.lastFailureAt))
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
        <tr>
          <td style="border:1px solid #e0f2fe;border-left:4px solid #8b5cf6;border-radius:8px;padding:14px;background:#ffffff;">
            <div style="font-size:15px;font-weight:600;color:#0c1e3c;">${escapeHtml(niche.label)}</div>
            <div style="font-size:13px;color:#64748b;margin-top:4px;">${category} · ${niche.failureCount} llamado${niche.failureCount === 1 ? '' : 's'} fallido${niche.failureCount === 1 ? '' : 's'} · último ${relative}</div>
            <div style="margin-top:6px;"><a href="${link}" target="_blank" style="font-size:13px;font-weight:600;color:#06b6d4;text-decoration:none;">Ver nicho →</a></div>
          </td>
        </tr>
      </table>`
}

function renderNichesSection(niches: NicheDigestItem[]): string {
  if (niches.length === 0) return ''
  return `
      <div style="font-size:18px;font-weight:700;color:#0c1e3c;margin:24px 0 16px 0;">Nichos detectados (${niches.length})</div>
      ${niches.map(renderNicheItem).join('')}`
}

function renderContent(
  relevant: Opportunity[],
  others: NormalizedTender[],
  urgent: Opportunity[],
  niches: NicheDigestItem[]
): string {
  return `
  <tr>
    <td style="background:#ffffff;padding:24px 28px;">
      ${renderUrgentSection(urgent)}
      ${renderRelevantSection(relevant)}
      ${renderOtherSection(others)}
      ${renderNichesSection(niches)}
    </td>
  </tr>`
}

export function buildDigestHtml(
  savedOpportunities: Opportunity[],
  otherTenders: NormalizedTender[],
  urgentOpportunities: Opportunity[],
  niches: NicheDigestItem[],
  company: CompanyConfig,
  dateLabel: string,
  totalFound: number
): string {
  const relevantCount = savedOpportunities.length
  const newToday = relevantCount + otherTenders.length

  return emailShell(`
    ${renderHeader(company.companyName, dateLabel)}
    ${renderStats(totalFound, newToday, relevantCount)}
    ${renderContent(savedOpportunities, otherTenders, urgentOpportunities, niches)}
    ${renderFooter()}
  `)
}

/**
 * Send the daily digest email via Resend. Relevant opportunities render as full
 * cards; other new tenders as a compact list; niches (high-signal, new) as their
 * own section. Nothing is sent when there are no opportunities and no tenders.
 */
export async function sendDigest(
  savedOpportunities: Opportunity[],
  allNewTenders: NormalizedTender[],
  company: CompanyConfig,
  runId: string,
  niches: NicheDigestItem[] = []
): Promise<void> {
  const hasRelevant = savedOpportunities.length > 0

  // If the company only wants emails when there are relevant opportunities, skip
  // the digest on days without any relevant matches.
  if (company.emailOnlyWhenRelevant && !hasRelevant) {
    console.log(
      `[CRIBAL][EMAIL] Omitiendo email para ${company.companyName} — sin relevantes y modo solo-relevantes activo (run ${runId})`
    )
    return
  }

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
  const relevantCount = savedOpportunities.length
  const subject = buildSubject(
    company.companyName,
    relevantCount,
    allNewTenders.length,
    niches.length,
    now
  )

  const html = buildDigestHtml(
    savedOpportunities,
    otherTenders,
    urgentOpportunities,
    niches,
    company,
    longDate(now),
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
