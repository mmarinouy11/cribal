import { Resend } from 'resend'
import type { CompanyConfig, Opportunity } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getBusinessDaysUntilClosing } from '@/lib/pipeline/urgency'
import { startOfDay } from '@/lib/dates'
import { formatDateTime } from '@/lib/format'

const APP_URL = 'https://cribal-production.up.railway.app'

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY)
  }
  return cachedResend
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function alreadySentToday(sentAt: Date | null): boolean {
  if (!sentAt) return false
  return startOfDay(sentAt).getTime() === startOfDay(new Date()).getTime()
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
  const link = `${APP_URL}/oportunidades/${opportunity.id}?tab=detalle`

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#dc2626;color:#ffffff;padding:20px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;">⚡ Cierre próximo</h1>
    </div>
    <div style="background:#ffffff;padding:24px;">
      <h2 style="margin:0 0 8px 0;font-size:18px;color:#0f172a;">${escapeHtml(opportunity.title)}</h2>
      <p style="margin:0 0 4px 0;font-size:14px;color:#334155;">
        <strong>Organismo:</strong> ${escapeHtml(opportunity.organismo ?? '—')}
      </p>
      <p style="margin:0 0 4px 0;font-size:14px;color:#dc2626;font-weight:700;">
        Cierra en ${businessDays} día(s) hábil(es) — ${escapeHtml(formatDateTime(opportunity.closingDate))}
      </p>
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">
        <strong>Score:</strong> ${opportunity.score}/10
      </p>
      <a href="${link}" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#1e3a5f;padding:10px 18px;border-radius:6px;text-decoration:none;">Ver oportunidad →</a>
    </div>
    <div style="background:#e2e8f0;padding:16px 24px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#64748b;">Cribal · Inteligencia de oportunidades</p>
    </div>
  </div>
</body>
</html>`

  await getResend().emails.send({
    from,
    to: company.notificationEmails,
    subject: `⚡ Cribal — Cierra en ${businessDays} días: ${opportunity.title}`,
    html,
  })

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: { urgencyAlertSentAt: new Date() },
  })

  console.log(
    `[CRIBAL][EMAIL] Alerta de urgencia enviada para ${opportunity.title} (${businessDays} días hábiles)`
  )
}
