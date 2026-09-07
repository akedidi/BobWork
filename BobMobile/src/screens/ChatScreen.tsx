import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as Sharing from 'expo-sharing'
import React, { Fragment, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Easing, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View, type TextStyle, type ViewStyle } from 'react-native'
import { Renderer, useMarkdown } from 'react-native-marked'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'
import { WebView } from 'react-native-webview'
import { AppModal } from '../components/AppModal'
import { ConversationMapCard } from '../components/ConversationMapCard'
import { GrowingPromptInput } from '../components/GrowingPromptInput'
import { NoProjectIcon } from '../components/NoProjectIcon'
import { PromptAutocompleteList } from '../components/PromptAutocompleteList'
import { SelectedPluginChips } from '../components/SelectedPluginChips'
import { isSubagentRelatedActivity, SubagentStatusPanel, type SubagentActivity } from '../components/SubagentStatusPanel'
import { TopBar } from '../components/TopBar'
import { AppContext } from '../context/AppContext'
import { modeLabel, riskLevelLabel } from '../labels'
import { normalizeAssistantMarkdown } from '../markdown'
import { mapSpecsFromToolsUsed } from '../mapSpec'
import { addPluginReference, removePluginReference } from '../pluginReferences'
import { formatTime } from '../i18n'
import { applyPromptAutocomplete, buildPromptAutocompleteItems, detectPromptAutocomplete, type PromptAutocompleteItem } from '../promptAutocomplete'
import { colors, commonStyles } from '../theme'
import type { Approval, BobActivityPayload, BobSlashCommand, BobTokenPayload, Catalog, Conversation, FileChange, Message, ModeOption, Project, PromptAttachment, QueuedPrompt, RemoteArtifact } from '../types'
import { isAllowedVisualizationRequest, safeVisualizationHtml, visualizationScrollScript } from '../visualizationHtml'

