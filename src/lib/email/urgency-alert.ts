import { Resend } from 'resend'
import type { CompanyConfig, Opportunity } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getBusinessDaysUntilClosing } from '@/lib/pipeline/urgency'
import { startOfDay } from '@/lib/dates'
import { formatDateTime } from '@/lib/format'
import { APP_URL, emailShell, escapeHtml, renderFooter, renderHeader, shortDate } from './branding'

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY)
  }
  return cachedResend
}

function alreadySentToday(sentAt: Date | null): boolean {
  if (!sentAt) return false
  return startOfDay(sentAt).getTime() === startOfDay(new Date()).getTime()
}

export function buildUrgencyHtml(
  opportunity: Opportunity,
  companyName: string,
  businessDays: number
): string {
  const link = `${APP_URL}/oportunidades/${opportunity.id}?tab=detalle`
  const organismo = escapeHtml(opportunity.organismo ?? '—')
  const closing = escapeHtml(formatDateTime(opportunity.closingDate as Date))

  const content = `
  <tr>
    <td style="background:#ffffff;padding:24px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:8px;padding:16px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.5px;color:#dc2626;margin-bottom:12px;">CIERRAN PRONTO</div>
            <div style="font-size:16px;font-weight:700;color:#0c1e3c;">${escapeHtml(opportunity.title)}</div>
            <div style="font-size:13px;font-weight:700;color:#dc2626;margin-top:6px;">CIERRA EN ${businessDays} DÍA${businessDays === 1 ? '' : 'S'} HÁBIL${businessDays === 1 ? '' : 'ES'} — ${closing}</div>
            <div style="font-size:13px;color:#64748b;margin-top:4px;">${organismo} · Score ${opportunity.score}</div>
            <div style="margin-top:14px;">
              <a href="${link}" target="_blank" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#0c1e3c;padding:9px 16px;border-radius:6px;text-decoration:none;">Ver oportunidad →</a>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`

  return emailShell(`
    ${renderHeader(companyName, 'Cierre próximo')}
    ${content}
    ${renderFooter()}
  `)
}

/**
 * Send an immediate urgency alert for an opportunity closing soon. No-op if the
 * opportunity has no closing date or an alert was already sent today.
 */
export async function sendUrgencyAlert(
  opportunity: Opportunity,
  company: CompanyConfig
): Promise<void> {
  if (!opportunity.closingDate) return
  if (alreadySentToday(opportunity.urgencyAlertSentAt)) return
  if (company.notificationEmails.length === 0) return

  const businessDays = getBusinessDaysUntilClosing(opportunity.closingDate)
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  const subject = `Cribal · ${company.companyName} — Cierra en ${businessDays} día${
    businessDays === 1 ? '' : 's'
  }: ${opportunity.title} · ${shortDate(new Date())}`

  await getResend().emails.send({
    from,
    to: company.notificationEmails,
    subject,
    html: buildUrgencyHtml(opportunity, company.companyName, businessDays),
  })

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: { urgencyAlertSentAt: new Date() },
  })

  console.log(
    `[CRIBAL][EMAIL] Alerta de urgencia enviada para ${opportunity.title} (${businessDays} días hábiles)`
  )
}
