import { Ionicons } from '@expo/vector-icons'
import React, { useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TopBar } from '../components/TopBar'
import { ProjectEditorModal } from '../components/ProjectEditorModal'
import { AppContext } from '../context/AppContext'
import { modeLabel, taskStateLabel } from '../labels'
import { ArtifactPreview } from './FilesScreen'
import { colors, commonStyles } from '../theme'
import type { Catalog, Conversation, ModeOption, Project, ProjectMutationInput, RemoteArtifact } from '../types'

interface Props {
  project: Project
  onBack: () => void
  onOpenConversation: (conversation: Conversation) => void
}

export function ProjectScreen({ project, onBack, onOpenConversation }: Props) {
  const { api, history, refreshHistory, t } = useContext(AppContext)
  const [catalog, setCatalog] = useState<Catalog>({ plugins: [], skills: [], integrations: [], mcpServers: [], dbConnections: [] })
  const [modes, setModes] = useState<ModeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [editorVisible, setEditorVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<RemoteArtifact | null>(null)

  const conversations = history?.conversations.filter(c => c.conversation.projectId === project.id) ?? []
  const tasks = history?.tasks.filter(t => t.projectId === project.id) ?? []
  const [artifacts, setArtifacts] = useState<RemoteArtifact[]>([])

  useEffect(() => {
    if (!api) return
    void Promise.all([
      api.catalog(),
      api.modes(),
      api.artifacts({ projectId: project.id, limit: 5 })
    ]).then(([nextCatalog, nextModes, artifactsPage]) => {
      setCatalog({ plugins: nextCatalog.plugins.filter(item => item.enabled), skills: nextCatalog.skills.filter(item => item.enabled), integrations: nextCatalog.integrations, mcpServers: nextCatalog.mcpServers, dbConnections: nextCatalog.dbConnections })
      setModes(nextModes)
      setArtifacts(artifactsPage.artifacts)
    }).catch(console.error)
  }, [api, project.id])

  const update = async (input: ProjectMutationInput) => {
    if (!api) return
    setSaving(true)
    try {
      await api.updateProject(project.id, input)
      setEditorVisible(false)
      await refreshHistory()
    } catch {
      Alert.alert(t('error'), t('projectUpdateFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = () => {
    Alert.alert(t('deleteProject'), t('deleteProjectConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => {
        if (!api) return
        setLoading(true)
        try {
          await api.deleteProject(project.id)
          await refreshHistory()
          onBack()
        } catch {
          Alert.alert(t('error'), t('projectDeleteFailed'))
        } finally {
          setLoading(false)
        }
      }}
    ])
  }

  const startConversation = async () => {
    if (!api) return
    setLoading(true)
    try {
      const res = await api.createConversation({ title: t('newConversation'), projectId: project.id })
      await refreshHistory()
      onOpenConversation(res)
    } catch {
      Alert.alert(t('error'), t('conversationCreateFailed'))
    } finally {
      setLoading(false)
    }
  }

  return <View style={commonStyles.screen}>
    <TopBar title={project.name} onBack={onBack} action={
      <Pressable onPress={() => setEditorVisible(true)} hitSlop={10} accessibilityLabel={t('editProject')}>
        <Ionicons name="create-outline" size={24} color={colors.accent} />
      </Pressable>
    } />
    {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />}
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {project.description ? <Text style={styles.description}>{project.description}</Text> : null}
      
      <View style={styles.infoBox}>
        <Text style={styles.label}>{t('objective')}: <Text style={styles.value}>{project.objective || '—'}</Text></Text>
        <Text style={styles.label}>{t('customInstructions')}: <Text style={styles.value}>{project.customInstructions || '—'}</Text></Text>
        <Text style={styles.label}>{t('defaultMode')}: <Text style={styles.value}>{modeLabel(project.defaultMode, t)}</Text></Text>
        <Text style={styles.label}>{t('memory')}: <Text style={styles.value}>{project.memoryEnabled ? t('memoryOn') : t('memoryOff')}</Text></Text>
      </View>

      <Pressable style={[commonStyles.primaryButton, styles.startBtn]} onPress={startConversation} disabled={loading}>
        <Ionicons name="chatbubbles" size={20} color={colors.white} />
        <Text style={commonStyles.primaryButtonText}>{t('startProjectConversation')}</Text>
      </Pressable>

      <Pressable style={styles.deleteBtn} onPress={remove} disabled={loading}>
        <Text style={styles.deleteBtnText}>{t('deleteProject')}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>{t('conversations')}</Text>
      {conversations.length === 0 ? <Text style={styles.empty}>{t('noConversations')}</Text> : 
        conversations.slice(0, 5).map(c => (
          <Pressable key={c.conversation.id} style={styles.card} onPress={() => onOpenConversation(c.conversation)}>
            <Text style={styles.cardTitle}>{c.conversation.title}</Text>
            <Text style={styles.cardMeta}>{modeLabel(c.conversation.bobMode ?? project.defaultMode, t)}{c.taskState ? ` · ${taskStateLabel(c.taskState, t)}` : ''}</Text>
          </Pressable>
        ))
      }

      <Text style={styles.sectionTitle}>{t('recentTasks')}</Text>
      {tasks.length === 0 ? <Text style={styles.empty}>{t('noTasks')}</Text> : 
        tasks.slice(0, 5).map(task => (
          <View key={task.id} style={styles.card}>
            <Text style={styles.cardTitle}>{task.objective || task.summary || t('untitledTask')}</Text>
            <Text style={styles.cardMeta}>{taskStateLabel(task.state, t)} · {modeLabel(task.mode, t)}</Text>
          </View>
        ))
      }

      <Text style={styles.sectionTitle}>{t('projectFiles')}</Text>
      {artifacts.length === 0 ? <Text style={styles.empty}>{t('noFiles')}</Text> : 
        artifacts.map(f => (
          <Pressable key={f.id} style={styles.card} onPress={() => setSelectedArtifact(f)}>
            <Text style={styles.cardTitle}>{f.title}</Text>
            <Text style={styles.cardMeta}>{f.type.toUpperCase()}</Text>
          </Pressable>
        ))
      }

      <Text style={styles.sectionTitle}>{t('allowedResources')}</Text>
      <View style={styles.infoBox}>
        <PermissionLine label={t('plugins')} values={project.allowedPlugins.filter(value => !value.startsWith('skill:')).map(id => catalog.plugins.find(item => item.id === id)?.name ?? id)} fallback={t('allAllowed')} />
        <PermissionLine label={t('skills')} values={project.allowedPlugins.filter(value => value.startsWith('skill:')).map(value => value.slice(6)).map(slug => catalog.skills.find(item => item.slug === slug)?.name ?? slug)} fallback={t('allAllowed')} />
        <PermissionLine label={t('integrations')} values={project.allowedIntegrations.filter(id => !id.startsWith('mcp:')).map(id => catalog.integrations.find(item => item.id === id)?.name ?? id)} fallback={t(project.allowedIntegrations.length === 0 ? 'allAllowed' : 'noneSelected')} />
        <PermissionLine label={t('mcpAndApis')} values={project.allowedIntegrations.filter(id => id.startsWith('mcp:')).map(id => id.slice(4))} fallback={t(project.allowedIntegrations.length === 0 ? 'allAllowed' : 'noneSelected')} />
      </View>

    </ScrollView>
    <ProjectEditorModal 
      visible={editorVisible} 
      project={project} 
      catalog={catalog} 
      modes={modes} 
      busy={saving} 
      t={t} 
      onClose={() => setEditorVisible(false)} 
      onSubmit={update} 
    />
    <ArtifactPreview artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} onDelete={artifact => {
      void api?.deleteArtifact(artifact.id).then(() => {
        setArtifacts(current => current.filter(item => item.id !== artifact.id))
        setSelectedArtifact(null)
      }).catch(() => Alert.alert(t('error'), t('fileDeleteFailed')))
    }} />
  </View>
}

function PermissionLine({ label, values, fallback }: { label: string; values: string[]; fallback: string }) {
  return <View><Text style={styles.permissionLabel}>{label}</Text><Text style={styles.value}>{values.length ? values.join(' · ') : fallback}</Text></View>
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 60, gap: 16 },
  description: { color: colors.text, fontSize: 15, marginBottom: 8 },
  infoBox: { backgroundColor: colors.surfaceRaised, padding: 12, borderRadius: 12, gap: 4 },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: 'bold' },
  value: { color: colors.text, fontWeight: 'normal' },
  startBtn: { flexDirection: 'row', gap: 8, marginTop: 8 },
  deleteBtn: { padding: 12, alignItems: 'center' },
  deleteBtnText: { color: colors.danger, fontWeight: 'bold' },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginTop: 16 },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  card: { backgroundColor: colors.surface, padding: 12, borderRadius: 12, marginBottom: 8 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
  cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  permissionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '800', marginBottom: 3 },
})
