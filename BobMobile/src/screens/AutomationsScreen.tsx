import { Ionicons } from '@expo/vector-icons'
import React, { useCallback, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { AppModal } from '../components/AppModal'
import { AppContext } from '../context/AppContext'
import { scheduleStateLabel, taskStateLabel } from '../labels'
import { colors, commonStyles } from '../theme'
import type { Schedule, ScheduleRun } from '../types'
import { formatDateTime } from '../i18n'

export function AutomationsScreen() {
  const { api, liveEvents, refreshHistory, language, t } = useContext(AppContext)
  const [items, setItems] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [frequency, setFrequency] = useState('daily')
  const [runAt, setRunAt] = useState('09:00')
  const [runs, setRuns] = useState<{ schedule: Schedule; values: ScheduleRun[] } | null>(null)
  const load = useCallback(async () => { if (!api) return; try { setItems(await api.schedules()) } catch { setItems([]) } finally { setLoading(false) } }, [api])
  useEffect(() => { void load() }, [load, liveEvents[0]?.sentAt])
  const action = async (id: string, operation: () => Promise<unknown>) => { setBusy(id); try { await operation(); await Promise.all([load(), refreshHistory()]) } catch { Alert.alert(t('error'), t('automationFailed')) } finally { setBusy(null) } }
  const create = async () => {
    if (!api || !name.trim() || !instructions.trim()) return
    setBusy('create')
    try {
      const cronOrEvent = frequency === 'weekly' ? 'weekly' : frequency === 'monthly' ? 'monthly' : 'daily'
      await api.createSchedule({ name: name.trim(), instructions: instructions.trim(), cronOrEvent, runAt, offlineBehavior: 'run_on_wake', overlapPolicy: 'queue' })
      setCreating(false); setName(''); setInstructions(''); await load(); Alert.alert(t('automationCreated'))
    } catch { Alert.alert(t('error'), t('automationFailed')) } finally { setBusy(null) }
  }
  const history = async (schedule: Schedule) => { if (!api) return; setBusy(schedule.id); try { setRuns({ schedule, values: await api.scheduleRuns(schedule.id) }) } catch { Alert.alert(t('error'), t('automationFailed')) } finally { setBusy(null) } }
  if (loading) return <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View>
  return <View style={{ flex: 1 }}>
    <FlatList style={styles.automationList} data={items} keyExtractor={item => item.id} contentContainerStyle={[styles.list, items.length === 0 && { flexGrow: 1 }]} renderItem={({ item }) => <View style={commonStyles.card}>
      <View style={styles.header}><View style={[styles.icon, item.state === 'active' && styles.iconActive]}><Ionicons name="timer-outline" size={20} color={item.state === 'active' ? colors.accent : colors.textMuted} /></View><View style={{ flex: 1 }}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.cronOrEvent === 'daily' ? t('everyDay') : item.cronOrEvent === 'weekly' ? t('everyWeek') : item.cronOrEvent === 'monthly' ? t('everyMonth') : item.cronOrEvent}{item.runAt ? ` · ${item.runAt}` : ''}</Text></View><Text style={styles.state}>{scheduleStateLabel(item.state, t)}</Text></View>
      <Text style={styles.instructions} numberOfLines={2}>{item.instructions}</Text>
      <Text style={styles.meta}>{item.nextRun ? t('nextRun', { date: formatDateTime(item.nextRun, language) }) : t('neverRun')}</Text>
      <View style={styles.actions}>
        <Action icon={item.state === 'active' ? 'pause' : 'play'} label={item.state === 'active' ? t('pauseAutomation') : t('resumeAutomation')} disabled={busy === item.id} onPress={() => api && void action(item.id, () => api.setScheduleState(item.id, item.state === 'active' ? 'paused' : 'active'))} />
        <Action icon="flash-outline" label={t('runNow')} disabled={busy === item.id} onPress={() => api && void action(item.id, () => api.runSchedule(item.id))} />
        <Action icon="time-outline" label={t('runHistory')} disabled={busy === item.id} onPress={() => void history(item)} />
      </View>
    </View>} ItemSeparatorComponent={() => <View style={{ height: 10 }} />} ListHeaderComponent={<Pressable style={styles.createButton} onPress={() => setCreating(true)}><Ionicons name="add" size={20} color={colors.white} /><Text style={styles.createText}>{t('newAutomation')}</Text></Pressable>} ListEmptyComponent={<View style={commonStyles.empty}><Ionicons name="timer-outline" size={48} color={colors.textMuted} /><Text style={commonStyles.emptyTitle}>{t('noAutomations')}</Text><Text style={commonStyles.emptyText}>{t('noAutomationsDesc')}</Text></View>} />
    <AppModal visible={creating} title={t('newAutomation')} onClose={() => setCreating(false)}><ScrollView keyboardShouldPersistTaps="handled"><Label text={t('automationName')} /><TextInput style={styles.input} value={name} onChangeText={setName} /><Label text={t('automationInstructions')} /><TextInput multiline style={[styles.input, styles.multiline]} value={instructions} onChangeText={setInstructions} /><Label text={t('frequency')} /><View style={styles.choiceRow}>{[['daily', t('everyDay')], ['weekly', t('everyWeek')], ['monthly', t('everyMonth')]].map(([id, label]) => <Pressable key={id} style={[styles.choice, frequency === id && styles.choiceActive]} onPress={() => setFrequency(id ?? 'daily')}><Text style={frequency === id ? styles.choiceTextActive : styles.choiceText}>{label}</Text></Pressable>)}</View><Label text={t('runAt')} /><TextInput style={styles.input} value={runAt} onChangeText={setRunAt} placeholder="09:00" placeholderTextColor={colors.textMuted} /><Pressable style={[styles.submit, (!name.trim() || !instructions.trim()) && { opacity: .45 }]} disabled={!name.trim() || !instructions.trim() || busy === 'create'} onPress={() => void create()}>{busy === 'create' ? <ActivityIndicator color={colors.white} /> : <Text style={styles.createText}>{t('createAutomation')}</Text>}</Pressable></ScrollView></AppModal>
    <AppModal visible={Boolean(runs)} title={runs?.schedule.name ?? t('runHistory')} onClose={() => setRuns(null)}><ScrollView>{runs?.values.length ? runs.values.map(run => <View key={run.id} style={styles.run}><Ionicons name={run.state === 'completed' ? 'checkmark-circle' : run.state === 'failed' ? 'alert-circle' : 'time'} size={19} color={run.state === 'failed' ? colors.danger : colors.accent} /><View style={{ flex: 1 }}><Text style={styles.instructions}>{run.summary ?? run.error ?? taskStateLabel(run.state, t)}</Text><Text style={styles.meta}>{formatDateTime(run.scheduledFor, language)}</Text></View></View>) : <Text style={styles.instructions}>{t('noRuns')}</Text>}</ScrollView></AppModal>
  </View>
}

