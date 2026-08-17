import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { ConfigForm, type ConfigFormValues } from '@/components/config/config-form'

export default async function ConfigurationPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const [company, profile] = await Promise.all([
    prisma.companyConfig.findUnique({ where: { id: session.user.companyId } }),
    prisma.companyProfile.findUnique({ where: { companyId: session.user.companyId } }),
  ])
  if (!company) redirect('/login')

  const initial: ConfigFormValues = {
    notificationEmails: company.notificationEmails,
    minimumScore: company.minimumScore,
    lookbackDays: company.lookbackDays,
    rssFeeds: company.rssFeeds,
    excludedKeywords: company.excludedKeywords,
    excludedProducts: company.excludedProducts,
    customAiPrompt: company.customAiPrompt ?? '',
  }

  // The AI-regenerate infers feeds and filters from the company profile.
  const regenContext = {
    companyName: company.companyName,
    description: profile?.longDescription || company.description || '',
    capabilities: company.capabilities,
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">
          Configuración del sistema
        </h1>
        <p className="text-sm text-[#6b7280]">
          Ajustá los parámetros de la criba de {company.companyName}.
        </p>
      </header>

      <ConfigForm
        initial={initial}
        lastSuccessfulRunAt={company.lastSuccessfulRunAt}
        regenContext={regenContext}
      />
    </div>
  )
}
