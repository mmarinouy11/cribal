import { Resend } from 'resend'

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

interface WelcomeEmailData {
  to: string
  userName: string
  companyName: string
}

function buildHtml(userName: string, companyName: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#1e3a5f;color:#ffffff;padding:24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:22px;">🔎 Cribal</h1>
    </div>

    <div style="background:#ffffff;padding:24px;">
      <h2 style="margin:0 0 12px 0;font-size:20px;color:#0f172a;">¡Bienvenido, ${escapeHtml(userName)}!</h2>
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">
        Tu cuenta para <strong>${escapeHtml(companyName)}</strong> ya está creada. Cribal monitorea
        las publicaciones de compras estatales de Uruguay (ARCE), detecta oportunidades de negocio
        con IA y te avisa por email.
      </p>

      <h3 style="margin:20px 0 8px 0;font-size:16px;color:#0f172a;">Qué sigue ahora</h3>
      <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:#334155;">
        <li style="margin-bottom:6px;">El pipeline correrá automáticamente esta noche (L-V 20:00).</li>
        <li style="margin-bottom:6px;">Recibirás un email con las oportunidades detectadas.</li>
        <li style="margin-bottom:6px;">Podés correr el pipeline manualmente desde el dashboard.</li>
      </ol>

      <a href="${APP_URL}" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#1e3a5f;padding:10px 18px;border-radius:6px;text-decoration:none;">Ir al dashboard</a>

      <p style="margin:20px 0 0 0;font-size:13px;color:#64748b;">
        💡 Tip: completá tu perfil de empresa para obtener propuestas más personalizadas.
      </p>
    </div>

    <div style="background:#e2e8f0;padding:16px 24px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#64748b;">Cribal · Inteligencia de oportunidades</p>
    </div>
  </div>
</body>
</html>`
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<void> {
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  await getResend().emails.send({
    from,
    to: data.to,
    subject: `Bienvenido a Cribal — ${data.companyName}`,
    html: buildHtml(data.userName, data.companyName),
  })

  console.log(`[CRIBAL][EMAIL] Email de bienvenida enviado a ${data.to}`)
}
