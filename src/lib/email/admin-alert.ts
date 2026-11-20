import { Resend } from 'resend'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) cachedResend = new Resend(process.env.RESEND_API_KEY)
  return cachedResend
}

/** UTC calendar day, "YYYY-MM-DD", used as the once-per-day alert key. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Alert the administrator that ARCE is unreachable from here (every company's
 * feeds are down). Fires at most once per day: the first call of the day claims
 * the day's `AdminAlertLog` row; later calls see the unique-key clash and return.
 *
 * When `ADMIN_ALERT_EMAIL` is set, an email is sent; otherwise it only logs. The
 * daily guard is enforced either way.
 */
export async function sendAdminFeedsDownAlert(
  companiesAffected: number,
  errorSummary?: string
): Promise<void> {
  const alertDate = todayKey()

  // Claim today's slot first; a clash means the alert already went out today.
  try {
    await prisma.adminAlertLog.create({
      data: { alertDate, companiesAffected, errorSummary: errorSummary ?? null },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.log(`[CRIBAL][ADMIN] Aviso de ARCE caído ya enviado hoy (${alertDate}) — se omite`)
      return
    }
    throw error
  }

  const summaryLine = errorSummary ? `Error: ${errorSummary}` : 'Error: no disponible'
  const logMessage = `[CRIBAL][ADMIN] ARCE no responde — ${companiesAffected} empresa(s) afectada(s) el ${alertDate}. ${summaryLine}`

  const to = process.env.ADMIN_ALERT_EMAIL
  if (!to) {
    console.warn(`${logMessage} (ADMIN_ALERT_EMAIL no definido — solo log)`)
    return
  }

  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'
  const html = `
    <h2>ARCE no responde</h2>
    <p>El pipeline de Cribal no pudo leer ningún feed de ARCE
    (<code>comprasestatales.gub.uy</code>) en la última corrida.</p>
    <ul>
      <li><strong>Fecha:</strong> ${alertDate}</li>
      <li><strong>Empresas afectadas:</strong> ${companiesAffected}</li>
      <li><strong>Detalle:</strong> ${errorSummary ?? 'no disponible'}</li>
    </ul>
    <p>Se reintentará automáticamente en la próxima corrida. Este aviso se envía
    como máximo una vez por día.</p>`

  await getResend().emails.send({
    from,
    to,
    subject: `Cribal · ARCE no responde (${alertDate})`,
    html,
  })
  console.log(`${logMessage} — aviso enviado a ${to}`)
}
