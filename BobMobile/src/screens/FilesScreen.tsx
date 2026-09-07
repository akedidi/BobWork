import { Ionicons } from '@expo/vector-icons'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'
import { WebView } from 'react-native-webview'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { AppContext } from '../context/AppContext'
import { colors, commonStyles } from '../theme'
import type { RemoteArtifact } from '../types'
import { isAllowedVisualizationRequest, safeVisualizationHtml, visualizationScrollScript } from '../visualizationHtml'

type Category = 'all' | 'pdf' | 'images' | 'word' | 'excel' | 'powerpoint' | 'text' | 'other'
const DEV_AUTO_PREVIEW = __DEV__ ? process.env.EXPO_PUBLIC_BOB_MOBILE_DEV_PREVIEW : undefined

export function FilesScreen() {
  const { api, liveEvents, t } = useContext(AppContext)
  const [artifacts, setArtifacts] = useState<RemoteArtifact[]>([])
  const [total, setTotal] = useState(0)
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<RemoteArtifact | null>(null)
  const requestSequence = useRef(0)
  const lastArtifactEvent = liveEvents.find(event => event.type === 'artifacts-updated')?.sentAt

  const load = useCallback(async () => {
    if (!api) return
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const collected: RemoteArtifact[] = []
      let cursor: string | undefined
      let catalogTotal = 0
      do {
        const page = await api.artifacts({
          q: search.trim() || undefined,
          category,
          cursor,
          limit: 200,
        })
        if (sequence !== requestSequence.current) return
        catalogTotal = page.total
        for (const item of page.artifacts) {
          if (!collected.some(existing => existing.id === item.id)) collected.push(item)
        }
        cursor = page.hasMore ? page.nextCursor ?? undefined : undefined
      } while (cursor)
      setArtifacts(uniqueLatestArtifacts(collected))
      setTotal(catalogTotal)
    } catch {
      setArtifacts([])
      setTotal(0)
      Alert.alert(t('error'), t('filesLoadFailed'))
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [api, category, search, t])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 280)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (lastArtifactEvent) void load()
  }, [lastArtifactEvent, load])

  useEffect(() => {
    if (!DEV_AUTO_PREVIEW || selected || !artifacts[0]) return
    setSelected(DEV_AUTO_PREVIEW === 'pdf' ? artifacts.find(item => item.category === 'pdf') ?? artifacts[0] : artifacts[0])
  }, [artifacts, selected])

  const refresh = () => { setRefreshing(true); void load() }
  const remove = (artifact: RemoteArtifact) => Alert.alert(
    t('deleteFile'),
    t('deleteFileConfirm', { name: artifact.title }),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => void api?.deleteArtifact(artifact.id).then(() => {
        setSelected(null)
        setArtifacts(current => current.filter(item => item.id !== artifact.id))
      }).catch(() => Alert.alert(t('error'), t('fileDeleteFailed'))) },
    ],
  )
  const categories = useMemo<Array<{ id: Category; label: string }>>(() => [
    { id: 'all', label: t('allFiles') }, { id: 'pdf', label: 'PDF' }, { id: 'images', label: t('images') },
    { id: 'word', label: 'Word' }, { id: 'excel', label: 'Excel' }, { id: 'powerpoint', label: 'PowerPoint' },
    { id: 'text', label: t('textFiles') }, { id: 'other', label: t('otherFiles') },
  ], [t])

  return (
    <View style={commonStyles.screen}>
      <ConnectionStatusBar />
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} style={styles.searchInput} placeholder={t('searchFiles')} placeholderTextColor={colors.textMuted} returnKeyType="search" />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={10}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
      </View>
      {total > 0 && !loading ? <Text style={styles.count}>{t('filesCount', { count: artifacts.length })}</Text> : null}
      <ScrollView horizontal style={styles.filterScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {categories.map(item => <Pressable key={item.id} style={[styles.filter, category === item.id && styles.filterActive]} onPress={() => setCategory(item.id)}><Text style={[styles.filterText, category === item.id && styles.filterTextActive]} numberOfLines={1}>{item.label}</Text></Pressable>)}
      </ScrollView>
      {loading && !refreshing ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : (
        <FlatList
          style={styles.artifactList}
          data={artifacts}
          numColumns={2}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.grid, artifacts.length === 0 && styles.emptyGrid]}
          columnWrapperStyle={artifacts.length ? styles.columns : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
          renderItem={({ item }) => <ArtifactCard artifact={item} onOpen={() => setSelected(item)} />}
          ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name="documents-outline" size={50} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t('noFiles')}</Text><Text style={commonStyles.emptyText}>{t('noFilesDesc')}</Text></View>}
        />
      )}
      <ArtifactPreview artifact={selected} onClose={() => setSelected(null)} onDelete={remove} />
    </View>
  )
}

