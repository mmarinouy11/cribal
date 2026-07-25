'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RegistrationStatus, UserRole } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import {
  setCompanyRegistrationStatus,
  setUserRole,
  resetUserPassword,
  triggerCompanyPipeline,
  triggerAllPipelines,
} from '@/lib/actions/admin'

type ToastState = { message: string; type: ToastType } | null

function useToast(): [ToastState, (t: ToastState) => void, () => void] {
  const [toast, setToast] = useState<ToastState>(null)
  return [toast, setToast, () => setToast(null)]
}

export function CompanyStatusToggle({
  companyId,
  status,
}: {
  companyId: string
  status: RegistrationStatus
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast, clearToast] = useToast()

  const suspended = status === 'SUSPENDED'
  const nextStatus: RegistrationStatus = suspended ? 'ACTIVE' : 'SUSPENDED'

  function handleToggle() {
    startTransition(async () => {
      try {
        await setCompanyRegistrationStatus(companyId, nextStatus)
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo cambiar el estado', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button
        variant={suspended ? 'primary' : 'danger'}
        size="sm"
        onClick={handleToggle}
        disabled={isPending}
      >
        {suspended ? 'Activar' : 'Suspender'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  )
}

export function CompanyRunButton({ companyId }: { companyId: string }) {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast, clearToast] = useToast()

  function handleRun() {
    startTransition(async () => {
      try {
        await triggerCompanyPipeline(companyId)
        setToast({ message: 'Pipeline iniciado', type: 'success' })
      } catch {
        setToast({ message: 'No se pudo iniciar el pipeline', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleRun} disabled={isPending}>
        {isPending ? 'Iniciando…' : 'Correr pipeline'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  )
}

export function UserRoleToggle({ userId, role }: { userId: string; role: UserRole }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [toast, setToast, clearToast] = useToast()

  const nextRole: UserRole = role === 'ADMIN' ? 'USER' : 'ADMIN'

  function handleToggle() {
    startTransition(async () => {
      try {
        await setUserRole(userId, nextRole)
        router.refresh()
      } catch {
        setToast({ message: 'No se pudo cambiar el rol', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleToggle} disabled={isPending}>
        {role === 'ADMIN' ? 'Hacer USER' : 'Hacer ADMIN'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  )
}

export function UserResetPasswordButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast, clearToast] = useToast()

  function handleReset() {
    if (!window.confirm('¿Resetear la contraseña de este usuario? Se le enviará una temporal por email.')) {
      return
    }
    startTransition(async () => {
      try {
        await resetUserPassword(userId)
        setToast({ message: 'Contraseña reseteada y email enviado', type: 'success' })
      } catch {
        setToast({ message: 'No se pudo resetear la contraseña', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleReset} disabled={isPending}>
        {isPending ? 'Reseteando…' : 'Resetear contraseña'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  )
}

export function RunAllButton() {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast, clearToast] = useToast()

  function handleRunAll() {
    startTransition(async () => {
      try {
        await triggerAllPipelines()
        setToast({ message: 'Pipeline iniciado para todas las empresas', type: 'success' })
      } catch {
        setToast({ message: 'No se pudo iniciar el pipeline', type: 'error' })
      }
    })
  }

  return (
    <>
      <Button onClick={handleRunAll} disabled={isPending}>
        {isPending ? 'Iniciando…' : 'Correr pipeline para todas las empresas'}
      </Button>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </>
  )
}
