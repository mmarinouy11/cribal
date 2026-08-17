'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Toast, type ToastType } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import {
  generateProposal,
  saveProposal,
  editProposalWithChat,
} from '@/lib/actions/proposals'
import type { ProposalBranding } from '@/lib/export/proposal-docx'

type Role = 'USER' | 'ASSISTANT'

interface ChatMessage {
  id: string
  role: Role
  content: string
}

interface InitialMessage {
  id: string
  role: Role
  content: string
}

interface ProposalGeneratorProps {
  opportunityId: string
  opportunity: {
    title: string
    organismo: string
  }
  branding: ProposalBranding
  savedProposal: string | null
  initialMessages: InitialMessage[]
}

const EDIT_SUGGESTIONS = [
  'Hacé la propuesta más formal',
  'Reformulá el párrafo de precio',
  'Resumí la propuesta a la mitad',
  'Reforzá la experiencia relevante',
]

export function ProposalGenerator({
  opportunityId,
  opportunity,
  branding,
  savedProposal,
  initialMessages,
}: ProposalGeneratorProps) {
  const [proposal, setProposal] = useState<string>(savedProposal ?? '')
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const hasProposal = proposal.trim().length > 0

  // Auto-resize the proposal editor to fit its content.
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`
  }, [proposal])

  // Keep the chat scrolled to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, isSending])

  async function runGeneration() {
    if (isGenerating) return
    if (hasProposal && !window.confirm('¿Regenerar? Se reemplazará la propuesta actual.')) {
      return
    }
    setIsGenerating(true)
    try {
      const result = await generateProposal(opportunityId)
      setProposal(result)
      setToast({ message: 'Propuesta generada', type: 'success' })
    } catch {
      setToast({ message: 'No se pudo generar la propuesta', type: 'error' })
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      await saveProposal(opportunityId, proposal)
      setToast({ message: 'Borrador guardado', type: 'success' })
    } catch {
      setToast({ message: 'No se pudo guardar el borrador', type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleExport() {
    if (!hasProposal) return
    try {
      const { exportProposalToDocx } = await import('@/lib/export/proposal-docx')
      await exportProposalToDocx(proposal, opportunity, branding)
    } catch {
      setToast({ message: 'No se pudo exportar a Word', type: 'error' })
    }
  }

  async function sendInstruction() {
    const text = input.trim()
    if (!text || isSending) return

    setIsSending(true)
    setInput('')
    const optimistic: ChatMessage = { id: `temp-${Date.now()}`, role: 'USER', content: text }
    setMessages((prev) => [...prev, optimistic])

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const result = await editProposalWithChat(opportunityId, proposal, text, history)
      setProposal(result.updatedProposal)
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'ASSISTANT', content: result.assistantMessage },
      ])
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setInput(text)
      setToast({ message: 'No se pudo aplicar el cambio', type: 'error' })
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendInstruction()
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
      {/* Left: proposal editor */}
      <div className="rounded-xl border border-[#e0f2fe] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#e0f2fe] px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-[#0c1e3c]">
            <i className="ti ti-file-text text-[#06b6d4]" aria-hidden />
            Propuesta
          </h2>
        </div>

        <div className="space-y-4 p-5">
          {!hasProposal && (
            <p className="text-sm text-[#6b7280]">
              Generá un borrador de propuesta con IA a partir del perfil de tu empresa y los
              detalles de esta licitación. Después podés editarlo directamente o pedirle cambios
              al asistente.
            </p>
          )}

          <textarea
            ref={editorRef}
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            placeholder="El texto de la propuesta aparecerá acá. Generalo con IA o escribilo vos."
            className="min-h-[320px] w-full resize-none rounded-lg border border-[#e0f2fe] px-4 py-3 text-sm leading-relaxed text-[#0c1e3c] outline-none focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
          />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void runGeneration()} disabled={isGenerating}>
              {isGenerating ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Generando…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <i className="ti ti-sparkles" aria-hidden />
                  {hasProposal ? 'Regenerar con IA' : 'Generar con IA'}
                </span>
              )}
            </Button>
            <Button variant="secondary" onClick={() => void handleExport()} disabled={!hasProposal}>
              <span className="inline-flex items-center gap-2">
                <i className="ti ti-download" aria-hidden />
                Descargar Word
              </span>
            </Button>
            <Button variant="secondary" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </div>

      {/* Right: proposal-editing assistant */}
      <div className="flex h-[70vh] min-h-[520px] flex-col overflow-hidden rounded-xl border border-[#e0f2fe] bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-[#e0f2fe] bg-[#f8fafc] px-4 py-3 text-sm">
          <i className="ti ti-message-chatbot text-[#06b6d4]" aria-hidden />
          <span className="font-medium text-[#0c1e3c]">Asistente de propuesta</span>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <MessageBubble role="ASSISTANT">
              <p>
                Pedime cambios sobre la propuesta y la voy actualizando. Por ejemplo:
              </p>
              <ul className="mt-2 list-disc pl-5">
                {EDIT_SUGGESTIONS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </MessageBubble>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role}>
              <span className="whitespace-pre-wrap">{m.content}</span>
            </MessageBubble>
          ))}

          {isSending && (
            <div className="flex items-center gap-2 text-sm text-[#6b7280]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
              Actualizando propuesta…
            </div>
          )}
        </div>

        {messages.length === 0 && (
          <div className="border-t border-[#e0f2fe] px-4 pt-3">
            <div className="mb-2 text-xs font-medium text-[#6b7280]">Sugerencias</div>
            <div className="flex flex-wrap gap-2">
              {EDIT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s)
                    inputRef.current?.focus()
                  }}
                  className="rounded-full border border-[#e0f2fe] bg-[#f0f9ff] px-3 py-1 text-xs text-[#0e7490] transition-colors hover:bg-[#e0f2fe]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[#e0f2fe] p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isSending}
              placeholder="Pedí un cambio a la propuesta…"
              className="max-h-28 flex-1 resize-none rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] focus:border-[#06b6d4] focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void sendInstruction()}
              disabled={isSending || input.trim().length === 0}
              className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[#0c1e3c] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>
                  Enviar
                  <span aria-hidden>→</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

function MessageBubble({ role, children }: { role: Role; children: React.ReactNode }) {
  const isUser = role === 'USER'
  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          isUser ? 'bg-[#0c1e3c] text-white' : 'bg-[#e0f2fe] text-[#0e7490]'
        )}
        aria-hidden
      >
        {isUser ? 'U' : 'A'}
      </div>
      <div className={cn('max-w-[80%]', isUser ? 'text-right' : 'text-left')}>
        <div
          className={cn(
            'inline-block rounded-2xl px-4 py-2 text-sm',
            isUser
              ? 'bg-[#0c1e3c] text-[#f0f9ff]'
              : 'border border-[#e0f2fe] bg-[#f0f9ff] text-[#0c1e3c]'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
