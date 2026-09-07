import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import React, { useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AppContext, AppProvider } from './src/context/AppContext'
import { colors, commonStyles } from './src/theme'
import type { BobTask, Conversation } from './src/types'
import { ChatScreen } from './src/screens/ChatScreen'
import { ConnectionScreen } from './src/screens/ConnectionScreen'
import { ConversationsScreen } from './src/screens/ConversationsScreen'
import { ProjectsScreen } from './src/screens/ProjectsScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { ActivityScreen } from './src/screens/ActivityScreen'
import { FilesScreen } from './src/screens/FilesScreen'
import { ProjectScreen } from './src/screens/ProjectScreen'
import { TaskDetailScreen } from './src/screens/TaskDetailScreen'
import { ExtensionsScreen } from './src/screens/ExtensionsScreen'

type Tab = 'conversations' | 'projects' | 'activity' | 'files' | 'settings'
const DEV_SCREEN = __DEV__ ? process.env.EXPO_PUBLIC_BOB_MOBILE_DEV_SCREEN : undefined

function AppContent() {
  const { api, ready, connection, history, historyError, notificationConversationId, unreadConversationIds, clearNotificationTarget, markConversationRead, t } = useContext(AppContext)
  const [tab, setTab] = useState<Tab>(DEV_SCREEN === 'projects' || DEV_SCREEN === 'activity' || DEV_SCREEN === 'files' || DEV_SCREEN === 'settings' ? DEV_SCREEN : 'conversations')
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<BobTask | null>(null)
  const [projectFilter, setProjectFilter] = useState<string | undefined>()
  const [extensionsOpen, setExtensionsOpen] = useState(DEV_SCREEN === 'extensions')

  useEffect(() => {
    if (DEV_SCREEN !== 'chat' || !api || activeConversation) return
    void api.conversations().then(items => setActiveConversation(items[0]?.conversation ?? null))
  }, [activeConversation, api])

  useEffect(() => {
    if (!notificationConversationId || !history) return
    const conversation = history.conversations.find(item => item.conversation.id === notificationConversationId)?.conversation
    if (conversation) {
      markConversationRead(conversation.id)
      setActiveConversation(conversation)
    }
    clearNotificationTarget()
  }, [clearNotificationTarget, history, markConversationRead, notificationConversationId])

  useEffect(() => {
    if (!historyError) return
    // Do not keep an open conversation/project/task from an obsolete tunnel
    // after Bob Work becomes unreachable.
    setActiveConversation(null)
    setActiveProjectId(null)
    setActiveTask(null)
  }, [historyError])

  if (!ready) return <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View>
  if (!connection) return <ConnectionScreen />
  const syncedConversation = activeConversation
    ? history?.conversations.find(item => item.conversation.id === activeConversation.id)?.conversation ?? activeConversation
    : null
  if (syncedConversation) return <ChatScreen conversation={syncedConversation} onBack={() => setActiveConversation(null)} />

  if (extensionsOpen) return <ExtensionsScreen onBack={() => setExtensionsOpen(false)} />

  if (activeTask) return <TaskDetailScreen task={history?.tasks.find(item => item.id === activeTask.id) ?? activeTask} onBack={() => setActiveTask(null)} onOpenConversation={conversation => { setActiveTask(null); setActiveConversation(conversation) }} />

  const activeProject = activeProjectId ? history?.projects.find(p => p.id === activeProjectId) : null
  if (activeProject) return <ProjectScreen project={activeProject} onBack={() => setActiveProjectId(null)} onOpenConversation={(conversation) => {
    setActiveProjectId(null)
    setProjectFilter(activeProjectId!)
    setTab('conversations')
    setActiveConversation(conversation)
  }} />

  const activeTaskCount = history?.tasks.filter(task => ['starting', 'running', 'queued', 'awaiting_info', 'awaiting_approval', 'paused'].includes(task.state)).length ?? 0
  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; count?: number }> = [
    { id: 'conversations', label: t('conversations'), icon: 'chatbubbles-outline', count: unreadConversationIds.length },
    { id: 'projects', label: t('projects'), icon: 'folder-open-outline' },
    { id: 'activity', label: t('activity'), icon: 'pulse-outline', count: activeTaskCount },
    { id: 'files', label: t('files'), icon: 'documents-outline' },
    { id: 'settings', label: t('settings'), icon: 'settings-outline' },
  ]

  return (
    <View style={styles.shell}>
      <View style={styles.body}>
        {tab === 'conversations' && <ConversationsScreen projectFilter={projectFilter} onClearFilter={() => setProjectFilter(undefined)} onOpen={setActiveConversation} />}
        {tab === 'projects' && <ProjectsScreen onOpen={setActiveProjectId} />}
        {tab === 'activity' && <ActivityScreen onOpenTask={setActiveTask} />}
        {tab === 'files' && <FilesScreen />}
        {tab === 'settings' && <SettingsScreen onOpenExtensions={() => setExtensionsOpen(true)} />}
      </View>
      <View style={styles.tabs}>
        {tabs.map(item => {
          const active = tab === item.id
          return <Pressable key={item.id} style={styles.tab} onPress={() => setTab(item.id)}><View><Ionicons name={item.icon} size={22} color={active ? colors.accent : colors.textMuted} />{item.count ? <View style={styles.badge}><Text style={styles.badgeText}>{item.count > 99 ? '99+' : item.count}</Text></View> : null}</View><Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8}>{item.label}</Text></Pressable>
        })}
      </View>
    </View>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <AppProvider><AppContent /></AppProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, shell: { flex: 1, backgroundColor: colors.background }, body: { flex: 1 },
  tabs: { minHeight: 62, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 2 }, tabText: { maxWidth: '100%', color: colors.textMuted, fontSize: 9, fontWeight: '700', textAlign: 'center' }, tabTextActive: { color: colors.accent },
  badge: { position: 'absolute', right: -13, top: -7, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface }, badgeText: { color: colors.white, fontSize: 8, fontWeight: '900' },
})