function Action({ icon, label, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; disabled: boolean; onPress: () => void }) { return <Pressable style={styles.action} disabled={disabled} onPress={onPress}><Ionicons name={icon} size={16} color={colors.accent} /><Text style={styles.actionText} numberOfLines={2}>{label}</Text></Pressable> }
function Label({ text }: { text: string }) { return <Text style={styles.label}>{text}</Text> }
const styles = StyleSheet.create({ automationList: { flex: 1 }, list: { padding: 16, paddingBottom: 90 }, createButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, backgroundColor: colors.accent, marginBottom: 14 }, createText: { color: colors.white, fontWeight: '800', textAlign: 'center' }, header: { flexDirection: 'row', alignItems: 'center', gap: 10 }, icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }, iconActive: { backgroundColor: colors.accentSoft }, name: { color: colors.text, fontWeight: '800', fontSize: 15 }, meta: { color: colors.textMuted, fontSize: 11, marginTop: 3 }, state: { color: colors.accent, fontSize: 10, fontWeight: '800' }, instructions: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 11 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 }, action: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 10, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border }, actionText: { flexShrink: 1, color: colors.accent, fontSize: 10, fontWeight: '800', textAlign: 'center' }, label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 8 }, input: { minHeight: 44, color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12 }, multiline: { minHeight: 100, paddingTop: 12, textAlignVertical: 'top' }, choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.surfaceRaised }, choiceActive: { backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }, choiceText: { color: colors.textMuted, fontSize: 11 }, choiceTextActive: { color: colors.accent, fontSize: 11, fontWeight: '800' }, submit: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.accent, marginTop: 18 }, run: { flexDirection: 'row', gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border } })
