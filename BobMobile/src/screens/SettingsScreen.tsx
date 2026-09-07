import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { AppContext } from '../context/AppContext'
import type { Language } from '../i18n'
import { formatDateTime, formatNumber } from '../i18n'
import { modeLabel, permissionPolicyLabel } from '../labels'
import { colors, commonStyles } from '../theme'
import type { Conversation, ConversationItem } from '../types'

export function SettingsScreen({ onOpenExtensions }: { onOpenExtensions: () => void }) {
  const { api, bootstrap, usage, connected, connection, disconnect, history, historyError, historyLoading, liveConnected, language, refreshBootstrap, refreshUsage, refreshHistory, setLanguage, t } = useContext(AppContext)
  const [archivedItems, setArchivedItems] = useState<ConversationItem[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)
  const [archivedError, setArchivedError] = useState(false)
  const [archiveAction, setArchiveAction] = useState<string | null>(null)
  const [locationBusy, setLocationBusy] = useState(false)
  const languages: Array<{ id: Language; label: string }> = [{ id: 'fr', label: t('french') }, { id: 'en', label: t('english') }, { id: 'es', label: t('spanish') }]
  const confirmDisconnect = () => Alert.alert(t('disconnect'), t('disconnectConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('confirm'), style: 'destructive', onPress: () => void disconnect() }])
  const permissionPolicy = permissionPolicyLabel(bootstrap?.settings.permissionPolicy, t)
  const total = usage?.totalAmount ?? (usage?.usedAmount != null && usage.remainingAmount != null ? usage.usedAmount + usage.remainingAmount : null)
  const percent = usage?.usedAmount != null && total != null && total > 0 ? Math.min(100, Math.max(0, usage.usedAmount / total * 100)) : null
  const amount = (value: number | null | undefined) => value == null ? '—' : formatNumber(value, language)
  const loadArchived = useCallback(async () => {
    if (!api || !connected) { setArchivedItems([]); return }
    setArchivedLoading(true)
    setArchivedError(false)
    try { setArchivedItems(await api.conversations(undefined, true)) }
    catch { setArchivedError(true) }
    finally { setArchivedLoading(false) }
  }, [api, connected])
  useEffect(() => { void loadArchived() }, [loadArchived, history?.syncedAt])
  const archivedGroups = useMemo(() => {
    const names = new Map((history?.projects ?? []).map(project => [project.id, project.name]))
    const groups = new Map<string, { name: string; items: ConversationItem[] }>()
    for (const item of archivedItems) {
      const projectId = item.conversation.projectId ?? '__none__'
      const group = groups.get(projectId) ?? { name: item.conversation.projectId ? names.get(item.conversation.projectId) ?? t('noProject') : t('noProject'), items: [] }
      group.items.push(item)
      groups.set(projectId, group)
    }
    return [...groups.entries()]
      .map(([id, group]) => ({ id, ...group, items: group.items.sort((left, right) => left.conversation.title.localeCompare(right.conversation.title, language)) }))
      .sort((left, right) => left.id === '__none__' ? 1 : right.id === '__none__' ? -1 : left.name.localeCompare(right.name, language))
  }, [archivedItems, history?.projects, language, t])
  const disableArchive = async (conversation: Conversation) => {
    if (!api || archiveAction) return
    setArchiveAction(`disable:${conversation.id}`)
    try {
      await api.updateConversation(conversation.id, { archived: false })
      await Promise.all([loadArchived(), refreshHistory()])
    } catch { Alert.alert(t('error'), t('conversationUpdateFailed')) }
    finally { setArchiveAction(null) }
  }
  const deleteArchived = (conversation: Conversation) => Alert.alert(t('deleteConversation'), t('deleteConversationConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: () => {
      if (!api || archiveAction) return
      setArchiveAction(`delete:${conversation.id}`)
      void api.deleteConversation(conversation.id)
        .then(() => Promise.all([loadArchived(), refreshHistory()]))
        .catch(() => Alert.alert(t('error'), t('conversationDeleteFailed')))
        .finally(() => setArchiveAction(null))
    } },
  ])
  const updateLocation = async () => {
    if (!api || locationBusy) return
    setLocationBusy(true)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== 'granted') {
        Alert.alert(t('currentLocation'), t('locationPermissionDenied'))
        return
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      await api.updateCurrentLocation(position.coords.latitude, position.coords.longitude)
      await refreshBootstrap()
    } catch {
      Alert.alert(t('error'), t('locationUpdateFailed'))
    } finally { setLocationBusy(false) }
  }
  const setLocationEnabled = async (enabled: boolean) => {
    if (enabled) return updateLocation()
    if (!api || locationBusy) return
    setLocationBusy(true)
    try {
      await api.clearCurrentLocation()
      await refreshBootstrap()
    } catch { Alert.alert(t('error'), t('locationUpdateFailed')) }
    finally { setLocationBusy(false) }
  }
  return (
    <View style={commonStyles.screen}>
      <ConnectionStatusBar />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>{t('remoteConnection')}</Text>
        <View style={commonStyles.card}>
          <View style={styles.status}><View style={[styles.dot, !connected && styles.dotError]} /><Text style={[styles.connected, !connected && styles.unavailable]}>{connected ? t('connected') : t('disconnected')}</Text></View>
          <Text style={styles.label}>{t('server')}</Text><Text style={styles.server} numberOfLines={2}>{connection?.serverUrl}</Text>
          <View style={styles.security}><Ionicons name={liveConnected ? 'radio-outline' : 'cloud-offline-outline'} size={18} color={liveConnected ? colors.success : colors.warning} /><Text style={styles.securityText}>{liveConnected ? t('liveConnected') : t('liveDisconnected')}</Text></View>
          <View style={styles.security}><Ionicons name="shield-checkmark-outline" size={18} color={colors.success} /><Text style={styles.securityText}>{t('secureStorage')}</Text></View>
        </View>
        <Text style={styles.section}>{t('syncStatus')}</Text>
        <Pressable style={commonStyles.card} onPress={() => void refreshHistory()}>
          <View style={styles.status}><View style={[styles.dot, historyError && styles.dotError]} /><Text style={[styles.connected, historyError && styles.unavailable]}>{historyError ? t('syncUnavailable') : t('connected')}</Text><Ionicons name={historyLoading ? 'sync' : 'refresh'} size={18} color={colors.textMuted} /></View>
          <View style={styles.syncCounts}><SyncCount icon="chatbubbles-outline" value={history?.conversations.length ?? 0} label={t('conversations')} /><SyncCount icon="folder-open-outline" value={history?.projects.length ?? 0} label={t('projects')} /><SyncCount icon="pulse-outline" value={history?.tasks.length ?? 0} label={t('activity')} /></View>
          {history?.syncedAt ? <Text style={styles.help}>{t('lastSync', { date: formatDateTime(history.syncedAt, language) })}</Text> : null}
        </Pressable>
        <Text style={styles.section}>{t('bobcoins')}</Text>
        <Pressable style={commonStyles.card} onPress={() => void refreshUsage()}>
          <View style={styles.status}><View style={[styles.dot, !usage?.available && styles.dotError]} /><Text style={[styles.connected, !usage?.available && styles.unavailable]}>{usage?.available && usage.usedAmount != null && total != null ? t('bobcoinsUsed', { used: amount(usage.usedAmount), total: amount(total) }) : t('bobcoinsUnavailable')}</Text><Ionicons name="refresh" size={18} color={colors.textMuted} /></View>
          {percent != null ? <View style={styles.usageTrack}><View style={[styles.usageFill, { width: `${percent}%` }]} /></View> : null}
          {usage?.remainingAmount != null ? <Text style={styles.usageRemaining}>{t('bobcoinsRemaining', { remaining: amount(usage.remainingAmount) })}</Text> : null}
          {usage?.capturedAt ? <Text style={styles.help}>{t('bobcoinsUpdated', { date: formatDateTime(usage.capturedAt, language) })}</Text> : null}
        </Pressable>
        <Text style={styles.section}>{t('bobStatus')}</Text>
        <Pressable style={commonStyles.card} onPress={() => void refreshBootstrap()}>
          <View style={styles.status}><View style={[styles.dot, !bootstrap?.bobAvailable && styles.dotError]} /><Text style={[styles.connected, !bootstrap?.bobAvailable && styles.unavailable]}>{bootstrap?.bobAvailable ? t('bobAvailable') : t('bobUnavailable')}</Text><Ionicons name="refresh" size={18} color={colors.textMuted} /></View>
          <Text style={styles.label}>{t('defaultMode')}</Text><Text style={styles.server}>{bootstrap ? modeLabel(bootstrap.settings.defaultMode, t) : '—'}</Text>
          <Text style={[styles.label, styles.settingGap]}>{t('permissionPolicy')}</Text><Text style={styles.server}>{permissionPolicy}</Text>
          <View style={styles.security}><Ionicons name={bootstrap?.settings.sandboxMode ? 'lock-closed-outline' : 'folder-open-outline'} size={18} color={colors.accent} /><Text style={styles.securityText}>{bootstrap?.settings.sandboxMode ? t('sandboxOn') : t('sandboxOff')}</Text></View>
          <Text style={styles.help}>{t('followsBobWork')}</Text>
        </Pressable>
        <Text style={styles.section}>{t('extensions')}</Text>
        <Pressable style={[commonStyles.card, styles.navigationCard]} onPress={onOpenExtensions}>
          <View style={styles.navigationIcon}><Ionicons name="extension-puzzle-outline" size={22} color={colors.accent} /></View>
          <View style={styles.navigationText}><Text style={styles.navigationTitle}>{t('manageExtensions')}</Text><Text style={styles.navigationDescription}>{t('extensionsDescription')}</Text></View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.section}>{t('currentLocation')}</Text>
        <View style={commonStyles.card}>
          <View style={styles.locationRow}>
            <View style={styles.locationText}><Text style={styles.navigationTitle}>{bootstrap?.settings.locationEnabled ? t('locationEnabled') : t('locationDisabled')}</Text><Text style={styles.navigationDescription}>{t('currentLocationDesc')}</Text></View>
            {locationBusy ? <ActivityIndicator color={colors.accent} /> : <Switch value={Boolean(bootstrap?.settings.locationEnabled)} onValueChange={value => void setLocationEnabled(value)} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={bootstrap?.settings.locationEnabled ? colors.accent : colors.textMuted} />}
          </View>
          {bootstrap?.settings.locationEnabled ? <Pressable style={styles.locationRefresh} disabled={locationBusy} onPress={() => void updateLocation()}><Ionicons name="locate-outline" size={17} color={colors.accent} /><Text style={styles.disableArchiveText}>{t('locationRefresh')}</Text></Pressable> : null}
          <Text style={styles.help}>{t('locationPrivacy')}</Text>
        </View>
        <Text style={styles.section}>{t('language')}</Text>
        <View style={commonStyles.card}>{languages.map((item, index) => <Pressable key={item.id} style={[styles.language, index > 0 && styles.divider]} onPress={() => void setLanguage(item.id)}><Text style={styles.languageText}>{item.label}</Text>{language === item.id && <Ionicons name="checkmark-circle" size={22} color={colors.accent} />}</Pressable>)}</View>
        <Pressable style={styles.disconnect} onPress={confirmDisconnect}><Ionicons name="log-out-outline" size={20} color={colors.danger} /><Text style={styles.disconnectText}>{t('disconnect')}</Text></Pressable>
        <Text style={[styles.section, styles.archivedSection]}>{t('archivedChats')}</Text>
        <Text style={styles.archivedHelp}>{t('archivedChatsDescription')}</Text>
        {archivedLoading ? <View style={styles.archivedLoading}><ActivityIndicator color={colors.accent} /></View> : archivedError ? <Pressable style={commonStyles.card} onPress={() => void loadArchived()}><Text style={styles.archivedEmpty}>{t('archivedChatsLoadFailed')}</Text><Text style={styles.retry}>{t('retry')}</Text></Pressable> : archivedGroups.length === 0 ? <View style={commonStyles.card}><Text style={styles.archivedEmpty}>{t('noArchivedChats')}</Text></View> : archivedGroups.map(group => <View key={group.id} style={styles.projectGroup}>
          <View style={styles.projectHeading}><Ionicons name={group.id === '__none__' ? 'folder-open-outline' : 'folder-outline'} size={16} color={colors.accent} /><Text style={styles.projectName}>{group.name}</Text></View>
          <View style={commonStyles.card}>{group.items.map((item, index) => {
            const disabling = archiveAction === `disable:${item.conversation.id}`
            const deleting = archiveAction === `delete:${item.conversation.id}`
            return <View key={item.conversation.id} style={[styles.archivedRow, index > 0 && styles.divider]}>
              <Text style={styles.archivedTitle} numberOfLines={2}>{item.conversation.title}</Text>
              <View style={styles.archivedActions}>
                <Pressable disabled={Boolean(archiveAction)} style={[styles.archiveButton, styles.disableArchiveButton, archiveAction && styles.actionDisabled]} onPress={() => void disableArchive(item.conversation)} accessibilityLabel={`${t('disable')} ${item.conversation.title}`}>{disabling ? <ActivityIndicator size="small" color={colors.accent} /> : <><Ionicons name="archive-outline" size={15} color={colors.accent} /><Text style={styles.disableArchiveText}>{t('disable')}</Text></>}</Pressable>
                <Pressable disabled={Boolean(archiveAction)} style={[styles.archiveButton, styles.deleteArchiveButton, archiveAction && styles.actionDisabled]} onPress={() => deleteArchived(item.conversation)} accessibilityLabel={`${t('delete')} ${item.conversation.title}`}>{deleting ? <ActivityIndicator size="small" color={colors.danger} /> : <><Ionicons name="trash-outline" size={15} color={colors.danger} /><Text style={styles.deleteArchiveText}>{t('delete')}</Text></>}</Pressable>
              </View>
            </View>
          })}</View>
        </View>)}
      </ScrollView>
    </View>
  )
}