export function ChatScreen({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const insets = useSafeAreaInsets()
  const { api, bootstrap, history, liveEvents, approvals, setActiveConversationId, refreshApprovals, refreshHistory, t } = useContext(AppContext)
  const [messages, setMessages] = useState<Message[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [mode, setMode] = useState(conversation.bobMode || bootstrap?.settings.defaultMode || 'agent')
  const [modes, setModes] = useState<ModeOption[]>([{ id: 'agent', name: 'agent' }, { id: 'plan', name: 'plan' }, { id: 'ask', name: 'ask' }])
  const [catalog, setCatalog] = useState<Catalog>({ plugins: [], skills: [], integrations: [], mcpServers: [], dbConnections: [] })
  const [slashCommands, setSlashCommands] = useState<BobSlashCommand[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [taskState, setTaskState] = useState<string | null>(null)
  const [pluginIds, setPluginIds] = useState<string[]>([])
  const [skillSlugs, setSkillSlugs] = useState<string[]>([])
  const [mcpNames, setMcpNames] = useState<string[]>([])
  const [dbNames, setDbNames] = useState<string[]>([])
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [attachModal, setAttachModal] = useState(false)
  const [modeModal, setModeModal] = useState(false)
  const [attachSearch, setAttachSearch] = useState('')
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [liveText, setLiveText] = useState('')
  const [subagentActivities, setSubagentActivities] = useState<SubagentActivity[]>([])
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([])
  const mounted = useRef(true)
  const loadedOlder = useRef(false)
  const userScrolled = useRef(false)
  const processedLiveEvent = useRef('')

  useEffect(() => {
    setActiveConversationId(conversation.id)
    setSubagentActivities([])
    return () => setActiveConversationId(null)
  }, [conversation.id, setActiveConversationId])

  const conversationTasks = useMemo(() => (history?.tasks ?? [])
    .filter(task => task.conversationId === conversation.id)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [conversation.id, history?.tasks])
  const latestTask = conversationTasks[0]
  const conversationTaskIds = useMemo(() => new Set(conversationTasks.map(task => task.id)), [conversationTasks])
  const conversationApprovals = approvals.filter(approval => conversationTaskIds.has(approval.taskId) || approval.taskId === currentTaskId)

  const loadInitial = useCallback(async () => {
    if (!api) return
    setLoading(true)
    try {
      const page = await api.messages(conversation.id, undefined, 8)
      if (!mounted.current) return
      setMessages(page.messages)
      loadedOlder.current = false
      userScrolled.current = false
      setNextCursor(page.nextCursor ?? null)
      setHasMore(page.hasMore)
      setTaskState(page.taskState ?? null)
    } finally { if (mounted.current) setLoading(false) }
  }, [api, conversation.id])

  const refreshLatest = useCallback(async () => {
    if (!api) return
    try {
      const page = await api.messages(conversation.id, undefined, 8)
      if (!mounted.current) return
      setMessages(current => {
        const latestIds = new Set(page.messages.map(message => message.id))
        return [...page.messages, ...current.filter(message => !latestIds.has(message.id))]
      })
      if (!loadedOlder.current) {
        setNextCursor(page.nextCursor ?? null)
        setHasMore(page.hasMore)
      }
      setTaskState(page.taskState ?? null)
    } catch { /* the connection banner is handled on explicit actions */ }
  }, [api, conversation.id])

  useEffect(() => {
    mounted.current = true
    void loadInitial()
    if (api) void Promise.all([api.catalog(), api.modes(), api.projects(), api.slashCommands().catch(() => [])]).then(([nextCatalog, nextModes, projects, nextSlashCommands]) => {
      if (mounted.current) {
        const nextProject = projects.find(item => item.id === conversation.projectId) ?? null
        const allowed = nextProject?.allowedPlugins ?? []
        const allowedIntegrations = nextProject?.allowedIntegrations ?? []
        setProject(nextProject)
        setCatalog({
          plugins: nextCatalog.plugins.filter(item => item.enabled && (allowed.length === 0 || allowed.includes(item.id))),
          skills: nextCatalog.skills.filter(item => item.enabled && (allowed.length === 0 || allowed.includes(`skill:${item.slug}`))),
          integrations: allowedIntegrations.length === 0
            ? nextCatalog.integrations
            : nextCatalog.integrations.filter(item => allowedIntegrations.includes(item.id)),
          mcpServers: nextCatalog.mcpServers.filter(item => item.enabled && (allowedIntegrations.length === 0 || allowedIntegrations.includes(`mcp:${item.name}`))),
          dbConnections: nextCatalog.dbConnections.filter(item => item.enabled),
        })
        setModes(nextModes)
        setSlashCommands(nextSlashCommands)
        if (!conversation.bobMode && nextProject?.defaultMode) setMode(nextProject.defaultMode)
      }
    }).catch(() => undefined)
    const timer = setInterval(() => void refreshLatest(), 2500)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [api, loadInitial, refreshLatest])

  useEffect(() => {
    if (!latestTask) return
    setCurrentTaskId(latestTask.id)
    setTaskState(latestTask.state)
  }, [latestTask?.id, latestTask?.state])

  useEffect(() => {
    const envelope = liveEvents[0]
    if (!envelope) return
    const key = `${envelope.sentAt}:${envelope.type}:${JSON.stringify(envelope.payload).slice(0, 120)}`
    if (processedLiveEvent.current === key) return
    processedLiveEvent.current = key
    const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload as Record<string, unknown> : {}
    if (envelope.type === 'bob-token') {
      const token = payload as unknown as BobTokenPayload
      if (token.conversationId === conversation.id && token.eventType === 'text') {
        setCurrentTaskId(token.taskId ?? null)
        setLiveText(current => current + token.chunk)
      }
    }
    if (envelope.type === 'bob-activity') {
      const activity = payload as unknown as BobActivityPayload
      if (activity.conversationId === conversation.id) {
        setCurrentTaskId(activity.taskId ?? null)
        const event: SubagentActivity = {
          eventType: activity.eventType || activity.type || '',
          title: activity.title,
          content: activity.content,
          toolName: activity.toolName,
          payload: activity.payload,
        }
        if (isSubagentRelatedActivity(event)) {
          setSubagentActivities(current => {
            const fingerprint = JSON.stringify(event)
            if (current.some(item => JSON.stringify(item) === fingerprint)) return current
            return [...current, event].slice(-120)
          })
        }
      }
    }
    if (envelope.type === 'task-updated') {
      const taskId = typeof envelope.payload === 'string' ? envelope.payload : typeof payload.id === 'string' ? payload.id : null
      if (taskId && (taskId === currentTaskId || conversationTaskIds.has(taskId))) {
        void refreshHistory()
      }
    }
    if (envelope.type === 'bob-session-done' && payload.conversationId === conversation.id) {
      setTaskState(payload.success === true ? 'completed' : 'failed')
      void refreshLatest().finally(() => setLiveText(''))
      void refreshHistory()
    }
    if (envelope.type === 'conversation-updated' || envelope.type === 'conversation-messages-changed') {
      const conversationId = typeof envelope.payload === 'string'
        ? envelope.payload
        : typeof payload.conversationId === 'string'
          ? payload.conversationId
          : typeof payload.id === 'string' ? payload.id : null
      if (conversationId === conversation.id) void refreshLatest()
    }
    if (envelope.type === 'approval-required' || envelope.type === 'approval-resolved') void refreshApprovals()
  }, [conversation.id, conversationTaskIds, currentTaskId, liveEvents, refreshApprovals, refreshHistory, refreshLatest])

  const loadOlder = async () => {
    if (!api || !hasMore || !nextCursor || loadingOlder) return
    setLoadingOlder(true)
    loadedOlder.current = true
    try {
      const page = await api.messages(conversation.id, nextCursor, 8)
      setMessages(current => {
        const ids = new Set(current.map(message => message.id))
        return [...current, ...page.messages.filter(message => !ids.has(message.id))]
      })
      setNextCursor(page.nextCursor ?? null)
      setHasMore(page.hasMore)
    } finally { setLoadingOlder(false) }
  }

  const dispatchPrompt = useCallback(async (item: QueuedPrompt) => {
    if (!api) return
    setSending(true)
    setTaskState('starting')
    try {
      const input = { prompt: item.prompt, mode: item.mode, projectId: item.projectId, pluginIds: item.pluginIds, skillSlugs: item.skillSlugs, mcpNames: item.mcpNames, dbNames: item.dbNames, attachments: item.attachments }
      const response = item.editMessageId
        ? await api.resendPrompt(conversation.id, item.editMessageId, input)
        : await api.sendPrompt(conversation.id, input)
      setCurrentTaskId(response.session.taskId)
      setTaskState(response.session.awaitingApproval ? 'awaiting_approval' : 'starting')
      setEditingMessageId(null)
      setLiveText('')
      await refreshLatest()
    } catch {
      setTaskState(null)
      setPrompt(item.prompt); setAttachments(item.attachments); setPluginIds(item.pluginIds); setSkillSlugs(item.skillSlugs); setMcpNames(item.mcpNames); setDbNames(item.dbNames); setEditingMessageId(item.editMessageId ?? null)
      Alert.alert(t('error'), t('sendFailed'))
    } finally { setSending(false) }
  }, [api, conversation.id, refreshLatest, t])

  const bobWorking = ['starting', 'running', 'queued', 'awaiting_info', 'awaiting_approval', 'paused'].includes(taskState ?? '')
  const showSubagentStatus = bobWorking && subagentActivities.length > 0
  const waitingForInfo = taskState === 'awaiting_info'
  const send = async () => {
    if (!api || !prompt.trim() || sending) return
    const item: QueuedPrompt = { id: `${Date.now()}-${Math.random()}`, prompt: prompt.trim(), mode, projectId: conversation.projectId ?? undefined, pluginIds: [...pluginIds], skillSlugs: [...skillSlugs], mcpNames: [...mcpNames], dbNames: [...dbNames], attachments: [...attachments], editMessageId: editingMessageId ?? undefined }
    setPrompt(''); setAttachments([])
    if (bobWorking && !waitingForInfo && !editingMessageId) {
      setPromptQueue(current => [...current, item])
      return
    }
    await dispatchPrompt(item)
  }

  useEffect(() => {
    if (bobWorking || sending || promptQueue.length === 0) return
    const [next, ...rest] = promptQueue
    if (!next) return
    setPromptQueue(rest)
    void dispatchPrompt(next)
  }, [bobWorking, dispatchPrompt, promptQueue, sending])

  const moveQueuedPrompt = (index: number, direction: -1 | 1) => setPromptQueue(current => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    const sourceItem = next[index]
    const targetItem = next[target]
    if (!sourceItem || !targetItem) return current
    next[index] = targetItem
    next[target] = sourceItem
    return next
  })

  const attachDocuments = async () => {
    setAttachModal(false)
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

  const attachImage = async () => {
    setAttachModal(false)
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) { Alert.alert(t('error'), t('imagePermission')); return }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, base64: true, quality: .86 })
      if (result.canceled) return
      const prepared = result.assets.flatMap((asset, index) => asset.base64 ? [{
        id: `${Date.now()}-image-${index}`,
        name: asset.fileName ?? `image-${index + 1}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
        dataBase64: asset.base64,
      }] : [])
      setAttachments(current => [...current, ...prepared])
    } catch { Alert.alert(t('error'), t('uploadFailed')) }
  }

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
  const attachQuery = attachSearch.trim().toLocaleLowerCase()
  const matchesAttachQuery = (...parts: Array<string | null | undefined>) =>
    !attachQuery || parts.join(' ').toLocaleLowerCase().includes(attachQuery)
  const visiblePlugins = catalog.plugins.filter(item => matchesAttachQuery(item.id, item.name, item.description))
  const visibleSkills = catalog.skills.filter(item => matchesAttachQuery(item.slug, item.name, item.description))
  const visibleIntegrations = catalog.integrations.filter(item => matchesAttachQuery(item.id, item.name))
  const visibleMcpServers = catalog.mcpServers.filter(item => matchesAttachQuery(item.name, item.transport, item.status))
  const visibleDbConnections = catalog.dbConnections.filter(item => matchesAttachQuery(item.name, item.engine))
  const closeAttachModal = () => {
    setAttachModal(false)
    setAttachSearch('')
  }
  const showWorkingLoader = ['starting', 'running', 'queued'].includes(taskState ?? '') && conversationApprovals.length === 0
  const showTaskActions = !bobWorking && latestTask && ['failed', 'cancelled'].includes(latestTask.state)

  const stopCurrentTask = () => {
    if (!api || !currentTaskId) return
    Alert.alert(t('stopTask'), t('stopTaskConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('stopTask'), style: 'destructive', onPress: () => {
      setActionBusy('stop')
      void api.cancelTask(currentTaskId).then(() => { setTaskState('cancelled'); return refreshHistory() }).catch(() => Alert.alert(t('error'), t('stopFailed'))).finally(() => setActionBusy(null))
    } }])
  }

  const retryCurrentTask = () => {
    if (!api || !latestTask) return
    Alert.alert(t('retryTask'), t('retryTaskConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('retryTask'), onPress: () => {
      setActionBusy('retry')
      void api.retryTask(latestTask.id).then(result => { setCurrentTaskId(result.session.taskId); setTaskState(result.session.awaitingApproval ? 'awaiting_approval' : 'starting'); return refreshHistory() }).catch(() => Alert.alert(t('error'), t('retryFailed'))).finally(() => setActionBusy(null))
    } }])
  }

  const decideApproval = async (approval: Approval, decision: 'approved' | 'denied', duration?: 'once' | 'task' | 'always') => {
    if (!api) return
    setActionBusy(approval.id)
    try {
      await api.resolveApproval(approval.id, decision, duration)
      await Promise.all([refreshApprovals(), refreshHistory()])
    } catch { Alert.alert(t('error'), t('approvalFailed')) } finally { setActionBusy(null) }
  }

  return (
    <KeyboardAvoidingView style={commonStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : 0}>
      <TopBar title={conversation.title} subtitle={`${project?.name ?? t('noProject')} · ${modes.find(item => item.id === mode)?.name ?? mode}`} subtitleLeading={!project ? <NoProjectIcon size={12} /> : undefined} onBack={onBack} />
      {loading ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={item => item.id}
          style={styles.messages}
          contentContainerStyle={[styles.messagesContent, messages.length === 0 && { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => { userScrolled.current = true }}
          onEndReached={() => { if (userScrolled.current) void loadOlder() }}
          onEndReachedThreshold={.35}
          renderItem={({ item }) => <MessageBubble message={item} onEdit={item.author === 'user' ? () => { setEditingMessageId(item.id); setPrompt(item.content); setAttachments([]) } : undefined} />}
          ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
          ListHeaderComponent={liveText
            ? <StreamingResponseBubble text={liveText} />
            : showWorkingLoader ? <TypingDots accessibilityLabel={t('bobWorking')} /> : null}
          ListFooterComponent={loadingOlder ? <View style={styles.older}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.olderText}>{t('loadingOlder')}</Text></View> : null}
          ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name="sparkles-outline" size={44} color={colors.accent} /><Text style={commonStyles.emptyText}>{t('noMessages')}</Text></View>}
        />
      )}
      {conversationApprovals.map(approval => <ApprovalCard key={approval.id} approval={approval} busy={actionBusy === approval.id} onDecision={(decision, duration) => void decideApproval(approval, decision, duration)} />)}
      {showSubagentStatus ? <SubagentStatusPanel events={subagentActivities} t={t} /> : null}
      <View style={styles.composer}>
        {promptQueue.length > 0 && <View style={styles.queuePanel}>
          <View style={styles.queueHeader}><Ionicons name="layers-outline" size={15} color={colors.accent} /><Text style={styles.queueTitle}>{t('queuedPrompts', { count: promptQueue.length })}</Text><Pressable onPress={() => setPromptQueue([])}><Text style={styles.queueClear}>{t('clearQueue')}</Text></Pressable></View>
          {promptQueue.slice(0, 3).map((item, index) => <View style={styles.queueItem} key={item.id}><Text style={styles.queuePrompt} numberOfLines={1}>{item.prompt}</Text><Pressable disabled={index === 0} onPress={() => moveQueuedPrompt(index, -1)} accessibilityLabel={t('moveUp')}><Ionicons name="chevron-up" size={17} color={index === 0 ? colors.border : colors.textMuted} /></Pressable><Pressable disabled={index === promptQueue.length - 1} onPress={() => moveQueuedPrompt(index, 1)} accessibilityLabel={t('moveDown')}><Ionicons name="chevron-down" size={17} color={index === promptQueue.length - 1 ? colors.border : colors.textMuted} /></Pressable><Pressable onPress={() => setPromptQueue(current => current.filter(value => value.id !== item.id))} accessibilityLabel={t('remove')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable></View>)}
        </View>}
        {showTaskActions ? <View style={styles.taskActions}>
          {!bobWorking && latestTask && ['failed', 'cancelled'].includes(latestTask.state) ? <Pressable style={styles.taskAction} onPress={retryCurrentTask} disabled={actionBusy !== null}><Ionicons name="refresh-outline" size={17} color={colors.accent} /><Text style={styles.taskActionText}>{t('retryTask')}</Text></Pressable> : null}
        </View> : null}
        {editingMessageId ? <View style={styles.composerBanner}><Ionicons name="create-outline" size={15} color={colors.accent} /><Text style={styles.composerBannerText}>{t('editingPrompt')}</Text><Pressable accessibilityLabel={t('cancelEdit')} onPress={() => { setEditingMessageId(null); setPrompt('') }}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable></View> : null}
        <SelectedPluginChips plugins={selectedPlugins} accessibilityLabel={t('selectedPlugins')} removeLabel={name => t('removePlugin', { name })} onRemove={removePlugin} />
        {attachments.length > 0 && <ScrollView horizontal style={styles.attachmentScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>{attachments.map(attachment => <View style={styles.attachment} key={attachment.id}><Ionicons name={attachment.mimeType?.startsWith('image/') ? 'image-outline' : 'document-outline'} size={15} color={colors.accent} /><Text style={styles.attachmentName} numberOfLines={1}>{attachment.name}</Text><Pressable onPress={() => setAttachments(current => current.filter(item => item.id !== attachment.id))}><Ionicons name="close-circle" size={17} color={colors.textMuted} /></Pressable></View>)}</ScrollView>}
        <PromptAutocompleteList items={autocompleteItems} title={t(autocompleteQuery?.trigger === '/' ? 'bobCommands' : 'addToPrompt')} onSelect={selectAutocomplete} />
        <View style={styles.promptRow}>
          <Pressable style={styles.plus} onPress={() => { setAttachSearch(''); setAttachModal(true) }} accessibilityLabel={t('attach')}>
            <Ionicons name="add" size={25} color={colors.text} />
            {selectedTools > 0 ? <View style={styles.plusBadge}><Text style={styles.plusBadgeText}>{selectedTools}</Text></View> : null}
          </Pressable>
          <GrowingPromptInput style={styles.prompt} value={prompt} onChangeText={setPrompt} placeholder={t('promptPlaceholder')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('promptPlaceholder')} />
          {bobWorking && currentTaskId
            ? <Pressable style={[styles.send, styles.inlineStop, actionBusy !== null && styles.sendDisabled]} onPress={stopCurrentTask} disabled={actionBusy !== null} accessibilityLabel={t('stopTask')}>{actionBusy === 'stop' ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="stop" size={18} color={colors.white} />}</Pressable>
            : <Pressable style={[styles.send, (!prompt.trim() || sending) && styles.sendDisabled]} onPress={() => void send()} disabled={!prompt.trim() || sending} accessibilityLabel={t('send')}>{sending ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="arrow-up" size={22} color={colors.white} />}</Pressable>}
        </View>
        <View style={styles.composerMetaRow}>
          <Pressable style={styles.modeChip} onPress={() => setModeModal(true)} accessibilityLabel={t('mode')}>
            <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
            <Text style={styles.modeChipText}>{modeLabel(mode, t)}</Text>
            <Ionicons name="chevron-up" size={13} color={colors.textMuted} />
          </Pressable>
          {selectedTools > 0 ? <Text style={styles.selectedResourcesText}>{t('selectedResources', { count: selectedTools })}</Text> : null}
        </View>
      </View>

      <AppModal visible={modeModal} title={t('mode')} onClose={() => setModeModal(false)}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {modes.map(item => (
            <Pressable key={item.id} style={styles.selectorRow} onPress={() => { setMode(item.id); setModeModal(false) }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectorName}>{modeLabel(item.id, t)}</Text>
                {item.description ? <Text style={styles.selectorDesc} numberOfLines={2}>{item.description}</Text> : null}
              </View>
              {mode === item.id ? <Ionicons name="checkmark-circle" color={colors.accent} size={22} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </AppModal>

      <AppModal visible={attachModal} title={t('attach')} onClose={closeAttachModal}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable style={styles.actionRow} onPress={() => void attachDocuments()}><View style={styles.actionIcon}><Ionicons name="document-text-outline" size={24} color={colors.accent} /></View><Text style={styles.actionText}>{t('attachFile')}</Text><Ionicons name="chevron-forward" color={colors.textMuted} /></Pressable>
          <Pressable style={styles.actionRow} onPress={() => void attachImage()}><View style={styles.actionIcon}><Ionicons name="images-outline" size={24} color={colors.accent} /></View><Text style={styles.actionText}>{t('attachPhoto')}</Text><Ionicons name="chevron-forward" color={colors.textMuted} /></Pressable>
          <View style={styles.catalogSearch}>
            <Ionicons name="search" size={17} color={colors.textMuted} />
            <TextInput
              value={attachSearch}
              onChangeText={setAttachSearch}
              style={styles.catalogSearchInput}
              placeholder={t('searchCatalog')}
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel={t('searchCatalog')}
            />
          </View>
          <Text style={styles.toolRule}>{project?.allowedPlugins.length ? t('projectToolsRestricted') : t('allToolsAvailable')}</Text>
          <Text style={styles.sectionTitle}>{t('plugins')}</Text>
          {catalog.plugins.length === 0
            ? <Text style={styles.emptySection}>{t('noPlugins')}</Text>
            : visiblePlugins.length > 0
              ? visiblePlugins.map(item => <SelectorRow key={item.id} name={item.name} description={item.description} selected={pluginIds.includes(item.id)} onPress={() => togglePlugin(item.id)} />)
              : <Text style={styles.emptySection}>{t('noPluginMatch')}</Text>}
          <Text style={styles.sectionTitle}>{t('skills')}</Text>
          {catalog.skills.length === 0
            ? <Text style={styles.emptySection}>{t('noSkills')}</Text>
            : visibleSkills.length > 0
              ? visibleSkills.map(item => <SelectorRow key={item.slug} name={item.name} description={item.description} selected={skillSlugs.includes(item.slug)} onPress={() => toggle(item.slug, skillSlugs, setSkillSlugs)} />)
              : <Text style={styles.emptySection}>{t('noSkillMatch')}</Text>}
          <Text style={styles.sectionTitle}>{t('integrations')}</Text>
          {catalog.integrations.length === 0
            ? <Text style={styles.emptySection}>{t('noIntegrations')}</Text>
            : visibleIntegrations.length > 0
              ? visibleIntegrations.map(item => {
                const skillSlug = `bob-work-${item.id}`
                const selectable = item.connected && catalog.skills.some(skill => skill.slug === skillSlug)
                return (
                  <SelectorRow
                    key={item.id}
                    name={item.name}
                    description={item.connected ? t('integrationConnected') : t('integrationDisconnected')}
                    selected={selectable && skillSlugs.includes(skillSlug)}
                    onPress={selectable ? () => toggle(skillSlug, skillSlugs, setSkillSlugs) : () => undefined}
                  />
                )
              })
              : <Text style={styles.emptySection}>{t('noIntegrationMatch')}</Text>}
          <Text style={styles.sectionTitle}>{t('mcpAndApis')}</Text>
          {catalog.mcpServers.length === 0
            ? <Text style={styles.emptySection}>{t('noMcpAndApis')}</Text>
            : visibleMcpServers.length > 0
              ? visibleMcpServers.map(item => <SelectorRow key={item.name} name={item.name} description={`${item.transport.toUpperCase()} · ${item.status || t('enabled')}`} selected={mcpNames.includes(item.name)} onPress={() => toggle(item.name, mcpNames, setMcpNames)} />)
              : <Text style={styles.emptySection}>{t('noIntegrationMatch')}</Text>}
          <Text style={styles.sectionTitle}>{t('databases')}</Text>
          {catalog.dbConnections.length === 0
            ? <Text style={styles.emptySection}>{t('noDatabases')}</Text>
            : visibleDbConnections.length > 0
              ? visibleDbConnections.map(item => <SelectorRow key={item.id} name={item.name} description={item.engine.toUpperCase()} selected={dbNames.includes(item.name)} onPress={() => toggle(item.name, dbNames, setDbNames)} />)
              : <Text style={styles.emptySection}>{t('noIntegrationMatch')}</Text>}
          <Pressable style={[commonStyles.primaryButton, { marginTop: 18 }]} onPress={closeAttachModal}><Text style={commonStyles.primaryButtonText}>{t('done')}</Text></Pressable>
        </ScrollView>
      </AppModal>
    </KeyboardAvoidingView>
  )
}

function StreamingResponseBubble({ text }: { text: string }) {
  return (
    <View style={[styles.messageRow, styles.streamingMessage]} accessibilityLiveRegion="polite">
      <View style={styles.avatar}><Image source={require('../../assets/bob-avatar.png')} style={styles.avatarImage} resizeMode="contain" /></View>
      <View style={[styles.bubble, styles.assistantBubble]}>
        <Text style={styles.author}>Bob</Text>
        <MessageMarkdown value={text} user={false} />
      </View>
    </View>
  )
}

function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (decision: 'approved' | 'denied', duration?: 'once' | 'task' | 'always') => void }) {
  const { t } = useContext(AppContext)
  return (
    <View style={styles.approvalCard}>
      <View style={styles.approvalHeader}><Ionicons name="shield-checkmark-outline" size={20} color={colors.warning} /><View style={{ flex: 1 }}><Text style={styles.approvalTitle}>{t('taskApproval')}</Text><Text style={styles.approvalRisk}>{t('risk', { level: riskLevelLabel(approval.riskLevel, t) })}</Text></View>{busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}</View>
      <Text style={styles.approvalDescription}>{approval.humanDescription}</Text>
      {approval.commandOrChange ? <Text style={styles.approvalCommand} numberOfLines={3}>{approval.commandOrChange}</Text> : null}
      <View style={styles.approvalActions}>
        <Pressable style={[styles.approvalButton, styles.denyButton]} disabled={busy} onPress={() => onDecision('denied')}><Text style={styles.denyText}>{t('deny')}</Text></Pressable>
        <Pressable style={[styles.approvalButton, styles.allowButton]} disabled={busy} onPress={() => onDecision('approved', 'once')}><Text style={styles.allowText}>{t('approveOnce')}</Text></Pressable>
        <Pressable style={styles.approvalButton} disabled={busy} onPress={() => onDecision('approved', 'task')}><Text style={styles.taskActionText}>{t('approveTask')}</Text></Pressable>
        {approval.riskLevel !== 'critical' ? <Pressable style={styles.approvalButton} disabled={busy} onPress={() => onDecision('approved', 'always')}><Text style={styles.taskActionText}>{t('approveAlways')}</Text></Pressable> : null}
      </View>
    </View>
  )
}

function MessageBubble({ message, onEdit }: { message: Message; onEdit?: () => void }) {
  const { language, t } = useContext(AppContext)
  const user = message.author === 'user'
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  return (
    <View style={[styles.messageRow, user && styles.userMessageRow]}>
      {!user && <View style={styles.avatar}><Image source={require('../../assets/bob-avatar.png')} style={styles.avatarImage} resizeMode="contain" /></View>}
      <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
        <View style={styles.messageHeader}><Text style={[styles.author, user && styles.userAuthor]}>{user ? t('you') : 'Bob'}</Text><Text style={[styles.time, user && styles.userTime]}>{formatTime(message.createdAt, language)}</Text></View>
        <MessageMarkdown value={message.content} user={user} />
        {!user ? mapSpecsFromToolsUsed(message.toolsUsed).map((spec, index) => <ConversationMapCard key={`${spec.title}-${index}`} spec={spec} />) : null}
        {!user && message.artifacts?.length ? <ArtifactResources artifacts={message.artifacts} /> : null}
        {!user && message.fileChanges?.length ? <FileChanges changes={message.fileChanges} /> : null}
        {attachments.length > 0 && <View style={styles.messageAttachments}>{attachments.map((attachment, index) => {
          const value = attachment as { name?: string; type?: string }
          return <View key={`${message.id}-attachment-${index}`} style={styles.messageAttachment}><Ionicons name={value.type === 'image' ? 'image-outline' : 'document-outline'} size={13} color={user ? colors.white : colors.accent} /><Text style={[styles.messageAttachmentText, user && styles.userAttachmentText]} numberOfLines={1}>{value.name ?? t('attachment')}</Text></View>
        })}</View>}
        <View style={[styles.messageActions, user && styles.userMessageActions]}>
          {onEdit && <Pressable style={styles.messageAction} onPress={onEdit}><Ionicons name="create-outline" size={13} color={user ? colors.white : colors.textMuted} /><Text style={[styles.messageActionText, user && styles.userMessageActionText]}>{t('editPrompt')}</Text></Pressable>}
          <Pressable style={styles.messageAction} onPress={() => void Clipboard.setStringAsync(message.content).then(() => Alert.alert(t('copied')))}><Ionicons name="copy-outline" size={13} color={user ? colors.white : colors.textMuted} /><Text style={[styles.messageActionText, user && styles.userMessageActionText]}>{t('copyMarkdown')}</Text></Pressable>
          {!user && <Pressable style={styles.messageAction} onPress={() => void Share.share({ message: message.content })}><Ionicons name="share-outline" size={13} color={colors.textMuted} /><Text style={styles.messageActionText}>{t('shareResponse')}</Text></Pressable>}
        </View>
      </View>
    </View>
  )
}

function FileChanges({ changes }: { changes: FileChange[] }) {
  const { t } = useContext(AppContext)
  const presentation = {
    created: { label: t('fileCreated'), icon: 'add-circle-outline' as const, color: colors.success },
    modified: { label: t('fileModified'), icon: 'create-outline' as const, color: colors.warning },
    deleted: { label: t('fileDeleted'), icon: 'trash-outline' as const, color: colors.danger },
  }
  return <View style={styles.fileChanges} accessibilityLabel={t('fileChanges')}>
    <Text style={styles.fileChangesTitle}>{t('fileChanges')}</Text>
    {changes.map(change => {
      const item = presentation[change.changeType]
      const name = change.path.split(/[\\/]/).filter(Boolean).pop() ?? change.path
      return <View style={styles.fileChange} key={`${change.changeType}:${change.path}`}>
        <Ionicons name={item.icon} size={16} color={item.color} />
        <Text style={styles.fileChangePath} numberOfLines={1}>{name}</Text>
        <Text style={[styles.fileChangeStatus, { color: item.color }]}>{item.label}</Text>
      </View>
    })}
  </View>
}

export function MessageMarkdown({ value, user }: { value: string; user: boolean }) {
  const textColor = user ? colors.white : colors.text
  const elements = useMarkdown(normalizeAssistantMarkdown(value), {
    renderer: bobMarkdownRenderer,
    colorScheme: 'dark',
    theme: { colors: { text: textColor, link: user ? '#E0EAFF' : '#8FB0FF', code: textColor, border: user ? '#8FB0FF' : colors.border } },
    styles: {
      text: { color: textColor, fontSize: 14, lineHeight: 21 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      h1: { color: textColor, fontSize: 22, lineHeight: 28, marginBottom: 8 },
      h2: { color: textColor, fontSize: 19, lineHeight: 25, marginBottom: 7 },
      h3: { color: textColor, fontSize: 17, lineHeight: 23, marginBottom: 6 },
      h4: { color: textColor, fontSize: 15, lineHeight: 21, marginBottom: 5 },
      h5: { color: textColor, fontSize: 14, lineHeight: 20, marginBottom: 4 },
      h6: { color: textColor, fontSize: 13, lineHeight: 19, marginBottom: 4 },
      list: { marginVertical: 4 },
      li: { color: textColor, fontSize: 14, lineHeight: 21 },
      blockquote: { borderLeftWidth: 3, borderLeftColor: user ? '#D6E2FF' : colors.accent, paddingLeft: 10, marginVertical: 6, opacity: .92 },
      codespan: { color: textColor, backgroundColor: user ? '#376BCF' : '#0B1220', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
      code: { backgroundColor: user ? '#315FBA' : '#080C14', borderWidth: 1, borderColor: user ? '#8FB0FF' : colors.border, borderRadius: 10, padding: 10, marginVertical: 7 },
      table: { borderWidth: 1, borderColor: user ? '#8FB0FF' : colors.border, borderRadius: 8, marginVertical: 8 },
      tableRow: { borderBottomWidth: 1, borderBottomColor: user ? '#8FB0FF' : colors.border },
      tableCell: { paddingHorizontal: 8, paddingVertical: 7, minWidth: 88 },
      hr: { backgroundColor: user ? '#8FB0FF' : colors.border, height: 1, marginVertical: 9 },
    },
  })
  return <View style={styles.markdown}>{elements.map((element, index) => <Fragment key={`markdown-${index}`}>{element}</Fragment>)}</View>
}

class BobMarkdownRenderer extends Renderer {
  override code(text: string, _language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle): ReactNode {
    return (
      <ScrollView
        key={this.getKey()}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.markdownCodeScroll}
        contentContainerStyle={[containerStyle, styles.markdownCodeScrollContent]}
      >
        <View><Text selectable style={textStyle}>{text}</Text></View>
      </ScrollView>
    )
  }

  override table(header: ReactNode[][], rows: ReactNode[][][]): ReactNode {
    const columnCount = Math.max(header.length, ...rows.map(row => row.length), 1)
    const regularCellWidth = columnCount <= 2 ? 180 : 150
    const renderRow = (cells: ReactNode[][], headerRow: boolean, rowIndex: number) => (
      <View
        key={`markdown-table-row-${rowIndex}`}
        style={[styles.markdownTableRow, headerRow && styles.markdownTableHeaderRow]}
      >
        {Array.from({ length: columnCount }, (_, cellIndex) => (
          <View
            key={`markdown-table-cell-${rowIndex}-${cellIndex}`}
            style={[
              styles.markdownTableCell,
              { width: cellIndex === 0 ? Math.max(165, regularCellWidth) : regularCellWidth },
              cellIndex === columnCount - 1 && styles.markdownTableLastCell,
            ]}
          >
            {cells[cellIndex] ?? null}
          </View>
        ))}
      </View>
    )

    return (
      <ScrollView
        key={this.getKey()}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.markdownTableScroll}
        contentContainerStyle={styles.markdownTableScrollContent}
      >
        <View style={styles.markdownTable}>
          {renderRow(header, true, 0)}
          {rows.map((row, index) => renderRow(row, false, index + 1))}
        </View>
      </ScrollView>
    )
  }
}

const bobMarkdownRenderer = new BobMarkdownRenderer()

function ArtifactResources({ artifacts }: { artifacts: RemoteArtifact[] }) {
  const { api, t } = useContext(AppContext)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedArtifact, setExpandedArtifact] = useState<RemoteArtifact | null>(null)

  const openOrDownload = async (artifact: RemoteArtifact) => {
    if (!api || busyId) return
    setBusyId(artifact.id)
    try {
      const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory
      if (!root) throw new Error('storage-unavailable')
      const directory = `${root}bob-artifacts/`
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const safeName = artifact.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_') || `artifact-${artifact.id}`
      const target = `${directory}${artifact.id}-${safeName}`
      const result = await FileSystem.downloadAsync(
        api.artifactContentUrl(artifact.id, true),
        target,
        { headers: api.authorizationHeaders() },
      )
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { mimeType: artifact.mimeType, dialogTitle: artifact.title })
      } else {
        Alert.alert(artifact.title, t('downloadComplete'))
      }
    } catch {
      Alert.alert(t('error'), t('artifactFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View style={styles.artifacts}>
      <Text style={styles.artifactsTitle}>{t('artifacts')}</Text>
      {artifacts.map(artifact => (
        <View style={styles.artifactCard} key={artifact.id}>
          {artifact.inlinePreview ? <InlineArtifact artifact={artifact} /> : null}
          <View style={styles.artifactInfo}>
            <View style={styles.artifactIcon}><Ionicons name={artifact.mimeType === 'application/pdf' ? 'document-text-outline' : artifact.mimeType.includes('presentation') ? 'easel-outline' : artifact.mimeType.includes('spreadsheet') ? 'grid-outline' : 'document-attach-outline'} size={18} color={colors.accent} /></View>
            <View style={styles.artifactTextGroup}><Text style={styles.artifactName} numberOfLines={2}>{artifact.title}</Text><Text style={styles.artifactMeta} numberOfLines={1}>{artifact.fileName}{artifact.size ? ` · ${formatBytes(artifact.size)}` : ''}</Text></View>
          </View>
          {isHtmlArtifact(artifact) ? <Pressable style={styles.artifactAction} onPress={() => setExpandedArtifact(artifact)}><Ionicons name="expand-outline" size={17} color={colors.accent} /><Text style={styles.artifactActionText}>{t('openPreview')}</Text></Pressable> : null}
          <Pressable style={styles.artifactAction} onPress={() => void openOrDownload(artifact)} disabled={busyId !== null}>
            {busyId === artifact.id ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="download-outline" size={17} color={colors.accent} />}
            <Text style={styles.artifactActionText} numberOfLines={1}>{artifact.inlinePreview ? t('download') : t('openOrDownload')}</Text>
          </Pressable>
        </View>
      ))}
      <VisualizationPreviewModal artifact={expandedArtifact} onClose={() => setExpandedArtifact(null)} />
    </View>
  )
}

function isHtmlArtifact(artifact: RemoteArtifact) {
  return artifact.mimeType.toLowerCase().startsWith('text/html') || /\.html?$/i.test(artifact.fileName)
}

function InlineArtifact({ artifact }: { artifact: RemoteArtifact }) {
  const { api } = useContext(AppContext)
  const [content, setContent] = useState<string | null>(null)
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null)
  const isSvg = artifact.mimeType === 'image/svg+xml'
  const isHtml = isHtmlArtifact(artifact)

  useEffect(() => {
    let disposed = false
    if ((isSvg || isHtml) && api) {
      setContent(null)
      void api.artifactText(artifact.id).then(value => { if (!disposed) setContent(value) }).catch(() => undefined)
    }
    return () => { disposed = true }
  }, [api, artifact.id, isHtml, isSvg])

  useEffect(() => setImageAspectRatio(null), [artifact.id])

  if (!api) return null
  return (
    <View style={[styles.artifactPreview, imageAspectRatio ? { height: undefined, aspectRatio: imageAspectRatio } : null]}>
      {isSvg
        ? content ? <SvgXml xml={content} width="100%" height="100%" /> : <ActivityIndicator color={colors.accent} />
        : isHtml ? content ? <WebView source={{ html: safeVisualizationHtml(content) }} originWhitelist={['about:blank', 'https://*']} javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false} scrollEnabled nestedScrollEnabled bounces showsHorizontalScrollIndicator showsVerticalScrollIndicator injectedJavaScript={visualizationScrollScript} onShouldStartLoadWithRequest={(request) => isAllowedVisualizationRequest(request.url)} style={styles.artifactWebView} /> : <ActivityIndicator color={colors.accent} />
        : <Image source={{ uri: api.artifactContentUrl(artifact.id), headers: api.authorizationHeaders() }} style={styles.artifactImage} resizeMode="contain" onLoad={(event) => {
          const { width, height } = event.nativeEvent.source
          if (width > 0 && height > 0) setImageAspectRatio(width / height)
        }} />}
    </View>
  )
}

function VisualizationPreviewModal({ artifact, onClose }: { artifact: RemoteArtifact | null; onClose: () => void }) {
  const { api, t } = useContext(AppContext)
  const { height: windowHeight } = useWindowDimensions()
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    if (artifact && api && isHtmlArtifact(artifact)) {
      setContent(null)
      void api.artifactText(artifact.id).then(value => { if (!disposed) setContent(value) }).catch(() => undefined)
    }
    return () => { disposed = true }
  }, [api, artifact])
  if (!artifact || !isHtmlArtifact(artifact)) return null
  return <AppModal visible title={artifact.title || t('interactiveVisualization')} onClose={onClose}>
    <View style={[styles.visualizationModalContent, { height: Math.max(280, Math.floor(windowHeight * .68)) }]}>
      {content ? <WebView source={{ html: safeVisualizationHtml(content) }} originWhitelist={['about:blank', 'https://*']} javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false} scrollEnabled nestedScrollEnabled bounces showsHorizontalScrollIndicator showsVerticalScrollIndicator injectedJavaScript={visualizationScrollScript} onShouldStartLoadWithRequest={(request) => isAllowedVisualizationRequest(request.url)} style={styles.visualizationModalWebView} /> : <ActivityIndicator color={colors.accent} />}
    </View>
  </AppModal>
}

function TypingDots({ accessibilityLabel }: { accessibilityLabel: string }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current

  useEffect(() => {
    const animations = values.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 180),
      Animated.timing(value, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 360, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay((2 - index) * 180 + 300),
    ])))
    animations.forEach(animation => animation.start())
    return () => animations.forEach(animation => animation.stop())
  }, [values])

  return (
    <View style={styles.typingDots} accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [.4, 1] }),
              transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            },
          ]}
        />
      ))}
    </View>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} o`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`
}

function SelectorRow({ name, description, selected, onPress }: { name: string; description?: string | null; selected: boolean; onPress: () => void }) {
  return <Pressable style={styles.selectorRow} onPress={onPress}><View style={{ flex: 1 }}><Text style={styles.selectorName}>{name}</Text>{description ? <Text style={styles.selectorDesc} numberOfLines={2}>{description}</Text> : null}</View><Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.accent : colors.textMuted} /></Pressable>
}

const styles = StyleSheet.create({
  messages: { flex: 1 }, messagesContent: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 12, paddingVertical: 18 }, messageRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, userMessageRow: { justifyContent: 'flex-end' }, streamingMessage: { marginTop: 9 }, avatar: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, avatarImage: { width: 29, height: 29 },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10 }, userBubble: { backgroundColor: '#386FDA', borderBottomRightRadius: 6 }, assistantBubble: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 6 }, messageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 5 }, author: { color: colors.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .5 }, userAuthor: { color: '#E0EAFF' }, time: { color: colors.textMuted, fontSize: 9, opacity: .8 }, userTime: { color: '#E0EAFF' }, markdown: { width: '100%', overflow: 'hidden' },
  markdownCodeScroll: { width: '100%', maxWidth: '100%', marginVertical: 7 }, markdownCodeScrollContent: { minWidth: '100%' },
  markdownTableScroll: { width: '100%', maxWidth: '100%', marginVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, overflow: 'hidden' }, markdownTableScrollContent: { flexGrow: 1 }, markdownTable: { flexGrow: 1 }, markdownTableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, markdownTableHeaderRow: { backgroundColor: colors.surfaceRaised }, markdownTableCell: { minHeight: 42, justifyContent: 'flex-start', paddingHorizontal: 10, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }, markdownTableLastCell: { borderRightWidth: 0 },
  messageAttachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }, messageAttachment: { maxWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surfaceRaised }, messageAttachmentText: { maxWidth: 165, color: colors.textMuted, fontSize: 10 }, userAttachmentText: { color: colors.white }, older: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 15 }, olderText: { color: colors.textMuted, fontSize: 11 },
  messageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 7, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, userMessageActions: { borderTopColor: '#8FB0FF' }, messageAction: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4 }, messageActionText: { color: colors.textMuted, fontSize: 9, fontWeight: '700' }, userMessageActionText: { color: colors.white },
  artifacts: { gap: 8, marginTop: 8 }, artifactsTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .5 }, artifactCard: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.background }, artifactPreview: { width: '100%', height: 260, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border }, artifactImage: { width: '100%', height: '100%' }, artifactWebView: { width: '100%', height: '100%', backgroundColor: colors.white }, visualizationModalContent: { overflow: 'hidden', borderRadius: 12, backgroundColor: colors.white }, visualizationModalWebView: { flex: 1, backgroundColor: colors.white }, artifactInfo: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingTop: 10 }, artifactIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, artifactTextGroup: { flex: 1, minWidth: 0 }, artifactName: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }, artifactMeta: { color: colors.textMuted, fontSize: 9, marginTop: 2 }, artifactAction: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, margin: 9, borderRadius: 10, backgroundColor: colors.surfaceRaised }, artifactActionText: { flexShrink: 1, color: colors.accent, fontSize: 11, fontWeight: '800' },
  fileChanges: { gap: 6, marginTop: 9, padding: 9, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }, fileChangesTitle: { color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .5 }, fileChange: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.surfaceRaised }, fileChangePath: { flex: 1, minWidth: 0, color: colors.text, fontSize: 11, fontWeight: '700' }, fileChangeStatus: { flexShrink: 0, fontSize: 10, fontWeight: '900' },
  typingDots: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 12, marginVertical: 8, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, typingDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.textMuted }, toolRule: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 7 },
  approvalCard: { borderTopWidth: 1, borderTopColor: '#5C471A', backgroundColor: '#211B0F', padding: 12, gap: 9 }, approvalHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 }, approvalTitle: { color: colors.text, fontSize: 12, fontWeight: '900' }, approvalRisk: { color: colors.warning, fontSize: 9, marginTop: 2 }, approvalDescription: { color: colors.text, fontSize: 12, lineHeight: 17 }, approvalCommand: { color: colors.textMuted, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 9, lineHeight: 13, padding: 8, borderRadius: 8, backgroundColor: colors.background }, approvalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, approvalButton: { minHeight: 35, minWidth: '46%', flexGrow: 1, flexShrink: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, borderRadius: 9, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border }, denyButton: { borderColor: '#713343', backgroundColor: '#321824' }, allowButton: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, denyText: { color: colors.danger, fontSize: 10, fontWeight: '900', textAlign: 'center' }, allowText: { color: colors.accent, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  composer: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 10 : 9 }, attachmentScroller: { height: 38, flexGrow: 0, flexShrink: 0 }, attachments: { height: 38, alignItems: 'flex-start', gap: 7, paddingBottom: 8 }, attachment: { maxWidth: 210, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.surfaceRaised }, attachmentName: { maxWidth: 145, color: colors.text, fontSize: 11 },
  queuePanel: { maxHeight: 125, gap: 4, marginBottom: 8, padding: 8, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }, queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 }, queueTitle: { flex: 1, color: colors.text, fontSize: 10, fontWeight: '900' }, queueClear: { color: colors.accent, fontSize: 9, fontWeight: '800' }, queueItem: { minHeight: 25, flexDirection: 'row', alignItems: 'center', gap: 5 }, queuePrompt: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 10 },
  taskActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 7 }, taskAction: { minHeight: 34, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border }, taskActionText: { flexShrink: 1, color: colors.accent, fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center' }, composerBanner: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7, paddingHorizontal: 9, borderRadius: 9, backgroundColor: colors.accentSoft }, composerBannerText: { flex: 1, color: colors.accent, fontSize: 10, fontWeight: '800' },
  promptRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, plus: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }, plusBadge: { position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }, plusBadgeText: { color: colors.white, fontSize: 9, fontWeight: '900' }, prompt: { flex: 1, minWidth: 0, minHeight: 40, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 13, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 9, fontSize: 14 }, send: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }, inlineStop: { backgroundColor: colors.danger }, sendDisabled: { opacity: .42 },
  composerMetaRow: { minHeight: 31, flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6 }, modeChip: { minHeight: 27, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }, modeChipText: { color: colors.text, fontSize: 10, fontWeight: '800' }, selectedResourcesText: { flex: 1, color: colors.textMuted, fontSize: 9, textAlign: 'right' },
  actionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border }, actionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, actionText: { flex: 1, color: colors.text, fontWeight: '700' },
  selectorRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9 }, selectorName: { color: colors.text, fontSize: 14, fontWeight: '700' }, selectorDesc: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 }, sectionTitle: { color: colors.textMuted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: .8, marginTop: 12, marginBottom: 3 },
  catalogSearch: { minHeight: 42, marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised }, catalogSearchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 8 }, emptySection: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingVertical: 8 },
})
