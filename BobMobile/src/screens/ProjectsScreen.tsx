import { Ionicons } from '@expo/vector-icons'
import React, { useCallback, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { ProjectEditorModal } from '../components/ProjectEditorModal'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { AppContext } from '../context/AppContext'
import { modeLabel } from '../labels'
import { colors, commonStyles } from '../theme'
import type { Catalog, ModeOption, ProjectMutationInput } from '../types'

export function ProjectsScreen({ onOpen }: { onOpen: (projectId: string) => void }) {
  const { api, connected, history, historyError, historyLoading, refreshHistory, t } = useContext(AppContext)
  const [catalog, setCatalog] = useState<Catalog>({ plugins: [], skills: [], integrations: [], mcpServers: [], dbConnections: [] })
  const [modes, setModes] = useState<ModeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [editorVisible, setEditorVisible] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (refresh = false) => {
    if (!api) return
    refresh ? setRefreshing(true) : setLoading(true)
    try {
      const [nextCatalog, nextModes] = await Promise.all([api.catalog(), api.modes()])
      setCatalog({ plugins: nextCatalog.plugins.filter(item => item.enabled), skills: nextCatalog.skills.filter(item => item.enabled), integrations: nextCatalog.integrations, mcpServers: nextCatalog.mcpServers, dbConnections: nextCatalog.dbConnections })
      setModes(nextModes)
    } catch {
      // The synchronized project list remains usable while the live Mac
      // connection is recovering. Avoid surfacing a technical promise error.
    } finally { setLoading(false); setRefreshing(false) }
  }, [api])
  useEffect(() => { void load() }, [load])
  const projects = history?.projects ?? []

  const create = async (input: ProjectMutationInput) => {
    if (!api) return
    setCreating(true)
    try {
      await api.createProject(input)
      setEditorVisible(false)
      await refreshHistory()
      Alert.alert(t('projectCreated'))
    } catch { Alert.alert(t('error'), t('projectCreateFailed')) } finally { setCreating(false) }
  }

  return <View style={commonStyles.screen}>
    <ConnectionStatusBar action={<Pressable disabled={!connected} onPress={() => setEditorVisible(true)} hitSlop={10} accessibilityLabel={t('newProject')} style={!connected && styles.disabledAction}><Ionicons name="add-circle" size={28} color={colors.accent} /></Pressable>} />
    {historyLoading && !history ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : <FlatList
      style={{ flex: 1 }}
      data={projects}
      keyExtractor={item => item.id}
      contentContainerStyle={[styles.list, projects.length === 0 && styles.emptyList]}
      refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={() => void Promise.all([load(true), refreshHistory()])} tintColor={colors.accent} />}
      renderItem={({ item }) => <Pressable style={commonStyles.card} onPress={() => onOpen(item.id)}>
        <View style={styles.cardHeader}>
          <View style={[styles.folder, { backgroundColor: item.color ?? colors.accent }]}><Ionicons name="folder-open" color={colors.white} size={21} /></View>
          <View style={styles.grow}><Text style={styles.name} numberOfLines={1}>{item.name}</Text>{item.localPath ? <Text style={styles.path} numberOfLines={1}>{item.localPath}</Text> : null}</View>
          <Ionicons name="chevron-forward" color={colors.textMuted} size={18} />
        </View>
        {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
        <View style={styles.stats}>
          <View style={styles.stat}><Ionicons name="chatbubbles-outline" size={14} color={colors.accent} /><Text style={styles.count}>{t('conversationsCount', { count: item.conversationCount ?? 0 })}</Text></View>
          {(item.activeTaskCount ?? 0) > 0 ? <View style={styles.stat}><View style={styles.activeDot} /><Text style={styles.activeCount}>{t('activeTasksCount', { count: item.activeTaskCount ?? 0 })}</Text></View> : null}
        </View>
        <View style={styles.footer}><Text style={styles.open} numberOfLines={1}>{t('openProject')}</Text><Text style={styles.footerMeta} numberOfLines={1}>{modeLabel(item.defaultMode, t)} · {item.memoryEnabled ? t('memoryOn') : t('memoryOff')}</Text></View>
      </Pressable>}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name={historyError ? 'cloud-offline-outline' : 'folder-open-outline'} size={48} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t(historyError ? 'syncRequiredTitle' : 'noProjects')}</Text><Text style={commonStyles.emptyText}>{t(historyError ? 'syncRequiredDesc' : 'noProjectsDesc')}</Text></View>}
    />}
    <ProjectEditorModal visible={editorVisible} catalog={catalog} modes={modes} busy={creating} t={t} onClose={() => setEditorVisible(false)} onSubmit={input => void create(input)} />
  </View>
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 90 }, emptyList: { flexGrow: 1 },
  disabledAction: { opacity: .4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1, minWidth: 0 },
  folder: { width: 43, height: 43, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' }, path: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  description: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }, stat: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  count: { flexShrink: 1, color: colors.textMuted, fontSize: 11 }, activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }, activeCount: { flexShrink: 1, color: colors.success, fontSize: 11, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  open: { flexShrink: 1, color: colors.accent, fontSize: 12, fontWeight: '800' }, footerMeta: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 10, textAlign: 'right' },
})
