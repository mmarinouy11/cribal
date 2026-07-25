import type { Session } from 'next-auth'

/**
 * Resolve which company's data a request should see. Regular users are always
 * pinned to their own company. Admins may override via a `companyId` param to
 * inspect any company; without the param they fall back to their own.
 */
export function getEffectiveCompanyId(
  session: Session,
  companyIdParam: string | undefined
): string {
  if (session.user.role === 'ADMIN' && companyIdParam) {
    return companyIdParam
  }
  return session.user.companyId
}