function SyncCount({ icon, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; value: number; label: string }) {
  return <View style={styles.syncCount}><Ionicons name={icon} size={18} color={colors.accent} /><Text style={styles.syncValue}>{value}</Text><Text style={styles.syncLabel} numberOfLines={1}>{label}</Text></View>
}

const styles = StyleSheet.create({
  content: { padding: 18 }, section: { color: colors.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: .8, marginTop: 8, marginBottom: 9 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 18 }, dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: colors.accent }, dotError: { backgroundColor: colors.danger }, connected: { flex: 1, color: colors.accent, fontWeight: '800', fontSize: 13 }, unavailable: { color: colors.danger },
  label: { color: colors.textMuted, fontSize: 11, marginBottom: 5 }, server: { color: colors.text, fontSize: 14, fontWeight: '700' }, security: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'center' }, securityText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  settingGap: { marginTop: 14 }, help: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 14 }, language: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, divider: { borderTopWidth: 1, borderTopColor: colors.border }, languageText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  syncCounts: { flexDirection: 'row', gap: 8 }, syncCount: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: colors.surfaceRaised }, syncValue: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 5 }, syncLabel: { color: colors.textMuted, fontSize: 9, marginTop: 2, paddingHorizontal: 3 },
  usageTrack: { height: 8, overflow: 'hidden', borderRadius: 99, backgroundColor: colors.surfaceRaised }, usageFill: { height: 8, borderRadius: 99, backgroundColor: colors.accent }, usageRemaining: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 9 },
  disconnect: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 13, borderWidth: 1, borderColor: '#5A2634', marginTop: 26 }, disconnectText: { color: colors.danger, fontWeight: '800' },
  navigationCard: { flexDirection: 'row', alignItems: 'center', gap: 12 }, navigationIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, navigationText: { flex: 1, minWidth: 0 }, navigationTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, navigationDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, locationText: { flex: 1, minWidth: 0 }, locationRefresh: { minHeight: 38, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: colors.surfaceRaised },
  archivedSection: { marginTop: 28 }, archivedHelp: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: -3, marginBottom: 10 }, archivedLoading: { minHeight: 84, alignItems: 'center', justifyContent: 'center' }, archivedEmpty: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' }, retry: { color: colors.accent, fontSize: 12, fontWeight: '800', textAlign: 'center', marginTop: 8 }, projectGroup: { marginBottom: 14 }, projectHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4, marginBottom: 7 }, projectName: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' }, archivedRow: { paddingVertical: 12 }, archivedTitle: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 }, archivedActions: { flexDirection: 'row', gap: 8, marginTop: 10 }, archiveButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1 }, disableArchiveButton: { borderColor: colors.border, backgroundColor: colors.surfaceRaised }, deleteArchiveButton: { borderColor: '#5A2634' }, disableArchiveText: { color: colors.accent, fontSize: 11, fontWeight: '800' }, deleteArchiveText: { color: colors.danger, fontSize: 11, fontWeight: '800' }, actionDisabled: { opacity: .5 },
})
