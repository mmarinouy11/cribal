import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { ProfileForm, type ProfileFormValues } from '@/components/config/profile-form'

export default async function ProfilePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const profile = await prisma.companyProfile.findUnique({
    where: { companyId: session.user.companyId },
  })

  const initial: ProfileFormValues = {
    longDescription: profile?.longDescription ?? '',
    founded: profile?.founded ?? '',
    teamSize: profile?.teamSize ?? '',
    caseStudies: profile?.caseStudies ?? '',
    certifications: profile?.certifications ?? '',
    differentiators: profile?.differentiators ?? '',
    proposalTemplate: profile?.proposalTemplate ?? '',
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[#0c1e3c]">Perfil de la empresa</h1>
        <p className="text-sm text-[#6b7280]">
          Información usada por la IA para generar propuestas comerciales.
        </p>
      </header>

      <ProfileForm initial={initial} />
    </div>
  )
}
