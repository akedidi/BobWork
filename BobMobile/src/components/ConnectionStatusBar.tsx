import React, { useContext } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { AppContext } from '../context/AppContext'
import { colors } from '../theme'

export function ConnectionStatusBar({ action }: { action?: React.ReactNode }) {
  const { connected, t } = useContext(AppContext)

  return (
    <View style={styles.bar}>
      <View style={styles.status} accessibilityRole="text" accessibilityLabel={connected ? t('connected') : t('disconnected')}>
        <View style={[styles.dot, !connected && styles.dotDisconnected]} />
        <Text style={[styles.label, !connected && styles.labelDisconnected]}>{connected ? t('connected') : t('disconnected')}</Text>
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 99, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: .55, shadowRadius: 5 },
  dotDisconnected: { backgroundColor: colors.danger, shadowColor: colors.danger },
  label: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  labelDisconnected: { color: colors.danger },
  action: { minWidth: 32, alignItems: 'flex-end' },
})
