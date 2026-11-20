import { Resend } from 'resend'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) cachedResend = new Resend(process.env.RESEND_API_KEY)
  return cachedResend
}

/** UTC calendar day, "YYYY-MM-DD". */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

interface AdminAlert {
  kind: string // dedupe key suffix, so each alert type fires once per day
  title: string
  subject: string
  companiesAffected: number
  errorSummary?: string
}

/**
 * Send one admin alert, at most once per day per kind. The first call of the day
 * claims the day's `AdminAlertLog` row (alertDate = "YYYY-MM-DD:<kind>"); later
 * calls see the unique-key clash and return. When `ADMIN_ALERT_EMAIL` is set an
 * email is sent; otherwise it only logs. The daily guard holds either way.
 */
async function sendAdminAlertOncePerDay(alert: AdminAlert): Promise<void> {
  const day = todayKey()
  const alertDate = `${day}:${alert.kind}`

  try {
    await prisma.adminAlertLog.create({
      data: {
        alertDate,
        companiesAffected: alert.companiesAffected,
        errorSummary: alert.errorSummary ?? null,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.log(`[CRIBAL][ADMIN] Aviso "${alert.kind}" ya enviado hoy (${day}) — se omite`)
      return
    }
    throw error
  }

  const detail = alert.errorSummary ?? 'no disponible'
  const logMessage = `[CRIBAL][ADMIN] ${alert.title} — ${alert.companiesAffected} empresa(s) el ${day}. Detalle: ${detail}`

  const to = process.env.ADMIN_ALERT_EMAIL
  if (!to) {
    console.warn(`${logMessage} (ADMIN_ALERT_EMAIL no definido — solo log)`)
    return
  }

  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'
  const html = `
    <h2>${alert.title}</h2>
    <ul>
      <li><strong>Fecha:</strong> ${day}</li>
      <li><strong>Empresas afectadas:</strong> ${alert.companiesAffected}</li>
      <li><strong>Detalle:</strong> ${detail}</li>
    </ul>
    <p>Este aviso se envía como máximo una vez por día.</p>`

  await getResend().emails.send({ from, to, subject: alert.subject, html })
  console.log(`${logMessage} — aviso enviado a ${to}`)
}

/** Alert that ARCE is unreachable (every company's feeds are down). */
export async function sendAdminFeedsDownAlert(
  companiesAffected: number,
  errorSummary?: string
): Promise<void> {
  await sendAdminAlertOncePerDay({
    kind: 'feeds_down',
    title: 'ARCE no responde',
    subject: `Cribal · ARCE no responde (${todayKey()})`,
    companiesAffected,
    errorSummary,
  })
}

/** Alert that the Anthropic API has no credit (billing error). */
export async function sendAdminAiBillingAlert(
  companiesAffected: number,
  errorSummary?: string
): Promise<void> {
  await sendAdminAlertOncePerDay({
    kind: 'ai_billing',
    title: 'Servicio de IA sin crédito',
    subject: `Cribal · Servicio de IA sin crédito (${todayKey()})`,
    companiesAffected,
    errorSummary,
  })
}
