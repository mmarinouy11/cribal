'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

type Role = 'USER' | 'ASSISTANT'

interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: string
}

interface InitialMessage {
  id: string
  role: Role
  content: string
  createdAt: Date | string
}

interface PliegoChatProps {
  opportunityId: string
  initialMessages: InitialMessage[]
  hasPliego: boolean
  pliegoUrl: string | null
  hasArticleCodes: boolean
}

const MAX_MESSAGES = 50

const WELCOME_SUGGESTIONS = [
  '¿Cuáles son los requisitos técnicos?',
  '¿Hay experiencia mínima requerida?',
  '¿Qué documentación hay que presentar?',
  '¿Cuál es el criterio de evaluación de ofertas?',
]

// Extra chips shown when the tender has article-coded items (Paso 7).
const QUICK_SUGGESTIONS = [
  '¿Qué experiencia mínima se requiere?',
  '¿Hay garantías de mantenimiento?',
  '¿Cuál es el plazo de ejecución?',
  '¿Qué documentación hay que presentar?',
  '¿Hay criterios de evaluación de precio?',
]

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-UY', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  )
}

function fileName(url: string): string {
  const clean = url.split('?')[0]
  const segment = clean.substring(clean.lastIndexOf('/') + 1)
  return segment || 'pliego.pdf'
}

export function PliegoChat({
  opportunityId,
  initialMessages,
  hasPliego,
  pliegoUrl,
  hasArticleCodes,
}: PliegoChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => ({ ...m, createdAt: new Date(m.createdAt).toISOString() }))
  )
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const limitReached = messages.length >= MAX_MESSAGES

  // Scroll to the newest message on mount and whenever the list changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, isSending])

  // Auto-grow the textarea up to ~4 lines.
  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }

  useEffect(resizeTextarea, [input])

  const pliegoFileName = useMemo(() => (pliegoUrl ? fileName(pliegoUrl) : ''), [pliegoUrl])

  async function send() {
    const text = input.trim()
    if (!text || isSending || limitReached) return

    setError(null)
    setIsSending(true)
    setInput('')

    const optimistic: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = (await response.json()) as {
        message?: ChatMessage
        error?: string
      }

      if (!response.ok || !data.message) {
        // The server saved nothing on failure — drop the optimistic message.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setInput(text)
        setError(data.error ?? 'No se pudo enviar el mensaje.')
        return
      }

      setMessages((prev) => [...prev, data.message as ChatMessage])
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setInput(text)
      setError('No se pudo enviar el mensaje. Revisá tu conexión.')
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-[70vh] min-h-[520px] flex-col overflow-hidden rounded-xl border border-[#e0f2fe] bg-white shadow-sm">
      {/* Pliego banner */}
      <div className="flex items-center gap-2 border-b border-[#e0f2fe] bg-[#f8fafc] px-4 py-3 text-sm">
        {hasPliego && pliegoUrl ? (
          <>
            <i className="ti ti-file-text text-[#06b6d4]" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[#0c1e3c]">
              Pliego disponible: <span className="font-medium">{pliegoFileName}</span>
            </span>
            <a
              href={pliegoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-medium text-[#0e7490] hover:underline"
            >
              Ver pliego →
            </a>
          </>
        ) : (
          <>
            <i className="ti ti-alert-triangle text-[#d97706]" aria-hidden />
            <span className="text-[#6b7280]">
              Esta licitación no tiene pliego adjunto. Puedo responder con los datos del llamado.
            </span>
          </>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <MessageBubble role="ASSISTANT">
            <p>
              Hola. Tengo acceso a los datos de esta licitación y al pliego cuando está disponible.
              Podés preguntarme:
            </p>
            <ul className="mt-2 list-disc pl-5">
              {WELCOME_SUGGESTIONS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </MessageBubble>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} time={formatTime(m.createdAt)}>
            <span className="whitespace-pre-wrap">{m.content}</span>
          </MessageBubble>
        ))}

        {isSending && (
          <div className="flex items-center gap-2 text-sm text-[#6b7280]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
            Consultando…
          </div>
        )}
      </div>

      {/* Suggestion chips */}
      {hasArticleCodes && !limitReached && (
        <div className="border-t border-[#e0f2fe] px-4 pt-3">
          <div className="mb-2 text-xs font-medium text-[#6b7280]">Sugerencias rápidas</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setInput(s)
                  textareaRef.current?.focus()
                }}
                className="rounded-full border border-[#e0f2fe] bg-[#f0f9ff] px-3 py-1 text-xs text-[#0e7490] transition-colors hover:bg-[#e0f2fe]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[#e0f2fe] p-3">
        {error && <div className="mb-2 text-xs text-[#dc2626]">{error}</div>}
        {limitReached ? (
          <div className="py-2 text-center text-sm text-[#6b7280]">
            Se alcanzó el límite de mensajes para esta consulta.
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isSending}
              placeholder="Escribí tu pregunta sobre el pliego…"
              className="max-h-28 flex-1 resize-none rounded-lg border border-[#e0f2fe] px-3 py-2 text-sm text-[#0c1e3c] focus:border-[#06b6d4] focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void send()}
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
        )}
      </div>
    </div>
  )
}

function MessageBubble({
  role,
  time,
  children,
}: {
  role: Role
  time?: string
  children: React.ReactNode
}) {
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
        {time && <div className="mt-1 px-1 text-[11px] text-[#94a3b8]">{time}</div>}
      </div>
    </div>
  )
}
