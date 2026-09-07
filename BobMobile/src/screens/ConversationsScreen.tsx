import { Ionicons } from '@expo/vector-icons'
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppModal } from '../components/AppModal'
import { GrowingPromptInput } from '../components/GrowingPromptInput'
import { NoProjectIcon } from '../components/NoProjectIcon'
import { PromptAutocompleteList } from '../components/PromptAutocompleteList'
import { SelectedPluginChips } from '../components/SelectedPluginChips'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { AppContext } from '../context/AppContext'
import { isConnectionFailure } from '../api'
import { modeLabel } from '../labels'
import { addPluginReference, removePluginReference } from '../pluginReferences'
import { applyPromptAutocomplete, buildPromptAutocompleteItems, detectPromptAutocomplete, type PromptAutocompleteItem } from '../promptAutocomplete'
import { colors, commonStyles } from '../theme'
import type { BobSlashCommand, Catalog, Conversation, ConversationItem, ModeOption, Project, PromptAttachment } from '../types'
import { formatDate } from '../i18n'

const HISTORY_PAGE_SIZE = 8
type Filter = 'recent' | 'active' | 'completed' | 'scheduled' | 'archived'

export function ConversationsScreen({ projectFilter, onClearFilter, onOpen }: { projectFilter?: string; onClearFilter: () => void; onOpen: (conversation: Conversation) => void }) {
  const insets = useSafeAreaInsets()
  const { api, bootstrap, connected, disconnect, history, historyLoading, historyError, unreadConversationIds, markConversationRead, refreshHistory, language, t } = useContext(AppContext)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ConversationItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [filter, setFilter] = useState<Filter>('recent')
  const [archivedItems, setArchivedItems] = useState<ConversationItem[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [createModal, setCreateModal] = useState(false)
  const [actionConversation, setActionConversation] = useState<Conversation | null>(null)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projectFilter ?? '')
  const [actionTitle, setActionTitle] = useState('')
  const [actionProjectId, setActionProjectId] = useState('')
  const [creating, setCreating] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)
  const userScrolled = useRef(false)
  const projects = history?.projects ?? []
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])

  useEffect(() => { setProjectId(projectFilter ?? '') }, [projectFilter])
  useEffect(() => {
    const value = search.trim()
    if (!api || !value || filter === 'archived') { setSearchResults(null); setSearching(false); return }
    setSearching(true)
    const timer = setTimeout(() => { void api.searchConversations(value, projectFilter).then(setSearchResults).catch(() => setSearchResults([])).finally(() => setSearching(false)) }, 280)
    return () => clearTimeout(timer)
  }, [api, filter, projectFilter, search])

  const loadArchived = async () => {
    if (!api) return
    setArchiveLoading(true)
    try { setArchivedItems(await api.conversations(projectFilter, true)) }
    catch { setArchivedItems([]) }
    finally { setArchiveLoading(false) }
  }
  useEffect(() => { if (filter === 'archived') void loadArchived() }, [api, filter, projectFilter])

  const items = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const source = filter === 'archived' ? archivedItems : searchResults ?? history?.conversations ?? []
    return source.filter(item => {
      if (projectFilter && item.conversation.projectId !== projectFilter) return false
      if (filter === 'active' && !['starting', 'running', 'queued', 'awaiting_info', 'awaiting_approval', 'paused'].includes(item.taskState ?? '')) return false
      if (filter === 'completed' && !['completed', 'failed', 'cancelled'].includes(item.taskState ?? '')) return false
      if (filter === 'scheduled' && !item.scheduled) return false
      if (filter === 'archived' && query) {
        const projectName = item.conversation.projectId ? projectNames.get(item.conversation.projectId) : ''
        if (!`${item.conversation.title} ${item.conversation.summary ?? ''} ${projectName ?? ''}`.toLocaleLowerCase().includes(query)) return false
      }
      return true
    }).sort((left, right) => new Date(right.conversation.date).getTime() - new Date(left.conversation.date).getTime())
  }, [archivedItems, filter, history?.conversations, projectFilter, projectNames, search, searchResults])
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount])
  const hasMore = visibleCount < items.length

  useEffect(() => { setVisibleCount(HISTORY_PAGE_SIZE); userScrolled.current = false }, [filter, projectFilter, search])
  const refresh = async () => { setRefreshing(true); await refreshHistory(); if (filter === 'archived') await loadArchived(); setVisibleCount(HISTORY_PAGE_SIZE); userScrolled.current = false; setRefreshing(false) }
  const loadMore = () => {
    if (!hasMore || loadingMore || !userScrolled.current) return
    setLoadingMore(true); userScrolled.current = false
    setTimeout(() => { setVisibleCount(current => Math.min(current + HISTORY_PAGE_SIZE, items.length)); setLoadingMore(false) }, 160)
  }
  const open = (conversation: Conversation) => { markConversationRead(conversation.id); onOpen(conversation) }
  const createConversation = async () => {
    if (!api) return
    setCreating(true)
    try {
      const projectMode = projects.find(project => project.id === projectId)?.defaultMode
      const conversation = await api.createConversation({ title: title.trim() || t('conversationTitlePlaceholder'), projectId: projectId || undefined, mode: projectMode || bootstrap?.settings.defaultMode || 'agent' })
      setCreateModal(false); setTitle(''); await refreshHistory(); open(conversation)
    } catch { Alert.alert(t('error'), t('conversationCreateFailed')) } finally { setCreating(false) }
  }
  const showActions = (conversation: Conversation) => { setActionConversation(conversation); setActionTitle(conversation.title); setActionProjectId(conversation.projectId ?? '') }
  const updateConversation = async (input: { title?: string; projectId?: string; pinned?: boolean; archived?: boolean }) => {
    if (!api || !actionConversation) return
    setActionBusy(true)
    try { await api.updateConversation(actionConversation.id, input); setActionConversation(null); await refreshHistory(); if (filter === 'archived') await loadArchived() }
    catch { Alert.alert(t('error'), t('conversationUpdateFailed')) } finally { setActionBusy(false) }
  }
  const removeConversation = () => {
    if (!api || !actionConversation) return
    Alert.alert(t('deleteConversation'), t('deleteConversationConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('delete'), style: 'destructive', onPress: () => {
      setActionBusy(true)
      void api.deleteConversation(actionConversation.id).then(async () => { setActionConversation(null); await refreshHistory(); if (filter === 'archived') await loadArchived() }).catch(() => Alert.alert(t('error'), t('conversationDeleteFailed'))).finally(() => setActionBusy(false))
    } }])
  }
  const filters: Filter[] = ['recent', 'active', 'completed', 'scheduled', 'archived']

  return <KeyboardAvoidingView style={commonStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : 0}>
    <ConnectionStatusBar action={<Pressable disabled={!connected} style={!connected && styles.disabledAction} onPress={() => setCreateModal(true)} hitSlop={10} accessibilityLabel={t('newConversation')}><Ionicons name="add-circle" size={28} color={colors.accent} /></Pressable>} />
    {projectFilter && <Pressable style={styles.projectFilter} onPress={onClearFilter}><Text style={styles.filterText}>{projectNames.get(projectFilter) ?? t('allProjects')}</Text><Ionicons name="close" color={colors.textMuted} /></Pressable>}
    <View style={styles.searchRow}><View style={styles.searchBox}><Ionicons name="search" size={17} color={colors.textMuted} /><TextInput value={search} onChangeText={setSearch} style={styles.searchInput} placeholder={t('searchConversations')} placeholderTextColor={colors.textMuted} />{searching && <ActivityIndicator size="small" color={colors.accent} />}</View></View>
    <ScrollView horizontal style={styles.filterScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(value => <Pressable key={value} style={[styles.filterChip, filter === value && styles.filterChipSelected]} onPress={() => setFilter(value)}><Text style={[styles.filterChipText, filter === value && styles.filterChipTextSelected]}>{t(value)}</Text></Pressable>)}</ScrollView>
    {historyError && <View style={styles.syncWarning}><Ionicons name="cloud-offline-outline" color={colors.warning} size={16} /><Pressable style={styles.syncRetry} onPress={() => void refreshHistory()}><Text style={styles.syncWarningText}>{t('syncUnavailable')}</Text></Pressable><Pressable style={styles.reconnectButton} onPress={() => void disconnect()}><Text style={styles.reconnectText}>{t('updateConnection')}</Text></Pressable></View>}
    {(historyLoading && !history) || archiveLoading ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : <FlatList
      style={{ flex: 1 }}
      data={visibleItems} keyExtractor={item => item.conversation.id} contentContainerStyle={[styles.list, visibleItems.length === 0 && styles.emptyList]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
      onScrollBeginDrag={() => { userScrolled.current = true }} onEndReached={loadMore} onEndReachedThreshold={.25}
      renderItem={({ item }) => {
        const running = ['starting', 'running', 'queued', 'awaiting_info', 'awaiting_approval', 'paused'].includes(item.taskState ?? '')
        const unread = unreadConversationIds.includes(item.conversation.id)
        return <Pressable style={commonStyles.card} onPress={() => open(item.conversation)} onLongPress={() => showActions(item.conversation)}>
          <View style={styles.row}>
            <View style={styles.chatIcon}><Image source={require('../../assets/bob-avatar.png')} style={styles.chatIconImage} resizeMode="contain" />{unread && <View style={styles.unreadDot} />}</View>
            <View style={styles.grow}><View style={styles.titleRow}>{item.conversation.pinned && <Ionicons name="pin" size={12} color={colors.accent} />}<Text style={styles.itemTitle} numberOfLines={1}>{item.conversation.title}</Text></View><View style={styles.metaRow}>{!item.conversation.projectId ? <NoProjectIcon size={14} /> : null}<Text style={styles.meta} numberOfLines={1}>{item.conversation.projectId ? projectNames.get(item.conversation.projectId) ?? t('noProject') : t('noProject')} · {formatDate(item.conversation.date, language)}</Text></View></View>
            {running && <View style={styles.running}><View style={styles.dot} /><Text style={styles.runningText} numberOfLines={1}>{item.taskState === 'queued' ? t('queued') : t('active')}</Text></View>}
            <Pressable style={styles.more} hitSlop={8} onPress={() => showActions(item.conversation)} accessibilityLabel={t('moreActions')}><Ionicons name="ellipsis-horizontal" size={19} color={colors.textMuted} /></Pressable>
          </View>
          {item.matchSnippet ? <Text style={styles.match} numberOfLines={2}>{item.matchSnippet}</Text> : item.conversation.summary ? <Text style={styles.summary} numberOfLines={2}>{item.conversation.summary}</Text> : null}
        </Pressable>
      }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />} ListFooterComponent={loadingMore ? <View style={styles.loadingMore}><ActivityIndicator size="small" color={colors.accent} /></View> : null}
      ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name={historyError ? 'cloud-offline-outline' : 'chatbubbles-outline'} size={48} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t(historyError ? 'syncRequiredTitle' : 'noConversations')}</Text><Text style={commonStyles.emptyText}>{t(historyError ? 'syncRequiredDesc' : 'noConversationsDesc')}</Text></View>}
    />}
    <QuickPromptComposer projectId={projectFilter} onOpen={open} />
    <AppModal visible={createModal} title={t('newConversation')} onClose={() => setCreateModal(false)}>
      <Text style={commonStyles.label}>{t('conversationTitle')}</Text><TextInput style={commonStyles.input} value={title} onChangeText={setTitle} placeholder={t('conversationTitlePlaceholder')} placeholderTextColor={colors.textMuted} />
      <Text style={[commonStyles.label, styles.fieldGap]}>{t('projects')}</Text><ProjectChoices projects={projects} selected={projectId} onSelect={setProjectId} noProject={t('noProject')} />
      <Pressable style={[commonStyles.primaryButton, styles.submit]} disabled={creating} onPress={() => void createConversation()}>{creating ? <ActivityIndicator color={colors.white} /> : <Text style={commonStyles.primaryButtonText}>{t('create')}</Text>}</Pressable>
    </AppModal>
    <AppModal visible={Boolean(actionConversation)} title={t('conversationActions')} onClose={() => !actionBusy && setActionConversation(null)}>
      <Text style={commonStyles.label}>{t('conversationTitle')}</Text><TextInput style={commonStyles.input} value={actionTitle} onChangeText={setActionTitle} placeholderTextColor={colors.textMuted} />
      <Text style={[commonStyles.label, styles.fieldGap]}>{t('moveToProject')}</Text><ProjectChoices projects={projects} selected={actionProjectId} onSelect={setActionProjectId} noProject={t('noProject')} />
      <Pressable style={[commonStyles.primaryButton, styles.submit]} disabled={actionBusy || !actionTitle.trim()} onPress={() => void updateConversation({ title: actionTitle.trim(), projectId: actionProjectId })}>{actionBusy ? <ActivityIndicator color={colors.white} /> : <Text style={commonStyles.primaryButtonText}>{t('saveChanges')}</Text>}</Pressable>
      <View style={styles.actionGrid}>
        <Pressable style={styles.secondaryAction} disabled={actionBusy} onPress={() => void updateConversation({ pinned: !actionConversation?.pinned })}><Ionicons name={actionConversation?.pinned ? 'pin-outline' : 'pin'} size={18} color={colors.accent} /><Text style={styles.secondaryActionText}>{actionConversation?.pinned ? t('unpin') : t('pin')}</Text></Pressable>
        <Pressable style={styles.secondaryAction} disabled={actionBusy} onPress={() => void updateConversation({ archived: !actionConversation?.archived })}><Ionicons name={actionConversation?.archived ? 'archive-outline' : 'archive'} size={18} color={colors.accent} /><Text style={styles.secondaryActionText}>{actionConversation?.archived ? t('restore') : t('archive')}</Text></Pressable>
      </View>
      <Pressable style={styles.deleteAction} disabled={actionBusy} onPress={removeConversation}><Ionicons name="trash-outline" size={18} color={colors.danger} /><Text style={styles.deleteActionText}>{t('deleteConversation')}</Text></Pressable>
    </AppModal>
  </KeyboardAvoidingView>
}

