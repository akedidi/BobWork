import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { AppModal } from './AppModal'
import { modeLabel } from '../labels'
import { colors, commonStyles } from '../theme'
import type { ModeOption, Project, ProjectMutationInput } from '../types'

type Translate = (key: any, params?: Record<string, string | number>) => string

interface Props {
  visible: boolean
  project?: Project | null
  modes: ModeOption[]
  busy: boolean
  t: Translate
  onClose: () => void
  onSubmit: (input: ProjectMutationInput) => void
}

export function ProjectEditorModal({ visible, project, modes, busy, t, onClose, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [objective, setObjective] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [defaultMode, setDefaultMode] = useState('agent')
  const [memoryEnabled, setMemoryEnabled] = useState(true)

  useEffect(() => {
    if (!visible) return
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setObjective(project?.objective ?? '')
    setCustomInstructions(project?.customInstructions ?? '')
    setDefaultMode(project?.defaultMode ?? 'agent')
    setMemoryEnabled(project?.memoryEnabled ?? true)
  }, [project, visible])

  const submit = () => onSubmit({
    name: name.trim(),
    description: description.trim(),
    objective: objective.trim(),
    customInstructions: customInstructions.trim(),
    language: 'auto',
    defaultMode,
    memoryEnabled,
    allowedPlugins: [],
    allowedIntegrations: [],
  })

  return <AppModal visible={visible} title={project ? t('editProject') : t('newProject')} onClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={commonStyles.label}>{t('projectName')}</Text>
      <TextInput style={commonStyles.input} value={name} onChangeText={setName} placeholder={t('projectNamePlaceholder')} placeholderTextColor={colors.textMuted} />
      <Text style={styles.labelGap}>{t('description')}</Text>
      <TextInput style={[commonStyles.input, styles.multiline]} value={description} onChangeText={setDescription} placeholder={t('descriptionPlaceholder')} placeholderTextColor={colors.textMuted} multiline />
      <Text style={styles.labelGap}>{t('objective')}</Text>
      <TextInput style={[commonStyles.input, styles.multiline]} value={objective} onChangeText={setObjective} placeholder={t('objectivePlaceholder')} placeholderTextColor={colors.textMuted} multiline />
      <Text style={styles.labelGap}>{t('customInstructions')}</Text>
      <TextInput style={[commonStyles.input, styles.multiline]} value={customInstructions} onChangeText={setCustomInstructions} placeholder={t('customInstructionsPlaceholder')} placeholderTextColor={colors.textMuted} multiline />

      <Text style={styles.section}>{t('defaultMode')}</Text>
      <View style={styles.tags}>{modes.map(item => <Choice key={item.id} label={modeLabel(item.id, t)} selected={defaultMode === item.id} onPress={() => setDefaultMode(item.id)} />)}</View>
      <Text style={styles.section}>{t('memory')}</Text>
      <View style={styles.tags}><Choice label={t('memoryOn')} selected={memoryEnabled} onPress={() => setMemoryEnabled(true)} /><Choice label={t('memoryOff')} selected={!memoryEnabled} onPress={() => setMemoryEnabled(false)} /></View>

      <Pressable style={[commonStyles.primaryButton, styles.submit, (!name.trim() || busy) && styles.disabled]} disabled={!name.trim() || busy} onPress={submit}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={commonStyles.primaryButtonText}>{project ? t('saveChanges') : t('create')}</Text>}</Pressable>
    </ScrollView>
  </AppModal>
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable style={[styles.tag, selected && styles.tagSelected]} onPress={onPress}><Text style={[styles.tagText, selected && styles.tagTextSelected]} numberOfLines={2}>{label}</Text></Pressable>
}

const styles = StyleSheet.create({
  labelGap: { ...commonStyles.label, marginTop: 15 },
  multiline: { minHeight: 76, paddingTop: 12, textAlignVertical: 'top' },
  section: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: { maxWidth: '100%', minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  tagSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tagText: { flexShrink: 1, color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  tagTextSelected: { color: colors.text, fontWeight: '700' },
  submit: { marginTop: 24, marginBottom: 10 },
  disabled: { opacity: .5 },
})
