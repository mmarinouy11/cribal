import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { ProfileForm, type ProfileFormValues } from '@/components/config/profile-form'

const DEFAULT_PRIMARY = '#0c1e3c'
const DEFAULT_SECONDARY = '#06b6d4'

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const [profile, company] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { companyId: session.user.companyId } }),
    prisma.companyConfig.findUnique({ where: { id: session.user.companyId } }),
  ])

  const initial: ProfileFormValues = {
    legalName: profile?.legalName ?? '',
    rut: profile?.rut ?? '',
    isPyme: profile?.isPyme ?? false,
    logoUrl: profile?.logoUrl ?? '',
    brandColorPrimary: profile?.brandColorPrimary ?? DEFAULT_PRIMARY,
    brandColorSecondary: profile?.brandColorSecondary ?? DEFAULT_SECONDARY,
    longDescription: profile?.longDescription ?? '',
    founded: profile?.founded ?? '',
    teamSize: profile?.teamSize ?? '',
    capabilities: company?.capabilities ?? [],
    relevantKeywords: company?.relevantKeywords ?? [],
    caseStudies: profile?.caseStudies ?? '',
    certifications: profile?.certifications ?? '',
    differentiators: profile?.differentiators ?? '',
    proposalTemplate: profile?.proposalTemplate ?? '',
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">Mi empresa</h1>
        <p className="text-sm text-[#6b7280]">
          Identidad, capacidades y datos que la IA usa para generar propuestas comerciales.
        </p>
      </header>

      <ProfileForm initial={initial} />
    </div>
  )
}