function ProjectChoices({ projects, selected, onSelect, noProject }: { projects: Project[]; selected: string; onSelect: (id: string) => void; noProject: string }) {
  return <FlatList horizontal style={styles.choiceScroller} contentContainerStyle={styles.choiceContent} data={[{ id: '', name: noProject } as Project, ...projects]} keyExtractor={item => item.id || 'none'} showsHorizontalScrollIndicator={false} renderItem={({ item }) => <Pressable style={[styles.choice, selected === item.id && styles.choiceSelected]} onPress={() => onSelect(item.id)}>{!item.id ? <NoProjectIcon size={17} color={selected === item.id ? colors.text : colors.textMuted} /> : null}<Text style={[styles.choiceText, selected === item.id && styles.choiceTextSelected]} numberOfLines={1}>{item.name}</Text></Pressable>} ItemSeparatorComponent={() => <View style={{ width: 8 }} />} />
}

function QuickPromptComposer({ projectId, onOpen }: { projectId?: string; onOpen: (conversation: Conversation) => void }) {
  const { api, bootstrap, connected, history, refreshHistory, t } = useContext(AppContext)
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState(bootstrap?.settings.defaultMode || 'agent')
  const [modes, setModes] = useState<ModeOption[]>([{ id: 'agent', name: 'agent' }, { id: 'plan', name: 'plan' }, { id: 'ask', name: 'ask' }])
  const [catalog, setCatalog] = useState<Catalog>({ plugins: [], skills: [], integrations: [], mcpServers: [], dbConnections: [] })
  const [slashCommands, setSlashCommands] = useState<BobSlashCommand[]>([])
  const [pluginIds, setPluginIds] = useState<string[]>([])
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [mcpNames, setMcpNames] = useState<string[]>([])
  const [dbNames, setDbNames] = useState<string[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '')
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [toolsModal, setToolsModal] = useState(false)
  const [modeModal, setModeModal] = useState(false)
  const [projectModal, setProjectModal] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [audioBusy, setAudioBusy] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderState = useAudioRecorderState(recorder, 250)
  const projects = history?.projects ?? []
  const project = projects.find(item => item.id === selectedProjectId) ?? null

  useEffect(() => { setSelectedProjectId(projectId ?? '') }, [projectId])

  useEffect(() => {
    let mounted = true
    if (!api) return () => { mounted = false }
    void Promise.all([api.catalog(), api.modes(), api.slashCommands().catch(() => [])]).then(([nextCatalog, nextModes, nextSlashCommands]) => {
      if (!mounted) return
      const allowed = project?.allowedPlugins ?? []
      const allowedIntegrations = project?.allowedIntegrations ?? []
      const next = {
        plugins: nextCatalog.plugins.filter(item => item.enabled && (allowed.length === 0 || allowed.includes(item.id))),
        skills: nextCatalog.skills.filter(item => item.enabled && (allowed.length === 0 || allowed.includes(`skill:${item.slug}`))),
        integrations: allowedIntegrations.length === 0 ? nextCatalog.integrations : nextCatalog.integrations.filter(item => allowedIntegrations.includes(item.id)),
        mcpServers: nextCatalog.mcpServers.filter(item => item.enabled && (allowedIntegrations.length === 0 || allowedIntegrations.includes(`mcp:${item.name}`))),
        dbConnections: nextCatalog.dbConnections.filter(item => item.enabled),
      }
      setCatalog(next)
      setModes(nextModes.length ? nextModes : modes)
      setSlashCommands(nextSlashCommands)
      setPluginIds(current => current.filter(id => next.plugins.some(item => item.id === id)))
      setSkillSlugs(current => current.filter(slug => next.skills.some(item => item.slug === slug)))
      setMcpNames(current => current.filter(name => next.mcpServers.some(item => item.name === name)))
      setDbNames(current => current.filter(name => next.dbConnections.some(item => item.name === name)))
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [api, selectedProjectId, project?.allowedPlugins, project?.allowedIntegrations])

  useEffect(() => {
    setMode(project?.defaultMode || bootstrap?.settings.defaultMode || 'agent')
    setPluginIds([])
    setSkillSlugs([])
    setMcpNames([])
    setDbNames([])
  }, [bootstrap?.settings.defaultMode, selectedProjectId, project?.defaultMode])

  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter(item => item !== value) : [...values, value])
  const togglePlugin = (pluginId: string) => {
    const removing = pluginIds.includes(pluginId)
    setPluginIds(current => removing ? current.filter(item => item !== pluginId) : [...current, pluginId])
    setPrompt(current => removing ? removePluginReference(current, pluginId) : addPluginReference(current, pluginId))
  }
  const removePlugin = (pluginId: string) => {
    setPluginIds(current => current.filter(item => item !== pluginId))
    setPrompt(current => removePluginReference(current, pluginId))
  }

  const attachDocuments = async () => {
    setToolsModal(false)
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
      if (result.canceled) return
      const prepared = await Promise.all(result.assets.map(async asset => ({
        id: `${Date.now()}-${asset.name}`,
        name: asset.name,
        mimeType: asset.mimeType ?? undefined,
        dataBase64: await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }),
      })))
      setAttachments(current => [...current, ...prepared])
    } catch { Alert.alert(t('error'), t('uploadFailed')) }
  }

  const toggleRecording = async () => {
    if (audioBusy) return
    setAudioBusy(true)
    try {
      if (recorderState.isRecording) {
        await recorder.stop()
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        const uri = recorder.uri ?? recorderState.url
        if (!uri) throw new Error('recording-unavailable')
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const dataBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
        setAttachments(current => [...current, {
          id: `voice-${stamp}`,
          name: `dictaphone-${stamp}.m4a`,
          mimeType: 'audio/mp4',
          dataBase64,
        }])
      } else {
        const permission = await requestRecordingPermissionsAsync()
        if (!permission.granted) { Alert.alert(t('microphonePermissionTitle'), t('microphonePermission')); return }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        await recorder.prepareToRecordAsync()
        recorder.record()
      }
    } catch {
      Alert.alert(t('error'), t('recordingFailed'))
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined)
    } finally { setAudioBusy(false) }
  }

  const send = async () => {
    if (!api || sending || recorderState.isRecording || (!prompt.trim() && attachments.length === 0)) return
    const hasVoice = attachments.some(item => item.mimeType?.startsWith('audio/'))
    const content = prompt.trim() || t(hasVoice ? 'voicePromptFallback' : 'attachmentPromptFallback')
    const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 80) || t(hasVoice ? 'voiceRecording' : 'newConversation')
    setSending(true)
    let conversation: Conversation | null = null
    try {
      const selectedProject = selectedProjectId || undefined
      conversation = await api.createConversation({ title, projectId: selectedProject, mode })
      await api.sendPrompt(conversation.id, { prompt: content, mode, projectId: selectedProject, pluginIds, skillSlugs, mcpNames, dbNames, attachments })
      setPrompt('')
      setAttachments([])
      await refreshHistory()
      onOpen(conversation)
    } catch (error) {
      Alert.alert(t('error'), t(isConnectionFailure(error) ? 'connectionFailed' : 'sendFailed'))
      if (conversation) onOpen(conversation)
    } finally { setSending(false) }
  }

  const selectedTools = pluginIds.length + skillSlugs.length + mcpNames.length + dbNames.length
  const selectedPlugins = catalog.plugins.filter(item => pluginIds.includes(item.id))
  const autocompleteItems = useMemo(() => buildPromptAutocompleteItems(prompt, catalog, slashCommands), [catalog, prompt, slashCommands])
  const autocompleteQuery = detectPromptAutocomplete(prompt)
  const selectAutocomplete = (item: PromptAutocompleteItem) => {
    const active = detectPromptAutocomplete(prompt)
    if (!active) return
    setPrompt(applyPromptAutocomplete(prompt, active, item.insert))
    if (!item.resourceId) return
    const resourceId = item.resourceId
    const addUnique = (current: string[]) => current.includes(resourceId) ? current : [...current, resourceId]
    if (item.kind === 'plugin') setPluginIds(addUnique)
    else if (item.kind === 'skill' || item.kind === 'integration') setSkillSlugs(addUnique)
    else if (item.kind === 'mcp') setMcpNames(addUnique)
    else if (item.kind === 'db') setDbNames(addUnique)
  }
  const query = catalogSearch.trim().toLocaleLowerCase()
  const matches = (...parts: Array<string | null | undefined>) => !query || parts.join(' ').toLocaleLowerCase().includes(query)
  const visiblePlugins = catalog.plugins.filter(item => matches(item.id, item.name, item.description))
  const visibleSkills = catalog.skills.filter(item => matches(item.slug, item.name, item.description))
  const visibleIntegrations = catalog.integrations.filter(item => matches(item.id, item.name))
  const visibleMcpServers = catalog.mcpServers.filter(item => matches(item.name, item.transport, item.status))
  const visibleDbConnections = catalog.dbConnections.filter(item => matches(item.name, item.engine))
  const canSend = connected && !sending && !recorderState.isRecording && Boolean(prompt.trim() || attachments.length)
  const recordingSeconds = Math.max(0, Math.floor(recorderState.durationMillis / 1000))

  return <>
    <View style={styles.quickComposer}>
      <SelectedPluginChips plugins={selectedPlugins} accessibilityLabel={t('selectedPlugins')} removeLabel={name => t('removePlugin', { name })} onRemove={removePlugin} />
      {attachments.length > 0 ? <ScrollView horizontal style={styles.quickAttachmentScroller} contentContainerStyle={styles.quickAttachments} showsHorizontalScrollIndicator={false}>{attachments.map(item => <View key={item.id} style={styles.quickAttachment}><Ionicons name={item.mimeType?.startsWith('audio/') ? 'mic' : 'document-outline'} size={14} color={colors.accent} /><Text style={styles.quickAttachmentName} numberOfLines={1}>{item.name}</Text><Pressable onPress={() => setAttachments(current => current.filter(value => value.id !== item.id))} accessibilityLabel={t('remove')}><Ionicons name="close-circle" size={16} color={colors.textMuted} /></Pressable></View>)}</ScrollView> : null}
      <PromptAutocompleteList items={autocompleteItems} title={t(autocompleteQuery?.trigger === '/' ? 'bobCommands' : 'addToPrompt')} onSelect={selectAutocomplete} />
      <View style={styles.quickPromptRow}>
        <Pressable style={styles.quickSquareButton} onPress={() => { setCatalogSearch(''); setToolsModal(true) }} accessibilityLabel={t('attach')}><Ionicons name="add" size={24} color={colors.text} />{selectedTools > 0 ? <View style={styles.quickBadge}><Text style={styles.quickBadgeText}>{selectedTools}</Text></View> : null}</Pressable>
        <GrowingPromptInput style={styles.quickPrompt} value={prompt} onChangeText={setPrompt} placeholder={t('promptPlaceholder')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('promptPlaceholder')} />
        <Pressable style={[styles.quickSquareButton, recorderState.isRecording && styles.quickRecordingButton]} onPress={() => void toggleRecording()} disabled={audioBusy || sending} accessibilityLabel={t(recorderState.isRecording ? 'stopRecording' : 'recordVoice')}>{audioBusy ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name={recorderState.isRecording ? 'stop' : 'mic-outline'} size={20} color={recorderState.isRecording ? colors.white : colors.text} />}</Pressable>
        <Pressable style={[styles.quickSend, !canSend && styles.quickDisabled]} onPress={() => void send()} disabled={!canSend} accessibilityLabel={t('send')}>{sending ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="arrow-up" size={21} color={colors.white} />}</Pressable>
      </View>
      <View style={styles.quickMetaRow}>
        <Pressable style={styles.modeChip} onPress={() => setModeModal(true)}><Ionicons name="sparkles-outline" size={14} color={colors.accent} /><Text style={styles.modeChipText}>{modeLabel(mode, t)}</Text><Ionicons name="chevron-up" size={13} color={colors.textMuted} /></Pressable>
        <Pressable style={[styles.modeChip, styles.projectChip]} onPress={() => setProjectModal(true)}>{project ? <Ionicons name="folder-outline" size={14} color={colors.accent} /> : <NoProjectIcon size={16} color={colors.accent} />}<Text style={styles.modeChipText} numberOfLines={1}>{project?.name ?? t('noProject')}</Text><Ionicons name="chevron-up" size={13} color={colors.textMuted} /></Pressable>
        {recorderState.isRecording ? <View style={styles.recordingStatus}><View style={styles.recordingDot} /><Text style={styles.recordingText}>{t('recording')} · {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</Text></View> : selectedTools > 0 ? <Text style={styles.quickSelectionText}>{t('selectedResources', { count: selectedTools })}</Text> : null}
      </View>
    </View>

    <AppModal visible={modeModal} title={t('mode')} onClose={() => setModeModal(false)}>
      <ScrollView showsVerticalScrollIndicator={false}>{modes.map(item => <Pressable key={item.id} style={styles.quickSelectorRow} onPress={() => { setMode(item.id); setModeModal(false) }}><View style={styles.quickSelectorText}><Text style={styles.quickSelectorName}>{modeLabel(item.id, t)}</Text>{item.description ? <Text style={styles.quickSelectorDescription}>{item.description}</Text> : null}</View>{mode === item.id ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}</Pressable>)}</ScrollView>
    </AppModal>

    <AppModal visible={projectModal} title={t('projects')} onClose={() => setProjectModal(false)}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {[{ id: '', name: t('noProject') } as Project, ...projects].map(item => <Pressable key={item.id || 'none'} style={styles.quickSelectorRow} onPress={() => { setSelectedProjectId(item.id); setProjectModal(false) }}>{!item.id ? <NoProjectIcon size={22} /> : <Ionicons name="folder-outline" size={20} color={colors.textMuted} />}<View style={styles.quickSelectorText}><Text style={styles.quickSelectorName}>{item.name}</Text>{item.description ? <Text style={styles.quickSelectorDescription}>{item.description}</Text> : null}</View>{selectedProjectId === item.id ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}</Pressable>)}
      </ScrollView>
    </AppModal>

    <AppModal visible={toolsModal} title={t('attach')} onClose={() => setToolsModal(false)}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable style={styles.quickActionRow} onPress={() => void attachDocuments()}><View style={styles.quickActionIcon}><Ionicons name="document-attach-outline" size={23} color={colors.accent} /></View><Text style={styles.quickActionText}>{t('importFile')}</Text><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>
        <View style={styles.quickCatalogSearch}><Ionicons name="search" size={17} color={colors.textMuted} /><TextInput value={catalogSearch} onChangeText={setCatalogSearch} style={styles.quickCatalogSearchInput} placeholder={t('searchCatalog')} placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} /></View>
        <Text style={styles.quickSectionTitle}>{t('plugins')}</Text>
        {catalog.plugins.length === 0 ? <Text style={styles.quickEmpty}>{t('noPlugins')}</Text> : visiblePlugins.length ? visiblePlugins.map(item => <QuickSelectorRow key={item.id} name={item.name} description={item.description} selected={pluginIds.includes(item.id)} onPress={() => togglePlugin(item.id)} />) : <Text style={styles.quickEmpty}>{t('noPluginMatch')}</Text>}
        <Text style={styles.quickSectionTitle}>{t('skills')}</Text>
        {catalog.skills.length === 0 ? <Text style={styles.quickEmpty}>{t('noSkills')}</Text> : visibleSkills.length ? visibleSkills.map(item => <QuickSelectorRow key={item.slug} name={item.name} description={item.description} selected={skillSlugs.includes(item.slug)} onPress={() => toggle(item.slug, skillSlugs, setSkillSlugs)} />) : <Text style={styles.quickEmpty}>{t('noSkillMatch')}</Text>}
        <Text style={styles.quickSectionTitle}>{t('integrations')}</Text>
        {catalog.integrations.length === 0 ? <Text style={styles.quickEmpty}>{t('noIntegrations')}</Text> : visibleIntegrations.length ? visibleIntegrations.map(item => {
          const integrationSkill = `bob-work-${item.id}`
          const selectable = item.connected && catalog.skills.some(skill => skill.slug === integrationSkill)
          return <QuickSelectorRow key={item.id} name={item.name} description={item.connected ? t('integrationConnected') : t('integrationDisconnected')} selected={selectable && skillSlugs.includes(integrationSkill)} disabled={!selectable} onPress={() => { if (selectable) toggle(integrationSkill, skillSlugs, setSkillSlugs) }} />
        }) : <Text style={styles.quickEmpty}>{t('noIntegrationMatch')}</Text>}
        <Text style={styles.quickSectionTitle}>{t('mcpAndApis')}</Text>
        {catalog.mcpServers.length === 0 ? <Text style={styles.quickEmpty}>{t('noMcpAndApis')}</Text> : visibleMcpServers.length ? visibleMcpServers.map(item => <QuickSelectorRow key={item.name} name={item.name} description={`${item.transport.toUpperCase()} · ${item.status || t('enabled')}`} selected={mcpNames.includes(item.name)} onPress={() => toggle(item.name, mcpNames, setMcpNames)} />) : <Text style={styles.quickEmpty}>{t('noIntegrationMatch')}</Text>}
        <Text style={styles.quickSectionTitle}>{t('databases')}</Text>
        {catalog.dbConnections.length === 0 ? <Text style={styles.quickEmpty}>{t('noDatabases')}</Text> : visibleDbConnections.length ? visibleDbConnections.map(item => <QuickSelectorRow key={item.id} name={item.name} description={item.engine.toUpperCase()} selected={dbNames.includes(item.name)} onPress={() => toggle(item.name, dbNames, setDbNames)} />) : <Text style={styles.quickEmpty}>{t('noIntegrationMatch')}</Text>}
        <Pressable style={[commonStyles.primaryButton, styles.quickDone]} onPress={() => setToolsModal(false)}><Text style={commonStyles.primaryButtonText}>{t('done')}</Text></Pressable>
      </ScrollView>
    </AppModal>
  </>
}

