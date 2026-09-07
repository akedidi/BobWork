import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import type { PromptAutocompleteItem } from '../promptAutocomplete'

export function PromptAutocompleteList({
  items,
  title,
  onSelect,
}: {
  items: PromptAutocompleteItem[]
  title: string
  onSelect: (item: PromptAutocompleteItem) => void
}) {
  if (items.length === 0) return null
  return (
    <View style={styles.popover} accessibilityRole="menu">
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="always" nestedScrollEnabled>
        {items.map(item => (
          <Pressable key={item.id} style={styles.row} onPress={() => onSelect(item)} accessibilityRole="menuitem">
            <View style={styles.icon}><Ionicons name={item.kind === 'slash' ? 'terminal-outline' : item.kind === 'db' ? 'server-outline' : item.kind === 'mcp' ? 'git-network-outline' : item.kind === 'skill' ? 'sparkles-outline' : 'extension-puzzle-outline'} size={16} color={colors.accent} /></View>
            <View style={styles.text}>
              <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  popover: { maxHeight: 238, marginBottom: 8, overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  title: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6, color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .6 },
  list: { maxHeight: 200 },
  row: { minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  icon: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.accentSoft },
  text: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 12, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
})
