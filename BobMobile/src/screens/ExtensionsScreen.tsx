import { Ionicons } from '@expo/vector-icons'
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { AppModal } from '../components/AppModal'
import { ConnectionStatusBar } from '../components/ConnectionStatusBar'
import { PluginGlyph } from '../components/SelectedPluginChips'
import { AppContext } from '../context/AppContext'
import { colors, commonStyles } from '../theme'
import type { Catalog, CatalogIntegration, CatalogPlugin, CatalogSkill } from '../types'
import { formatDateTime } from '../i18n'

type Section = 'plugins' | 'skills' | 'integrations'
type Filter = 'all' | 'builtin' | 'personal' | 'favorites' | 'recent'
type Selected = { kind: 'plugin'; item: CatalogPlugin } | { kind: 'skill'; item: CatalogSkill } | { kind: 'integration'; item: CatalogIntegration }

export function ExtensionsScreen({ onBack }: { onBack: () => void }) {
  const { api, liveEvents, t } = useContext(AppContext)
  const [catalog, setCatalog] = useState<Catalog>({ plugins: [], skills: [], integrations: [], mcpServers: [], dbConnections: [] })
  const [section, setSection] = useState<Section>('plugins')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const catalogRevision = liveEvents.find(event => event.type === 'catalog-updated')?.sentAt

  const load = useCallback(async () => {
    if (!api) return
    setLoading(true)
    try {
      setCatalog(await api.catalog())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 4_000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => { if (catalogRevision) void load() }, [catalogRevision, load])
  useEffect(() => { if (section !== 'plugins' && filter === 'recent') setFilter('all') }, [filter, section])

  const matches = (name: string, description?: string | null) => !query.trim() || `${name} ${description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const plugins = useMemo(() => catalog.plugins.filter(item => matches(item.name, item.description) && matchesFilter(item, filter)), [catalog.plugins, filter, query])
  const skills = useMemo(() => catalog.skills.filter(item => matches(item.name, item.description) && matchesFilter(item, filter)), [catalog.skills, filter, query])
  const integrations = useMemo(() => catalog.integrations.filter(item => matches(item.name) && (filter === 'all' || filter === 'builtin' || (filter === 'favorites' && item.favorite))), [catalog.integrations, filter, query])

  const mutate = async (id: string, action: () => Promise<unknown>, failureKey: 'pluginActivationFailed' | 'skillActivationFailed' | 'extensionUpdateFailed') => {
    setBusyId(id)
    try {
      await action()
      await load()
      setSelected(null)
    } catch {
      Alert.alert(t('error'), t(failureKey))
    } finally {
      setBusyId(null)
    }
  }

  const togglePlugin = (item: CatalogPlugin, enabled: boolean) => void mutate(item.id, () => api!.updatePlugin(item.id, { enabled }), 'pluginActivationFailed')
  const toggleSkill = (item: CatalogSkill, enabled: boolean) => void mutate(item.slug, () => api!.updateSkill(item.slug, { enabled, scope: item.scope }), 'skillActivationFailed')
  const favorite = (kind: Selected['kind'], id: string, value: boolean, scope?: string) => void mutate(id, () => kind === 'plugin' ? api!.updatePlugin(id, { favorite: value }) : kind === 'skill' ? api!.updateSkill(id, { favorite: value, scope }) : api!.updateIntegration(id, { favorite: value }), kind === 'skill' ? 'skillActivationFailed' : 'pluginActivationFailed')

  const sections: Array<{ id: Section; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = [
    { id: 'plugins', label: t('plugins'), icon: 'extension-puzzle-outline' },
    { id: 'skills', label: t('skills'), icon: 'sparkles-outline' },
    { id: 'integrations', label: t('integrations'), icon: 'git-network-outline' },
  ]
  const filters: Filter[] = section === 'plugins' ? ['all', 'builtin', 'personal', 'favorites', 'recent'] : section === 'skills' ? ['all', 'builtin', 'personal', 'favorites'] : ['all', 'favorites']
  const filterLabel = (value: Filter) => ({ all: t('all'), builtin: t('integrated'), personal: t('personal'), favorites: t('favorites'), recent: t('recentlyUsed') })[value]

  return (
    <View style={commonStyles.screen}>
      <ConnectionStatusBar action={<Pressable onPress={onBack} hitSlop={10} accessibilityLabel={t('back')}><Ionicons name="close" size={24} color={colors.text} /></Pressable>} />
      <View style={styles.sectionTabs}>{sections.map(item => <Pressable key={item.id} onPress={() => { setSection(item.id); setFilter('all') }} style={[styles.sectionTab, section === item.id && styles.sectionTabActive]}><Ionicons name={item.icon} size={18} color={section === item.id ? colors.accent : colors.textMuted} /><Text style={[styles.sectionTabText, section === item.id && styles.sectionTabTextActive]} numberOfLines={1}>{item.label}</Text></Pressable>)}</View>
      <View style={styles.searchWrap}><Ionicons name="search" size={19} color={colors.textMuted} /><TextInput value={query} onChangeText={setQuery} placeholder={t('searchCatalog')} placeholderTextColor={colors.textMuted} style={styles.search} accessibilityLabel={t('searchCatalog')} /><Pressable onPress={() => void load()} hitSlop={8} accessibilityLabel={t('refresh')}><Ionicons name="refresh" size={20} color={colors.textMuted} /></Pressable></View>
      <ScrollView horizontal style={styles.filterScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(item => <Pressable key={item} style={[styles.filter, filter === item && styles.filterActive]} onPress={() => setFilter(item)}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{filterLabel(item)}</Text></Pressable>)}</ScrollView>
      {error ? <Pressable style={styles.error} onPress={() => void load()}><Ionicons name="cloud-offline-outline" size={18} color={colors.warning} /><Text style={styles.errorText}>{t('extensionLoadFailed')}</Text></Pressable> : null}
      {loading && !catalog.plugins.length && !catalog.skills.length ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : (
        <ScrollView style={styles.catalogList} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {section === 'plugins' && plugins.map(item => <CatalogRow key={item.id} plugin={item} title={item.name} description={item.description} builtin={item.builtin} favorite={item.favorite} enabled={item.enabled} busy={busyId === item.id} detail={item.availableVersion ? t('updateAvailable', { version: item.availableVersion }) : t('version', { version: item.version })} warning={item.requiresMacConfiguration} onPress={() => setSelected({ kind: 'plugin', item })} onFavorite={() => favorite('plugin', item.id, !item.favorite)} onToggle={value => togglePlugin(item, value)} />)}
          {section === 'skills' && skills.map(item => <CatalogRow key={`${item.scope}-${item.slug}`} title={item.name} description={item.description} builtin={item.builtin} favorite={item.favorite} enabled={item.enabled} busy={busyId === item.slug} detail={item.scope} onPress={() => setSelected({ kind: 'skill', item })} onFavorite={() => favorite('skill', item.slug, !item.favorite, item.scope)} onToggle={value => toggleSkill(item, value)} />)}
          {section === 'integrations' && integrations.map(item => <CatalogRow key={item.id} title={item.name} favorite={item.favorite} enabled={item.connected} busy={busyId === item.id} detail={item.connected ? item.accountLabel ? t('connectedAccount', { account: item.accountLabel }) : t('integrationConnected') : t('integrationDisconnected')} warning={!item.connected || !item.scopeSatisfied} onPress={() => setSelected({ kind: 'integration', item })} onFavorite={() => favorite('integration', item.id, !item.favorite)} />)}
          {!loading && ((section === 'plugins' && !plugins.length) || (section === 'skills' && !skills.length) || (section === 'integrations' && !integrations.length)) ? <View style={commonStyles.empty}><Ionicons name="search-outline" size={42} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t('noCatalogResults')}</Text></View> : null}
        </ScrollView>
      )}
      <ExtensionDetail selected={selected} busyId={busyId} onClose={() => setSelected(null)} onFavorite={favorite} onTogglePlugin={togglePlugin} onToggleSkill={toggleSkill} onUpdatePlugin={item => void mutate(item.id, () => api!.installPluginUpdate(item.id), 'extensionUpdateFailed')} />
    </View>
  )
}

function matchesFilter(item: { builtin?: boolean; favorite?: boolean; lastUsedAt?: string | null }, filter: Filter) {
  if (filter === 'builtin') return Boolean(item.builtin)
  if (filter === 'personal') return !item.builtin
  if (filter === 'favorites') return Boolean(item.favorite)
  if (filter === 'recent') return Boolean(item.lastUsedAt)
  return true
}

function CatalogRow({ plugin, title, description, detail, builtin, favorite, enabled, warning, busy, onPress, onFavorite, onToggle }: { plugin?: CatalogPlugin; title: string; description?: string | null; detail?: string | null; builtin?: boolean; favorite: boolean; enabled: boolean; warning?: boolean; busy: boolean; onPress: () => void; onFavorite: () => void; onToggle?: (enabled: boolean) => void }) {
  const { t } = useContext(AppContext)
  return <Pressable style={styles.card} onPress={onPress}><View style={styles.cardHead}><View style={[styles.icon, !enabled && styles.iconDisabled]}>{plugin ? <PluginGlyph plugin={plugin} size={24} /> : <Ionicons name={enabled ? 'extension-puzzle' : 'extension-puzzle-outline'} size={21} color={enabled ? colors.accent : colors.textMuted} />}</View><View style={styles.cardText}><View style={styles.nameLine}><Text style={styles.name} numberOfLines={1}>{title}</Text>{builtin !== undefined ? <Text style={styles.kind}>{builtin ? t('builtinItem') : t('personalItem')}</Text> : null}</View>{description ? <Text style={styles.description} numberOfLines={2}>{description}</Text> : null}</View><Pressable onPress={event => { event.stopPropagation(); onFavorite() }} hitSlop={8} accessibilityLabel={favorite ? t('removeFavorite') : t('addFavorite')}><Ionicons name={favorite ? 'star' : 'star-outline'} size={21} color={favorite ? colors.warning : colors.textMuted} /></Pressable></View><View style={styles.cardFoot}><View style={styles.detailLine}>{warning ? <Ionicons name="desktop-outline" size={14} color={colors.warning} /> : null}<Text style={[styles.detail, warning && styles.detailWarning]} numberOfLines={1}>{warning ? t('requiresConfiguration') : detail}</Text></View>{onToggle ? busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Switch value={enabled} onValueChange={onToggle} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={enabled ? colors.accent : colors.textMuted} accessibilityLabel={enabled ? t('disable') : t('enable')} /> : <View style={[styles.statusDot, !enabled && styles.statusDotOff]} />}</View></Pressable>
}

function ExtensionDetail({ selected, busyId, onClose, onFavorite, onTogglePlugin, onToggleSkill, onUpdatePlugin }: { selected: Selected | null; busyId: string | null; onClose: () => void; onFavorite: (kind: Selected['kind'], id: string, value: boolean, scope?: string) => void; onTogglePlugin: (item: CatalogPlugin, enabled: boolean) => void; onToggleSkill: (item: CatalogSkill, enabled: boolean) => void; onUpdatePlugin: (item: CatalogPlugin) => void }) {
  const { language, t } = useContext(AppContext)
  if (!selected) return null
  const id = selected.kind === 'skill' ? selected.item.slug : selected.item.id
  const favorite = selected.item.favorite
  const title = selected.kind === 'plugin' ? t('pluginDetails') : selected.kind === 'skill' ? t('skillDetails') : t('integrationDetails')
  return <AppModal visible title={title} onClose={onClose}><ScrollView contentContainerStyle={styles.detailContent}><View style={styles.detailHeader}>{selected.kind === 'plugin' ? <PluginGlyph plugin={selected.item} size={32} /> : null}<View style={styles.detailTitleWrap}><Text style={styles.detailTitle}>{selected.item.name}</Text><Text style={styles.detailKind}>{selected.kind === 'integration' ? t('integrations') : selected.item.builtin ? t('builtinItem') : t('personalItem')}</Text></View><Pressable onPress={() => onFavorite(selected.kind, id, !favorite, selected.kind === 'skill' ? selected.item.scope : undefined)} accessibilityLabel={favorite ? t('removeFavorite') : t('addFavorite')}><Ionicons name={favorite ? 'star' : 'star-outline'} size={25} color={favorite ? colors.warning : colors.textMuted} /></Pressable></View>{selected.kind !== 'integration' && selected.item.description ? <Text style={styles.detailDescription}>{selected.item.description}</Text> : null}
    {selected.kind === 'plugin' ? <><StateControl enabled={selected.item.enabled} busy={busyId === selected.item.id} onChange={value => onTogglePlugin(selected.item, value)} /><DetailSection title={t('version')} values={[selected.item.version]} />{selected.item.capabilities.length ? <DetailSection title={t('capabilities')} values={selected.item.capabilities} /> : null}<DetailSection title={t('permissions')} values={selected.item.permissions} empty={t('noPermissions')} /><DetailSection title={t('toolsAvailable')} values={selected.item.tools} empty={t('noTools')} />{selected.item.configuration.length || selected.item.requiresMacConfiguration ? <DetailSection title={t('configurationOnMac')} values={selected.item.configuration} empty={t('configurationOnMacDesc')} warning /> : null}<Text style={styles.meta}>{selected.item.lastUsedAt ? t('lastUsed', { date: formatDateTime(selected.item.lastUsedAt, language) }) : t('neverUsed')}</Text>{selected.item.canUpdate && selected.item.availableVersion ? <Pressable style={commonStyles.primaryButton} disabled={busyId === selected.item.id} onPress={() => onUpdatePlugin(selected.item)}><Text style={commonStyles.primaryButtonText}>{busyId === selected.item.id ? t('updating') : t('updateAvailable', { version: selected.item.availableVersion })}</Text></Pressable> : null}</> : null}
    {selected.kind === 'skill' ? <><StateControl enabled={selected.item.enabled} busy={busyId === selected.item.slug} onChange={value => onToggleSkill(selected.item, value)} /><DetailSection title={t('scope')} values={selected.item.scope ? [selected.item.scope] : []} /></> : null}
    {selected.kind === 'integration' ? <><View style={styles.integrationState}><View style={[styles.statusDot, !selected.item.connected && styles.statusDotOff]} /><Text style={[styles.integrationStateText, !selected.item.connected && styles.integrationStateOff]}>{selected.item.connected ? t('integrationConnected') : t('integrationDisconnected')}</Text></View>{selected.item.accountLabel ? <Text style={styles.meta}>{t('connectedAccount', { account: selected.item.accountLabel })}</Text> : null}<DetailSection title={t('permissions')} values={selected.item.permissions} empty={t('noPermissions')} />{!selected.item.scopeSatisfied ? <Text style={styles.warningText}>{t('scopeMissing')}</Text> : null}<View style={styles.macNotice}><Ionicons name="desktop-outline" size={20} color={colors.warning} /><View style={styles.noticeText}><Text style={styles.noticeTitle}>{selected.item.connected ? t('configuredOnMac') : t('requiresConfiguration')}</Text><Text style={styles.noticeBody}>{t('sensitiveOnMac')}</Text></View></View></> : null}
  </ScrollView></AppModal>
}

function StateControl({ enabled, busy, onChange }: { enabled: boolean; busy: boolean; onChange: (value: boolean) => void }) {
  const { t } = useContext(AppContext)
  return <View style={styles.stateControl}><Text style={[styles.stateText, !enabled && styles.stateTextOff]}>{enabled ? t('enabled') : t('disabled')}</Text>{busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Switch value={enabled} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.accentSoft }} thumbColor={enabled ? colors.accent : colors.textMuted} />}</View>
}

function DetailSection({ title, values, empty, warning }: { title: string; values: string[]; empty?: string; warning?: boolean }) {
  const uniqueValues = Array.from(new Map(values.map(value => [value.trim().toLocaleLowerCase(), value])).values())
  return <View style={styles.detailSection}><Text style={styles.detailSectionTitle}>{title}</Text>{uniqueValues.length ? uniqueValues.map(value => <View style={styles.bullet} key={value}><View style={[styles.bulletDot, warning && styles.bulletWarning]} /><Text style={styles.bulletText}>{value}</Text></View>) : empty ? <Text style={styles.meta}>{empty}</Text> : null}</View>
}

const styles = StyleSheet.create({
  sectionTabs: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 6 }, sectionTab: { flex: 1, minWidth: 0, height: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, sectionTabActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, sectionTabText: { minWidth: 0, color: colors.textMuted, fontWeight: '800', fontSize: 11 }, sectionTabTextActive: { color: colors.accent },
  searchWrap: { marginHorizontal: 18, marginTop: 12, height: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, search: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 }, filterScroller: { height: 56, flexGrow: 0, flexShrink: 0 }, filters: { height: 56, alignItems: 'center', gap: 8, paddingHorizontal: 18 }, filter: { height: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: colors.border }, filterActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft }, filterText: { color: colors.textMuted, fontWeight: '700', fontSize: 12 }, filterTextActive: { color: colors.accent },
  error: { marginHorizontal: 18, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: '#3A2A13' }, errorText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: '700' }, catalogList: { flex: 1 }, list: { paddingHorizontal: 18, paddingBottom: 32, gap: 10 }, card: { padding: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft }, iconDisabled: { backgroundColor: colors.surfaceRaised }, cardText: { flex: 1, minWidth: 0 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, name: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '800' }, kind: { color: colors.textMuted, backgroundColor: colors.surfaceRaised, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8, fontWeight: '800', overflow: 'hidden' }, description: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 }, cardFoot: { minHeight: 34, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 9 }, detailLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }, detail: { flexShrink: 1, color: colors.textMuted, fontSize: 10 }, detailWarning: { color: colors.warning }, statusDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: colors.accent }, statusDotOff: { backgroundColor: colors.danger },
  detailContent: { paddingBottom: 10 }, detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, detailTitleWrap: { flex: 1, minWidth: 0 }, detailTitle: { color: colors.text, fontSize: 22, fontWeight: '900' }, detailKind: { color: colors.accent, fontSize: 11, fontWeight: '800', marginTop: 4 }, detailDescription: { color: colors.textMuted, lineHeight: 20, marginTop: 14 }, stateControl: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 14, borderRadius: 13, backgroundColor: colors.surfaceRaised }, stateText: { color: colors.accent, fontWeight: '800' }, stateTextOff: { color: colors.textMuted }, detailSection: { marginTop: 18 }, detailSectionTitle: { color: colors.text, fontSize: 13, fontWeight: '900', marginBottom: 9 }, bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 7 }, bulletDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: colors.accent, marginTop: 6 }, bulletWarning: { backgroundColor: colors.warning }, bulletText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 }, meta: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 12 }, integrationState: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }, integrationStateText: { color: colors.accent, fontWeight: '800' }, integrationStateOff: { color: colors.danger }, warningText: { color: colors.warning, fontSize: 12, marginTop: 10 }, macNotice: { flexDirection: 'row', gap: 11, marginTop: 18, padding: 13, borderRadius: 13, backgroundColor: '#3A2A13' }, noticeText: { flex: 1 }, noticeTitle: { color: colors.warning, fontWeight: '800', fontSize: 12 }, noticeBody: { color: '#E7C978', fontSize: 11, lineHeight: 16, marginTop: 4 },
})
