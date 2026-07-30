'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { LogoMark } from '@/components/ui/logo'
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
  icon: string // Tabler icon class suffix
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: 'ti-layout-dashboard' },
  { href: '/oportunidades', label: 'Oportunidades', icon: 'ti-target' },
  { href: '/ejecuciones', label: 'Ejecuciones', icon: 'ti-player-play' },
  { href: '/perfil', label: 'Perfil', icon: 'ti-building' },
  { href: '/configuracion', label: 'Configuración', icon: 'ti-settings' },
]

const ADMIN_NAV_ITEM: NavItem = { href: '/admin', label: 'Admin', icon: 'ti-shield' }

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Sidebar({ companyName, userName, userEmail, isAdmin }: SidebarProps) {
  const pathname = usePathname()
  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-60 flex-col border-r border-[#1e3a5f] bg-[#0c1e3c]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-1 pt-5">
        <LogoMark size={28} />
        <span
          className="text-lg font-semibold text-[#f0f9ff]"
          style={{ letterSpacing: '-0.5px' }}
        >
          cribal
        </span>
      </div>
      <div className="truncate px-4 pb-3 text-[11px] text-[#4b8fa8]">{companyName}</div>

      <div className="border-t border-[#1e3a5f]" />

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors',
                active
                  ? 'border-l-[3px] border-[#06b6d4] bg-[#162d52] pl-[9px] text-[#06b6d4]'
                  : 'text-[#64748b] hover:bg-[#162d52] hover:text-[#cbd5e1]'
              )}
            >
              <i className={cn('ti', item.icon, 'text-base')} aria-hidden />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User section */}
      <div className="flex items-center gap-3 bg-[#08152a] px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#162d52] text-xs font-semibold text-[#06b6d4]">
          {initials(userName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-[#e2e8f0]">{userName}</div>
          <div className="truncate text-[11px] text-[#64748b]">{userEmail}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-[11px] text-[#64748b] transition-colors hover:text-[#06b6d4]"
        >
          Salir
        </button>
      </div>
    </aside>
  )
}
