import { Ionicons } from '@expo/vector-icons'
import React, { useMemo } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import type { TranslationKey } from '../i18n'
import {
  forbiddenTaskPermissionIds,
  getVisibleTaskPermissions,
  groupsForMode,
  permissionStatusLabel,
  type TaskPermissionId,
} from '../taskPermissions'
import {
  setAutoApprovalEnabled,
  toggleAllPermissions,
  togglePermission,
  useTaskApprovalStore,
} from '../taskPermissionStore'
import { colors } from '../theme'

const ICONS: Record<TaskPermissionId, keyof typeof Ionicons.glyphMap> = {
  read: 'eye-outline',
  edit: 'create-outline',
  execute: 'code-slash-outline',
  mcp: 'git-network-outline',
  skill: 'flash-outline',
  todo: 'checkbox-outline',
  subtask: 'git-branch-outline',
  subagent: 'people-outline',
  mode: 'swap-horizontal-outline',
}

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

export function TaskPermissionsList({
  mode,
  mcpEnabled,
  subagentsEnabled,
  t,
}: {
  mode: string
  mcpEnabled: boolean
  subagentsEnabled: boolean
  t: Translate
}) {
  const approval = useTaskApprovalStore()
  const visible = useMemo(
    () => getVisibleTaskPermissions(
      groupsForMode(mode),
      forbiddenTaskPermissionIds({ mcpEnabled, subagentsEnabled }),
    ),
    [mode, mcpEnabled, subagentsEnabled],
  )
  const visibleIds = visible.map(item => item.id)
  const hasSelection = approval.allowedPermissions.some(id => visibleIds.includes(id))
  const autoApproveActive = approval.autoApprovalEnabled && hasSelection

  const toggleAutoApprove = () => {
    if (autoApproveActive) {
      setAutoApprovalEnabled(false)
      return
    }
    if (!hasSelection && visibleIds.length > 0) {
      toggleAllPermissions(true, visibleIds)
      return
    }
    setAutoApprovalEnabled(true)
  }

  return (
    <View style={styles.wrap} accessibilityLabel={t('taskPermissions')}>
      <Text style={styles.sectionTitle}>{t('taskPermissions')}</Text>
      <Text style={styles.sectionHint}>{t('taskPermissionsDesc')}</Text>

      <View style={styles.autoRow}>
        <View style={styles.autoText}>
          <Text style={styles.autoLabel}>{t('permAutoApprove')}</Text>
          <Text style={styles.autoHint}>
            {autoApproveActive ? t('permAutoApproveOn') : t('permAutoApproveOff')}
          </Text>
        </View>
        <Switch
          value={autoApproveActive}
          onValueChange={toggleAutoApprove}
          trackColor={{ false: colors.border, true: colors.accentSoft }}
          thumbColor={autoApproveActive ? colors.accent : colors.textMuted}
          accessibilityLabel={t('permAutoApprove')}
        />
      </View>

      {visible.map(permission => {
        const checked = approval.allowedPermissions.includes(permission.id)
        const statusKey = permissionStatusLabel(checked, approval.autoApprovalEnabled)
        return (
          <Pressable
            key={permission.id}
            style={styles.row}
            onPress={() => togglePermission(permission.id, !checked)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={ICONS[permission.icon]} size={18} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t(permission.labelKey as TranslationKey)}</Text>
              <Text style={styles.rowDesc} numberOfLines={2}>
                {t(permission.descriptionKey as TranslationKey)}
              </Text>
              <Text style={[styles.rowStatus, statusKey === 'permStatusAuto' ? styles.statusAuto : styles.statusAsk]}>
                {t(statusKey)}
              </Text>
            </View>
            <Ionicons
              name={checked ? 'checkbox' : 'square-outline'}
              size={22}
              color={checked ? colors.accent : colors.textMuted}
            />
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, paddingBottom: 8 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  autoRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  autoText: { flex: 1, minWidth: 0 },
  autoLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  autoHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowDesc: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  rowStatus: { marginTop: 4, fontSize: 11, fontWeight: '800' },
  statusAuto: { color: colors.success },
  statusAsk: { color: colors.warning },
})
