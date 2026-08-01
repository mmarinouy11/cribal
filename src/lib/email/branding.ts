// Shared email branding (Navy + Cyan). Email clients are unreliable with modern
// CSS, so everything here is table-based with inline styles only — no flexbox,
// grid, <style> blocks, or emoji.

export const APP_URL = 'https://cribal-production.up.railway.app'
const LOGO_URL = `${APP_URL}/logo-email.png`

// Palette (kept in sync with the app design system).
export const EMAIL_COLORS = {
  navy: '#0c1e3c',
  darkSeparator: '#1e3a5f',
  onDarkPrimary: '#f0f9ff',
  onDarkSecondary: '#7dd3fc',
  bodyBg: '#f0f9ff',
  card: '#ffffff',
  cardBorder: '#e0f2fe',
  textPrimary: '#0c1e3c',
  textSecondary: '#64748b',
  accent: '#06b6d4',
} as const

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** dd/mm — compact date for subjects. */
export function shortDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

/** Long Spanish date, e.g. "sábado, 1 de agosto de 2026". */
export function longDate(date: Date): string {
  return new Intl.DateTimeFormat('es-UY', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** Score badge colors, matching the app. */
export function scoreBadgeColors(score: number): { color: string; background: string } {
  if (score >= 9) return { color: '#065f46', background: '#d1fae5' }
  if (score >= 7) return { color: '#0e7490', background: '#cffafe' }
  return { color: '#92400e', background: '#fef3c7' }
}

/**
 * Navy header row: logo + wordmark, a bold primary line and an optional cyan
 * secondary line. `smallLine` is typically the long date. The logo is a real PNG
 * (clients don't render SVG); if images are blocked the alt text shows instead of
 * a broken image.
 */
export function renderHeader(bigLine: string, smallLine?: string): string {
  return `
  <tr>
    <td style="background-color:${EMAIL_COLORS.navy};padding:24px 28px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="32" style="vertical-align:middle;">
            <img src="${LOGO_URL}" width="32" height="32" alt="Cribal" style="display:block;border-radius:8px;" />
          </td>
          <td style="padding-left:10px;vertical-align:middle;">
            <span style="font-size:17px;font-weight:600;color:${EMAIL_COLORS.onDarkPrimary};letter-spacing:-0.3px;">cribal</span>
          </td>
        </tr>
      </table>
      <div style="font-size:20px;font-weight:700;color:#ffffff;margin-top:16px;">${escapeHtml(bigLine)}</div>
      ${
        smallLine
          ? `<div style="font-size:13px;color:${EMAIL_COLORS.onDarkSecondary};margin-top:2px;">${escapeHtml(smallLine)}</div>`
          : ''
      }
    </td>
  </tr>`
}

/** Navy footer row. */
export function renderFooter(): string {
  return `
  <tr>
    <td style="background-color:${EMAIL_COLORS.navy};padding:20px 28px;text-align:center;">
      <a href="${APP_URL}" target="_blank" style="color:${EMAIL_COLORS.accent};font-size:13px;text-decoration:none;font-weight:500;">Abrir Cribal →</a>
      <div style="font-size:11px;color:${EMAIL_COLORS.textSecondary};margin-top:10px;">
        Inteligencia de oportunidades · Generado automáticamente
      </div>
    </td>
  </tr>`
}

/**
 * Wrap inner table rows in the responsive outer shell: a full-width background
 * table centering a 600px card. `rows` must be a sequence of `<tr>…</tr>`.
 */
export function emailShell(rows: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.bodyBg};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_COLORS.bodyBg};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-radius:12px;overflow:hidden;">
          ${rows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
