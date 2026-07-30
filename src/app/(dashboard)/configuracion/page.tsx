import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { ConfigForm, type ConfigFormValues } from '@/components/config/config-form'

export default async function ConfigurationPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const company = await prisma.companyConfig.findUnique({
    where: { id: session.user.companyId },
  })
  if (!company) redirect('/login')

  const initial: ConfigFormValues = {
    companyName: company.companyName,
    description: company.description ?? '',
    notificationEmails: company.notificationEmails,
    minimumScore: company.minimumScore,
    lookbackDays: company.lookbackDays,
    capabilities: company.capabilities,
    rssFeeds: company.rssFeeds,
    relevantKeywords: company.relevantKeywords,
    excludedKeywords: company.excludedKeywords,
    excludedProducts: company.excludedProducts,
    customAiPrompt: company.customAiPrompt ?? '',
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#111827]">Configuración</h1>
        <p className="text-sm text-[#6b7280]">
          Ajustá los parámetros del pipeline de {company.companyName}.
        </p>
      </header>

      <ConfigForm initial={initial} lastSuccessfulRunAt={company.lastSuccessfulRunAt} />
    </div>
  )
}
