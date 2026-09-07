import React from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '../theme'

type TopBarProps = {
  title: string
  subtitle?: string
  subtitleLeading?: React.ReactNode
  onBack?: () => void
  action?: React.ReactNode
}

export function TopBar({ title, subtitle, subtitleLeading, onBack, action }: TopBarProps) {
  return (
    <View style={styles.bar}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.iconButton} hitSlop={10}>
          <Ionicons name="chevron-back" size={25} color={colors.text} />
        </Pressable>
      ) : <View style={styles.logo}><Image source={require('../../assets/bob-avatar.png')} style={styles.logoImage} resizeMode="contain" /></View>}
      <View style={styles.titleGroup}><Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.82}>{title}</Text>{subtitle ? <View style={styles.subtitleRow}>{subtitleLeading}<Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text></View> : null}</View>
      <View style={styles.action}>{action}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background },
  logo: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  logoImage: { width: 34, height: 34 },
  iconButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  titleGroup: { flex: 1, minWidth: 0 }, title: { color: colors.text, fontSize: 17, fontWeight: '800' }, subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }, subtitle: { flexShrink: 1, color: colors.textMuted, fontSize: 10 },
  action: { minWidth: 32, alignItems: 'flex-end' },
})
