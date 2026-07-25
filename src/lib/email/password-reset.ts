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

interface PasswordResetEmailData {
  to: string
  userName: string
  tempPassword: string
}

export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<void> {
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#1e3a5f;color:#ffffff;padding:24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:22px;">🔎 Cribal</h1>
    </div>
    <div style="background:#ffffff;padding:24px;">
      <h2 style="margin:0 0 12px 0;font-size:18px;color:#0f172a;">Restablecimiento de contraseña</h2>
      <p style="margin:0 0 12px 0;font-size:14px;color:#334155;">Hola ${escapeHtml(data.userName)},</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#334155;">
        Un administrador restableció tu contraseña. Tu contraseña temporal es:
      </p>
      <p style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:#1e3a5f;letter-spacing:1px;">
        ${escapeHtml(data.tempPassword)}
      </p>
      <p style="margin:0 0 16px 0;font-size:14px;color:#334155;">
        Ingresá con esta contraseña y cambiala cuanto antes.
      </p>
      <a href="${APP_URL}/login" style="display:inline-block;font-size:14px;font-weight:600;color:#ffffff;background:#1e3a5f;padding:10px 18px;border-radius:6px;text-decoration:none;">Iniciar sesión</a>
    </div>
    <div style="background:#e2e8f0;padding:16px 24px;border-radius:0 0 8px 8px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#64748b;">Cribal · Inteligencia de oportunidades</p>
    </div>
  </div>
</body>
</html>`

  await getResend().emails.send({
    from,
    to: data.to,
    subject: 'Cribal — Restablecimiento de contraseña',
    html,
  })

  console.log(`[CRIBAL][EMAIL] Email de reseteo de contraseña enviado a ${data.to}`)
}
