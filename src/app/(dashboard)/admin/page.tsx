import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RegistrationStatus } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table'
import { buttonClass } from '@/components/ui/button-styles'
import {
  CompanyStatusToggle,
  CompanyRunButton,
  UserRoleToggle,
  UserResetPasswordButton,
  RunAllButton,
} from '@/components/admin/admin-actions'
import { formatDateDMY, formatRelativeTime } from '@/lib/format'

const REGISTRATION_META: Record<RegistrationStatus, { label: string; className: string }> = {
  PENDING: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700' },
  ACTIVE: { label: 'Activa', className: 'bg-[#d1fae5] text-[#065f46]' },
  SUSPENDED: { label: 'Suspendida', className: 'bg-red-100 text-red-700' },
}

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/')

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [companies, lastRunPerCompany, users, lastRun, totalOpportunities, runsToday] =
    await Promise.all([
      prisma.companyConfig.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true, opportunities: true } } },
      }),
      prisma.run.groupBy({
        by: ['companyId'],
        _max: { startedAt: true },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: { company: { select: { companyName: true } } },
      }),
      prisma.run.findFirst({ orderBy: { startedAt: 'desc' } }),
      prisma.opportunity.count(),
      prisma.run.count({ where: { startedAt: { gte: startOfToday } } }),
    ])

  const lastRunMap = new Map(
    lastRunPerCompany.map((r) => [r.companyId, r._max.startedAt])
  )

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-[#0c1e3c]">Admin</h1>
        <p className="text-sm text-[#6b7280]">Gestión de empresas, usuarios y sistema.</p>
      </header>

      {/* Section 1 — Companies */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0c1e3c]">Empresas registradas</h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Empresa</Th>
                <Th>Estado</Th>
                <Th>Usuarios</Th>
                <Th>Oportunidades</Th>
                <Th>Última ejecución</Th>
                <Th>Registrada</Th>
                <Th>Acciones</Th>
              </Tr>
            </THead>
            <TBody>
              {companies.map((company) => {
                const lastRunAt = lastRunMap.get(company.id) ?? null
                const meta = REGISTRATION_META[company.registrationStatus]
                return (
                  <Tr key={company.id}>
                    <Td className="font-medium text-[#0c1e3c]">{company.companyName}</Td>
                    <Td>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </Td>
                    <Td>{company._count.users}</Td>
                    <Td>{company._count.opportunities}</Td>
                    <Td className="whitespace-nowrap text-[#6b7280]">
                      {lastRunAt ? formatRelativeTime(lastRunAt) : '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-[#6b7280]">
                      {formatDateDMY(company.registeredAt ?? company.createdAt)}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <CompanyStatusToggle
                          companyId={company.id}
                          status={company.registrationStatus}
                        />
                        <Link
                          href={`/oportunidades?companyId=${company.id}`}
                          className={buttonClass('secondary', 'sm')}
                        >
                          Ver oportunidades
                        </Link>
                        <CompanyRunButton companyId={company.id} />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        </Card>
      </section>

      {/* Section 2 — Users */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0c1e3c]">Usuarios</h2>
        <Card>
          <Table>
            <THead>
              <Tr>
                <Th>Nombre</Th>
                <Th>Email</Th>
                <Th>Empresa</Th>
                <Th>Rol</Th>
                <Th>Creado</Th>
                <Th>Acciones</Th>
              </Tr>
            </THead>
            <TBody>
              {users.map((user) => (
                <Tr key={user.id}>
                  <Td className="font-medium text-[#0c1e3c]">{user.name ?? '—'}</Td>
                  <Td className="text-[#6b7280]">{user.email}</Td>
                  <Td className="text-[#6b7280]">{user.company.companyName}</Td>
                  <Td>
                    <Badge
                      className={
                        user.role === 'ADMIN'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-gray-100 text-gray-600'
                      }
                    >
                      {user.role}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-[#6b7280]">
                    {formatDateDMY(user.createdAt)}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <UserRoleToggle userId={user.id} role={user.role} />
                      <UserResetPasswordButton userId={user.id} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      </section>

      {/* Section 3 — System status */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#0c1e3c]">Estado del sistema</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardBody>
              <div className="text-sm text-[#6b7280]">Última ejecución (global)</div>
              <div className="mt-1 text-lg font-semibold text-[#0c1e3c]">
                {lastRun ? formatRelativeTime(lastRun.startedAt) : '—'}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-sm text-[#6b7280]">Oportunidades en la base</div>
              <div className="mt-1 text-lg font-semibold text-[#0c1e3c]">
                {totalOpportunities}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-sm text-[#6b7280]">Ejecuciones hoy</div>
              <div className="mt-1 text-lg font-semibold text-[#0c1e3c]">{runsToday}</div>
            </CardBody>
          </Card>
        </div>
        <RunAllButton />
      </section>
    </div>
  )
}
