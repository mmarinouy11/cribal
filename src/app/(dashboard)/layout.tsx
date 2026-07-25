import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Sidebar } from '@/components/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Sidebar
        companyName={session.user.companyName}
        userName={session.user.name ?? session.user.email ?? 'Usuario'}
        userEmail={session.user.email ?? ''}
        isAdmin={session.user.role === 'ADMIN'}
      />
      <main className="ml-64 min-h-screen p-8">{children}</main>
    </div>
  )
}
