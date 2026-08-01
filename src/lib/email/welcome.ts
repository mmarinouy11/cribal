import { Resend } from 'resend'
import { APP_URL, emailShell, escapeHtml, renderFooter, renderHeader } from './branding'

let cachedResend: Resend | null = null

function getResend(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(process.env.RESEND_API_KEY)
  }
  return cachedResend
}

interface WelcomeEmailData {
  to: string
  userName: string
  companyName: string
}

export function buildWelcomeHtml(userName: string, companyName: string): string {
  const content = `
  <tr>
    <td style="background:#ffffff;padding:24px 28px;">
      <div style="font-size:20px;font-weight:700;color:#0c1e3c;margin:0 0 12px 0;">¡Bienvenido, ${escapeHtml(userName)}!</div>
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">
        Tu cuenta para <strong>${escapeHtml(companyName)}</strong> ya está creada. Cribal monitorea
        las publicaciones de compras estatales de Uruguay (ARCE), detecta oportunidades de negocio
        con IA y te avisa por email.
      </p>

      <div style="font-size:16px;font-weight:700;color:#0c1e3c;margin:20px 0 8px 0;">Qué sigue ahora</div>
      <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:#334155;">
        <li style="margin-bottom:6px;">El pipeline correrá automáticamente en el próximo ciclo (días hábiles a la mañana).</li>
        <li style="margin-bottom:6px;">Recibirás un email con las oportunidades detectadas.</li>
        <li style="margin-bottom:6px;">Podés correr el pipeline manualmente desde el dashboard.</li>
      </ol>

      <a href="${APP_URL}" target="_blank" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#0c1e3c;padding:10px 18px;border-radius:6px;text-decoration:none;">Ir al dashboard</a>

      <p style="margin:20px 0 0 0;font-size:13px;color:#64748b;">
        Tip: completá tu perfil de empresa para obtener propuestas más personalizadas.
      </p>
    </td>
  </tr>`

  return emailShell(`
    ${renderHeader(companyName)}
    ${content}
    ${renderFooter()}
  `)
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  await getResend().emails.send({
    from,
    to: data.to,
    subject: `Cribal · ${data.companyName} — Cuenta creada`,
    html: buildWelcomeHtml(data.userName, data.companyName),
  })

  console.log(`[CRIBAL][EMAIL] Email de bienvenida enviado a ${data.to}`)
}