function QuickSelectorRow({ name, description, selected, disabled, onPress }: { name: string; description?: string | null; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable style={[styles.quickSelectorRow, disabled && styles.quickDisabled]} onPress={onPress} disabled={disabled}><View style={styles.quickSelectorText}><Text style={styles.quickSelectorName}>{name}</Text>{description ? <Text style={styles.quickSelectorDescription} numberOfLines={2}>{description}</Text> : null}</View><Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.accent : colors.textMuted} /></Pressable>
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 90 }, emptyList: { flexGrow: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, grow: { flex: 1, minWidth: 0 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  disabledAction: { opacity: .35 },
  chatIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, chatIconImage: { width: 34, height: 34 }, unreadDot: { position: 'absolute', right: -2, top: -2, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  itemTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: '800' }, metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }, meta: { flexShrink: 1, color: colors.textMuted, fontSize: 12 }, summary: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 12 }, match: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 12, padding: 9, borderRadius: 10, backgroundColor: colors.surfaceRaised },
  running: { maxWidth: 72, flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }, dot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.success }, runningText: { flexShrink: 1, color: colors.success, fontSize: 11, fontWeight: '800' }, more: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  projectFilter: { flexDirection: 'row', alignSelf: 'flex-start', gap: 6, margin: 12, marginBottom: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: colors.surfaceRaised }, filterText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  searchRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }, searchBox: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, paddingVertical: 0 },
  filterScroller: { height: 44, flexGrow: 0, flexShrink: 0 }, filters: { height: 44, alignItems: 'center', paddingHorizontal: 16, gap: 8 }, filterChip: { height: 32, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border }, filterChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, filterChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' }, filterChipTextSelected: { color: colors.accent },
  loadingMore: { height: 52, justifyContent: 'center' }, syncWarning: { marginHorizontal: 16, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 12, backgroundColor: '#3B2B16' }, syncRetry: { flex: 1, minWidth: 0 }, syncWarningText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: '700' }, reconnectButton: { minHeight: 30, maxWidth: 112, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.warning }, reconnectText: { flexShrink: 1, color: colors.warning, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  fieldGap: { marginTop: 16 }, choiceScroller: { height: 42, flexGrow: 0, flexShrink: 0 }, choiceContent: { height: 42, alignItems: 'center' }, choice: { maxWidth: 190, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: colors.border }, choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, choiceText: { flexShrink: 1, color: colors.textMuted, fontSize: 13 }, choiceTextSelected: { color: colors.text, fontWeight: '700' }, submit: { marginTop: 22 },
  actionGrid: { flexDirection: 'row', gap: 10, marginTop: 12 }, secondaryAction: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, borderWidth: 1, borderColor: colors.border }, secondaryActionText: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: '800' }, deleteAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12 }, deleteActionText: { color: colors.danger, fontWeight: '800' },
  quickComposer: { flexShrink: 0, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 7 },
  quickPromptRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 }, quickSquareButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }, quickRecordingButton: { backgroundColor: colors.danger }, quickSend: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }, quickDisabled: { opacity: .42 }, quickPrompt: { flex: 1, minWidth: 0, minHeight: 40, borderRadius: 13, backgroundColor: colors.surfaceRaised, color: colors.text, paddingHorizontal: 11, paddingTop: 10, paddingBottom: 9, fontSize: 14 },
  quickBadge: { position: 'absolute', right: -4, top: -4, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }, quickBadgeText: { color: colors.white, fontSize: 9, fontWeight: '900' },
  quickMetaRow: { minHeight: 29, flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 5 }, modeChip: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 9, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }, projectChip: { maxWidth: 150 }, modeChipText: { flexShrink: 1, color: colors.text, fontSize: 10, fontWeight: '800' }, quickSelectionText: { flex: 1, color: colors.textMuted, fontSize: 9, textAlign: 'right' }, recordingStatus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }, recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger }, recordingText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  quickAttachmentScroller: { height: 34, flexGrow: 0, flexShrink: 0 }, quickAttachments: { height: 34, alignItems: 'flex-start', gap: 6, paddingBottom: 6 }, quickAttachment: { maxWidth: 210, minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 9, backgroundColor: colors.background }, quickAttachmentName: { maxWidth: 150, color: colors.text, fontSize: 10 },
  quickActionRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: colors.border }, quickActionIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, quickActionText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800' }, quickCatalogSearch: { minHeight: 42, marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised }, quickCatalogSearchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, paddingVertical: 8 },
  quickSectionTitle: { marginTop: 15, marginBottom: 3, color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .7 }, quickSelectorRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }, quickSelectorText: { flex: 1, minWidth: 0 }, quickSelectorName: { color: colors.text, fontSize: 13, fontWeight: '800' }, quickSelectorDescription: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 3 }, quickEmpty: { color: colors.textMuted, fontSize: 12, paddingVertical: 9 }, quickDone: { marginTop: 18 },
})
