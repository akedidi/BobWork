import { StyleSheet } from 'react-native'

export const colors = {
  background: '#090D18', surface: '#111827', surfaceRaised: '#172033', border: '#263248',
  text: '#F8FAFC', textMuted: '#94A3B8', accent: '#5B8CFF', accentSoft: '#1E3A66',
  success: '#34D399', danger: '#FB7185', warning: '#FBBF24', white: '#FFFFFF',
}

export const commonStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 7 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: 14, fontSize: 15 },
  primaryButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { maxWidth: '100%', flexShrink: 1, color: colors.white, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  secondaryButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { maxWidth: '100%', flexShrink: 1, color: colors.text, fontWeight: '700', textAlign: 'center' },
  empty: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
})
