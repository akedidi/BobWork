import { Ionicons } from '@expo/vector-icons'
import React, { useContext, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { AppContext } from '../context/AppContext'
import { colors, commonStyles } from '../theme'
import type { BobTask, Project } from '../types'
import { AutomationsScreen } from './AutomationsScreen'
import { modeLabel, taskStateLabel } from '../labels'
import { formatDateTime } from '../i18n'

const activeStates = new Set(['starting', 'running', 'queued', 'awaiting_info', 'awaiting_approval', 'paused'])

export function ActivityScreen({ onOpenTask }: { onOpenTask: (task: BobTask) => void }) {
  const { api, history, historyError, historyLoading, refreshHistory, language, t } = useContext(AppContext)
  const [refreshing, setRefreshing] = useState(false)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [section, setSection] = useState<'tasks' | 'automations'>('tasks')
  const tasks = history?.tasks ?? []
  const projects = history?.projects ?? []
  const refresh = async () => {
    setRefreshing(true)
    await refreshHistory()
    setRefreshing(false)
  }

  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])

  const stop = (id: string) => Alert.alert(t('stopTask'), t('stopTaskConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('stopTask'), style: 'destructive', onPress: () => {
    if (!api) return
    setActionBusy(id)
    void api.cancelTask(id).then(refreshHistory).catch(() => Alert.alert(t('error'), t('stopFailed'))).finally(() => setActionBusy(null))
  } }])
  const retry = (id: string) => Alert.alert(t('retryTask'), t('retryTaskConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('retryTask'), onPress: () => {
    if (!api) return
    setActionBusy(id)
    void api.retryTask(id).then(refreshHistory).catch(() => Alert.alert(t('error'), t('retryFailed'))).finally(() => setActionBusy(null))
  } }])

  return (
    <View style={commonStyles.screen}>
      <ConnectionStatusBar />
      <View style={styles.segments}><Pressable style={[styles.segment, section === 'tasks' && styles.segmentActive]} onPress={() => setSection('tasks')}><Text style={[styles.segmentText, section === 'tasks' && styles.segmentTextActive]}>{t('tasksTab')}</Text></Pressable><Pressable style={[styles.segment, section === 'automations' && styles.segmentActive]} onPress={() => setSection('automations')}><Text style={[styles.segmentText, section === 'automations' && styles.segmentTextActive]}>{t('automationsTab')}</Text></Pressable></View>
      {section === 'automations' ? <AutomationsScreen /> : <>
      {historyLoading && !history ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : (
        <FlatList
          style={{ flex: 1 }}
          data={tasks}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, tasks.length === 0 && styles.emptyList]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
          renderItem={({ item }) => {
            const active = activeStates.has(item.state)
            return (
              <Pressable style={commonStyles.card} onPress={() => onOpenTask(item)}>
                <View style={styles.header}>
                  <View style={[styles.icon, active && styles.activeIcon]}><Ionicons name={active ? 'pulse' : item.state === 'completed' ? 'checkmark' : item.state === 'failed' ? 'alert' : 'ellipsis-horizontal'} size={19} color={active ? colors.accent : colors.textMuted} /></View>
                  <View style={styles.grow}>
                    <Text style={styles.objective} numberOfLines={2}>{item.objective}</Text>
                    <Text style={styles.meta} numberOfLines={1}>{item.projectId ? projectNames.get(item.projectId) ?? t('noProject') : t('noProject')} · {modeLabel(item.mode, t)}</Text>
                  </View>
                  <View style={[styles.badge, active && styles.activeBadge]}><Text style={[styles.badgeText, active && styles.activeText]} numberOfLines={2}>{taskStateLabel(item.state, t)}</Text></View>
                </View>
                {item.summary ? <Text style={styles.summary} numberOfLines={2}>{item.summary}</Text> : null}
                <View style={styles.actions}>
                  {active ? <Pressable style={[styles.action, styles.stop]} disabled={actionBusy === item.id} onPress={event => { event.stopPropagation(); stop(item.id) }}>{actionBusy === item.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Ionicons name="stop-circle-outline" size={16} color={colors.danger} />}<Text style={styles.stopText}>{t('stopTask')}</Text></Pressable> : null}
                  {['failed', 'cancelled'].includes(item.state) ? <Pressable style={styles.action} disabled={actionBusy === item.id} onPress={event => { event.stopPropagation(); retry(item.id) }}><Ionicons name="refresh-outline" size={16} color={colors.accent} /><Text style={styles.actionText}>{t('retryTask')}</Text></Pressable> : null}
                </View>
                <Text style={styles.date}>{formatDateTime(item.updatedAt, language)}</Text>
              </Pressable>
            )
          }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name={historyError ? 'cloud-offline-outline' : 'pulse-outline'} size={48} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t(historyError ? 'syncRequiredTitle' : 'noTasks')}</Text><Text style={commonStyles.emptyText}>{t(historyError ? 'syncRequiredDesc' : 'noTasksDesc')}</Text></View>}
        />
      )}
      </>}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 90 }, emptyList: { flexGrow: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 11 }, grow: { flex: 1 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }, activeIcon: { backgroundColor: colors.accentSoft },
  objective: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' }, meta: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  badge: { maxWidth: 104, minWidth: 0, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.surfaceRaised }, activeBadge: { backgroundColor: colors.accentSoft }, badgeText: { flexShrink: 1, color: colors.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' }, activeText: { color: colors.accent },
  summary: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 }, action: { minHeight: 33, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 9, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border }, actionText: { flexShrink: 1, color: colors.accent, fontSize: 10, fontWeight: '800', textAlign: 'center' }, stop: { borderColor: '#5A2634', backgroundColor: '#26131A' }, stopText: { color: colors.danger, fontSize: 10, fontWeight: '900' },
  date: { color: colors.textMuted, fontSize: 10, marginTop: 9, opacity: .75 },
  segments: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 4, padding: 4, borderRadius: 12, backgroundColor: colors.surfaceRaised }, segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, segmentActive: { backgroundColor: colors.surface }, segmentText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' }, segmentTextActive: { color: colors.accent },
})