function uniqueLatestArtifacts(items: RemoteArtifact[]): RemoteArtifact[] {
  const latest = new Map<string, RemoteArtifact>()
  for (const item of items) {
    const key = `${item.project?.id ?? ''}:${item.conversation?.id ?? ''}:${item.category ?? item.type}:${item.title.trim().toLowerCase()}`
    const current = latest.get(key)
    const itemStamp = `${String(item.version ?? 0).padStart(6, '0')}:${item.createdAt ?? ''}`
    const currentStamp = current ? `${String(current.version ?? 0).padStart(6, '0')}:${current.createdAt ?? ''}` : ''
    if (!current || itemStamp > currentStamp) latest.set(key, item)
  }
  const keep = new Set([...latest.values()].map(item => item.id))
  return items.filter(item => keep.has(item.id))
}

function ArtifactCard({ artifact, onOpen }: { artifact: RemoteArtifact; onOpen: () => void }) {
  const { t } = useContext(AppContext)
  const status = artifact.validationStatus ?? 'pending'
  return <Pressable style={styles.card} onPress={onOpen}>
    <View style={styles.cardHeader}>
      <View style={[styles.iconBadge, { backgroundColor: `${categoryColor(artifact.category)}22` }]}>
        <Ionicons name={artifactIcon(artifact)} size={18} color={categoryColor(artifact.category)} />
      </View>
      <Text style={[styles.validation, { color: statusColor(status) }]} numberOfLines={1}>{statusLabel(status, t)}</Text>
    </View>
    <Text style={styles.cardTitle} numberOfLines={2}>{artifact.title}</Text>
    <Text style={styles.cardMeta} numberOfLines={1}>{artifact.type.toUpperCase()}{artifact.size ? ` · ${formatBytes(artifact.size)}` : ''} · v{artifact.version ?? 1}</Text>
  </Pressable>
}

