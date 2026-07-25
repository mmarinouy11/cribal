'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/cn'

interface SidebarProps {
  companyName: string
  userName: string
  userEmail: string
  isAdmin: boolean
}

interface NavItem {
  href: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/oportunidades', label: 'Oportunidades', icon: '🎯' },
  { href: '/ejecuciones', label: 'Ejecuciones', icon: '▶️' },
  { href: '/perfil', label: 'Perfil', icon: '🏢' },
  { href: '/configuracion', label: 'Configuración', icon: '⚙️' },
]

const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Admin', icon: '🔧' }

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Sidebar({ companyName, userName, userEmail, isAdmin }: SidebarProps) {
  const pathname = usePathname()
  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-[#0f172a] text-white">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="text-xl font-bold">🔎 Cribal</div>
        <div className="mt-1 truncate text-sm text-white/60">{companyName}</div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive(pathname, item.href)
                ? 'bg-white/10 text-white'
                : 'text-white/70 hover:bg-white/5 hover:text-white'
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-3">
          <div className="truncate text-sm font-medium">{userName}</div>
          <div className="truncate text-xs text-white/60">{userEmail}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/5"
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
