'use client'

import { useState, type KeyboardEvent } from 'react'

interface TagInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  inputType?: 'text' | 'email' | 'url'
}

/**
 * Controlled chip input. Pressing Enter or comma adds the current text as a
 * chip; clicking the × removes a chip. Duplicates and blanks are ignored.
 */
export function TagInput({
  values,
  onChange,
  placeholder,
  inputType = 'text',
}: TagInputProps) {
  const [draft, setDraft] = useState('')

  function addChip(raw: string) {
    const value = raw.trim().replace(/,$/, '').trim()
    if (!value) return
    if (values.includes(value)) {
      setDraft('')
      return
    }
    onChange([...values, value])
    setDraft('')
  }

  function removeChip(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addChip(draft)
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      removeChip(values.length - 1)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white p-2">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs font-medium text-[#1e3a5f]"
        >
          {value}
          <button
            type="button"
            onClick={() => removeChip(index)}
            aria-label={`Quitar ${value}`}
            className="text-[#6b7280] hover:text-[#dc2626]"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addChip(draft)}
        placeholder={placeholder}
        className="min-w-[140px] flex-1 border-none px-1 py-1 text-sm text-[#111827] outline-none"
      />
    </div>
  )
}