export function ArtifactPreview({ artifact, onClose, onDelete }: { artifact: RemoteArtifact | null; onClose: () => void; onDelete: (artifact: RemoteArtifact) => void }) {
  const { api, t } = useContext(AppContext)
  const insets = useSafeAreaInsets()
  const [current, setCurrent] = useState<RemoteArtifact | null>(artifact)
  const [busy, setBusy] = useState(false)
  useEffect(() => setCurrent(artifact), [artifact])
  if (!current || !api) return null

  const download = async () => {
    if (busy) return
    setBusy(true)
    try {
      const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory
      if (!root) throw new Error('storage-unavailable')
      const directory = `${root}bob-artifacts/`
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
      const safeName = current.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_') || `artifact-${current.id}`
      const result = await FileSystem.downloadAsync(api.artifactContentUrl(current.id, true), `${directory}${current.id}-${safeName}`, { headers: api.authorizationHeaders() })
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri, { mimeType: current.mimeType, dialogTitle: current.title })
      else Alert.alert(current.title, t('downloadComplete'))
    } catch { Alert.alert(t('error'), t('artifactFailed')) } finally { setBusy(false) }
  }
  const selectVersion = async (id: string) => {
    if (id === current.id) return
    try { setCurrent(await api.artifact(id)) } catch { Alert.alert(t('error'), t('artifactFailed')) }
  }

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={[styles.previewScreen, { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.previewHeader}>
        <Pressable style={styles.roundButton} onPress={onClose}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
        <Text style={styles.previewTitle} numberOfLines={2}>{current.title}</Text>
        <Pressable style={styles.roundButton} onPress={() => onDelete(current)}><Ionicons name="trash-outline" size={20} color={colors.danger} /></Pressable>
      </View>
      <View style={styles.previewBody}><PreviewContent artifact={current} /></View>
      <View style={styles.previewInfo}>
        <Text style={styles.previewMeta}>{current.fileName}{current.size ? ` · ${formatBytes(current.size)}` : ''}</Text>
        {current.project?.name ? <Text style={styles.previewOrigin}>{t('originProject')}: {current.project.name}</Text> : null}
        {current.conversation?.title ? <Text style={styles.previewOrigin}>{t('originConversation')}: {current.conversation.title}</Text> : null}
        <View style={styles.statusRow}><View style={[styles.statusBadge, { borderColor: statusColor(current.validationStatus) }]}><Text style={{ color: statusColor(current.validationStatus), fontSize: 11, fontWeight: '800' }}>{statusLabel(current.validationStatus, t)}</Text></View><Text style={styles.version}>v{current.version ?? 1}</Text></View>
        {current.validationNotes ? <Text style={styles.validationNotes}>{current.validationNotes}</Text> : null}
        {(current.versions?.length ?? 0) > 1 ? <ScrollView horizontal style={styles.versionScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.versions}>{current.versions?.map(version => <Pressable key={version.id} style={[styles.versionChip, current.id === version.id && styles.versionChipActive]} onPress={() => void selectVersion(version.id)}><Text style={[styles.versionChipText, current.id === version.id && styles.versionChipTextActive]}>v{version.version}</Text></Pressable>)}</ScrollView> : null}
        <Pressable style={commonStyles.primaryButton} onPress={() => void download()} disabled={busy}>{busy ? <ActivityIndicator color={colors.white} /> : <View style={styles.downloadContent}><Ionicons name="share-outline" size={19} color={colors.white} /><Text style={commonStyles.primaryButtonText}>{t('saveOrShare')}</Text></View>}</Pressable>
      </View>
    </View>
  </Modal>
}

function PreviewContent({ artifact }: { artifact: RemoteArtifact }) {
  const { api, t } = useContext(AppContext)
  const [text, setText] = useState<string | null>(null)
  const isSvg = artifact.mimeType === 'image/svg+xml'
  const isHtml = artifact.mimeType === 'text/html' || /\.html?$/i.test(artifact.fileName)
  const isText = artifact.mimeType.startsWith('text/') || artifact.mimeType === 'application/json'
  useEffect(() => {
    let disposed = false
    setText(null)
    if (api && (isSvg || isHtml || isText)) void api.artifactText(artifact.id).then(value => { if (!disposed) setText(value) }).catch(() => undefined)
    return () => { disposed = true }
  }, [api, artifact.id, isSvg, isHtml, isText])
  if (!api) return null
  if (isSvg) return text ? <SvgXml xml={text} width="100%" height="100%" /> : <ActivityIndicator color={colors.accent} />
  if (isHtml) return text ? <WebView source={{ html: safeVisualizationHtml(text) }} originWhitelist={['about:blank', 'https://*']} javaScriptEnabled domStorageEnabled={false} setSupportMultipleWindows={false} scrollEnabled nestedScrollEnabled bounces showsHorizontalScrollIndicator showsVerticalScrollIndicator injectedJavaScript={visualizationScrollScript} onShouldStartLoadWithRequest={request => isAllowedVisualizationRequest(request.url)} style={styles.webView} /> : <ActivityIndicator color={colors.accent} />
  if (artifact.mimeType.startsWith('image/')) return <Image source={{ uri: api.artifactContentUrl(artifact.id), headers: api.authorizationHeaders() }} style={styles.fullImage} resizeMode="contain" />
  if (artifact.mimeType === 'application/pdf' || ['word', 'excel', 'powerpoint'].includes(artifact.category ?? '')) return <WebView source={{ uri: api.artifactContentUrl(artifact.id), headers: api.authorizationHeaders() }} style={styles.webView} />
  if (isText) return <ScrollView style={styles.textPreview} contentContainerStyle={styles.textPreviewContent}><Text selectable style={styles.textPreviewValue}>{text ?? t('loading')}</Text></ScrollView>
  return <View style={commonStyles.empty}><Ionicons name={artifactIcon(artifact)} size={64} color={categoryColor(artifact.category)} /><Text style={commonStyles.emptyTitle}>{artifact.type.toUpperCase()}</Text><Text style={commonStyles.emptyText}>{t('systemPreviewHint')}</Text></View>
}

function artifactIcon(artifact: RemoteArtifact): React.ComponentProps<typeof Ionicons>['name'] {
  if (artifact.mimeType === 'text/html' || /\.html?$/i.test(artifact.fileName)) return 'color-palette-outline'
  if (artifact.category === 'images') return 'image-outline'
  if (artifact.category === 'powerpoint') return 'easel-outline'
  if (artifact.category === 'excel') return 'grid-outline'
  if (artifact.category === 'pdf' || artifact.category === 'word' || artifact.category === 'text') return 'document-text-outline'
  return 'document-attach-outline'
}
function categoryColor(category?: string) { return category === 'excel' ? colors.success : category === 'powerpoint' ? colors.warning : category === 'pdf' ? colors.danger : colors.accent }
function statusColor(status?: string) { return status === 'invalid' ? colors.danger : status === 'warning' || status === 'pending' ? colors.warning : colors.success }
function statusLabel(status: string | undefined, t: (key: any) => string) { return t(status === 'invalid' ? 'invalid' : status === 'warning' ? 'warning' : status === 'pending' ? 'pending' : 'valid') }
function formatBytes(size: number) { if (size < 1024) return `${size} o`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`; return `${(size / (1024 * 1024)).toFixed(1)} Mo` }

const styles = StyleSheet.create({
  searchRow: { height: 44, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, color: colors.text, fontSize: 14 },
  count: { marginHorizontal: 18, marginTop: 8, color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  filterScroller: { height: 44, flexGrow: 0, flexShrink: 0 }, filters: { height: 44, alignItems: 'center', paddingHorizontal: 16, gap: 7 }, filter: { height: 28, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, filterActive: { backgroundColor: colors.accent, borderColor: colors.accent }, filterText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' }, filterTextActive: { color: colors.white },
  artifactList: { flex: 1 }, grid: { paddingHorizontal: 10, paddingBottom: 90, paddingTop: 4 }, emptyGrid: { flexGrow: 1 }, columns: { gap: 8 }, card: { flex: 1, minWidth: 0, margin: 3, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, iconBadge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, cardTitle: { marginTop: 6, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '800' }, cardMeta: { marginTop: 3, color: colors.textMuted, fontSize: 9 }, version: { color: colors.textMuted, fontSize: 9, fontWeight: '800' }, validation: { flexShrink: 1, fontSize: 9, fontWeight: '800' },
  previewScreen: { flex: 1, backgroundColor: colors.background }, previewHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border }, roundButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }, previewTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '800', textAlign: 'center' }, previewBody: { flex: 1, margin: 12, overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white }, fullImage: { width: '100%', height: '100%' }, webView: { flex: 1 }, textPreview: { flex: 1, backgroundColor: colors.background }, textPreviewContent: { padding: 18 }, textPreviewValue: { color: colors.text, fontSize: 13, lineHeight: 20, fontFamily: 'Menlo' }, previewInfo: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 }, previewMeta: { color: colors.textMuted, fontSize: 11 }, previewOrigin: { color: colors.text, fontSize: 12 }, statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, borderWidth: 1 }, validationNotes: { color: colors.warning, fontSize: 11, lineHeight: 16 }, versionScroller: { height: 36, flexGrow: 0, flexShrink: 0 }, versions: { height: 36, alignItems: 'center', gap: 7 }, versionChip: { minWidth: 40, height: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, versionChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent }, versionChipText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' }, versionChipTextActive: { color: colors.text }, downloadContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
})
