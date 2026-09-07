import { Ionicons } from '@expo/vector-icons'
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { TopBar } from '../components/TopBar'
import { AppContext } from '../context/AppContext'
import { colors, commonStyles } from '../theme'
import type { BobTask, Conversation, TaskDetail } from '../types'
import { eventTitleLabel, modeLabel, taskStateLabel } from '../labels'
import { formatDateTime } from '../i18n'
import { MessageMarkdown } from './ChatScreen'

export function TaskDetailScreen({ task, onBack, onOpenConversation }: { task: BobTask; onBack: () => void; onOpenConversation: (conversation: Conversation) => void }) {
  const { api, history, refreshHistory, language, t } = useContext(AppContext)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    if (!api) return
    try { setDetail(await api.taskDetail(task.id)) }
    catch { /* keep the synchronized task visible while reconnecting */ }
  }, [api, task.id])
  useEffect(() => { void load() }, [load])
  const current = detail?.task ?? task
  const conversation = history?.conversations.find(item => item.conversation.id === current.conversationId)?.conversation
  const tools = useMemo(() => [...new Set((detail?.events ?? []).map(event => event.toolName).filter((value): value is string => Boolean(value)))], [detail])
  const duration = current.startDate ? Math.max(0, new Date(current.endDate ?? Date.now()).getTime() - new Date(current.startDate).getTime()) : 0
  const errors = Array.isArray(current.errors) ? current.errors.join('\n') : current.errors ? JSON.stringify(current.errors) : ''
  const pin = async () => { if (!api) return; setBusy(true); try { await api.setTaskPinned(current.id, !current.pinned); await Promise.all([load(), refreshHistory()]) } catch { Alert.alert(t('error')) } finally { setBusy(false) } }
  const retry = async () => { if (!api) return; setBusy(true); try { await api.retryTask(current.id); await refreshHistory(); await load() } catch { Alert.alert(t('error'), t('retryFailed')) } finally { setBusy(false) } }
  return <View style={commonStyles.screen}>
    <TopBar title={t('taskDetails')} onBack={onBack} action={<Pressable disabled={busy} onPress={() => void pin()} accessibilityLabel={current.pinned ? t('unpinTask') : t('pinTask')}><Ionicons name={current.pinned ? 'star' : 'star-outline'} size={23} color={colors.accent} /></Pressable>} />
    {!detail ? <View style={commonStyles.empty}><ActivityIndicator color={colors.accent} /></View> : <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.objective}>{current.objective}</Text>
      <View style={styles.metrics}><Metric label={t('duration')} value={duration ? `${Math.round(duration / 1000)} s` : '—'} /><Metric label={t('mode')} value={modeLabel(current.mode, t)} /></View>
      <Section title={t('taskResult')}>{current.summary ? <MessageMarkdown value={current.summary} user={false} /> : <Text style={styles.body}>{t('noResult')}</Text>}</Section>
      {errors ? <Section title={t('taskErrors')}><Text style={[styles.body, { color: colors.danger }]}>{errors}</Text></Section> : null}
      <Section title={t('taskTools')}><Text style={styles.body}>{tools.join(' · ') || '—'}</Text></Section>
      <Section title={t('taskRuns')}>{detail.runs.length ? detail.runs.map(run => <View key={run.id} style={styles.row}><Ionicons name={run.state === 'completed' ? 'checkmark-circle' : run.state === 'failed' ? 'alert-circle' : 'time'} color={run.state === 'failed' ? colors.danger : colors.accent} size={18} /><View style={{ flex: 1 }}><Text style={styles.body}>{run.summary ?? run.error ?? taskStateLabel(run.state, t)}</Text><Text style={styles.date}>{formatDateTime(run.createdAt, language)}</Text></View></View>) : <Text style={styles.body}>{t('noRuns')}</Text>}</Section>
      <Section title={t('taskActivity')}>{detail.events.map(event => <View key={event.id} style={styles.row}><View style={styles.dot} /><View style={{ flex: 1 }}><Text style={styles.body}>{eventTitleLabel(event, t)}</Text>{event.content ? <Text style={styles.date}>{event.content}</Text> : null}</View></View>)}</Section>
      <View style={styles.actions}>{conversation ? <Pressable style={styles.button} onPress={() => onOpenConversation(conversation)}><Ionicons name="chatbubble-outline" size={17} color={colors.accent} /><Text style={styles.buttonText}>{t('conversations')}</Text></Pressable> : null}{['failed', 'cancelled'].includes(current.state) ? <Pressable style={styles.button} disabled={busy} onPress={() => void retry()}><Ionicons name="refresh" size={17} color={colors.accent} /><Text style={styles.buttonText}>{t('retryTask')}</Text></Pressable> : null}</View>
    </ScrollView>}
  </View>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View> }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.date}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View> }
const styles = StyleSheet.create({ content: { padding: 16, paddingBottom: 40 }, objective: { color: colors.text, fontSize: 19, lineHeight: 26, fontWeight: '800' }, metrics: { flexDirection: 'row', gap: 10, marginTop: 14 }, metric: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceRaised }, metricValue: { color: colors.text, fontWeight: '800', marginTop: 4 }, section: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, sectionTitle: { color: colors.text, fontWeight: '800', marginBottom: 9 }, body: { color: colors.text, fontSize: 13, lineHeight: 19 }, date: { color: colors.textMuted, fontSize: 11, lineHeight: 16 }, row: { flexDirection: 'row', gap: 9, marginBottom: 10 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }, button: { flexDirection: 'row', gap: 7, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: colors.accentSoft }, buttonText: { color: colors.accent, fontWeight: '800' } })
