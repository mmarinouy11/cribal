// Shared types for the AI-backed adjustment suggestions, used by both the
// server action that produces them and the client component that renders them.

// A validated suggestion: a 1–4 word phrase describing what is bought, its
// one-line reason, and the object texts (not RSS titles) that back it.
export interface AdjustmentSuggestion {
  phrase: string
  reason: string
  evidence: string[] // tender object texts shown as "Ej.:"
}

export interface AdjustmentSuggestions {
  add: AdjustmentSuggestion[] // checked by default
  exclude: AdjustmentSuggestion[] // unchecked by default
}

// A tender the user marked, as sent to the suggestion action.
export interface MarkedTenderInput {
  id: string
  title: string
  object: string
  relevant: boolean
}

export type SuggestResult =
  | { status: 'ok'; suggestions: AdjustmentSuggestions }
  | { status: 'empty' } // nothing survived validation
  | { status: 'error' } // the AI call failed
