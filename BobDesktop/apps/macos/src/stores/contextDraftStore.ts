import { create } from 'zustand'

// Ephemeral composer text; never persist prompts in UI preferences.
export const useContextDraftStore = create(() => ({ text: '' }))
