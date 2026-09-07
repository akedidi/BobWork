import { Ionicons } from '@expo/vector-icons'
import React, { type ComponentProps } from 'react'
import { Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import type { CatalogPlugin } from '../types'

type IconName = ComponentProps<typeof Ionicons>['name']

const iconRules: Array<{ terms: string[]; icon: IconName }> = [
  { terms: ['data analytics', 'data-analytics', 'analytics'], icon: 'stats-chart-outline' },
  { terms: ['designer', 'design ir', 'ux design', 'ui design'], icon: 'color-palette-outline' },
  { terms: ['powerpoint', 'ppt', 'presentation'], icon: 'easel-outline' },
  { terms: ['excel', 'spreadsheet', 'data prep', 'db2', 'database'], icon: 'grid-outline' },
  { terms: ['word', 'document', 'docling', 'pdf'], icon: 'document-text-outline' },
  { terms: ['cloud', 'openshift', 'terraform', 'ansible', 'kubernetes'], icon: 'cloud-outline' },
  { terms: ['github', 'code', 'developer', 'java', 'junit', 'mcp'], icon: 'code-slash-outline' },
  { terms: ['guardian', 'reviewer', 'security', 'legal'], icon: 'shield-checkmark-outline' },
  { terms: ['architecture', 'engineering', 'computer'], icon: 'construct-outline' },
  { terms: ['chrome', 'browser', 'web'], icon: 'globe-outline' },
  { terms: ['calendar', 'meeting', 'outlook'], icon: 'calendar-outline' },
  { terms: ['invest', 'financial', 'market'], icon: 'stats-chart-outline' },
  { terms: ['agentic', 'agent'], icon: 'sparkles-outline' },
]

const palette = ['#6C8EFF', '#A47CFF', '#33B7A2', '#F09A58', '#E96D91', '#55A8E8']

const providerLogos: Record<string, ImageSourcePropType> = {
  aws: require('../../assets/plugin-icons/aws.png'),
  azure: require('../../assets/plugin-icons/azure.png'),
  gcp: require('../../assets/plugin-icons/gcp.png'),
}

function providerLogo(plugin: CatalogPlugin): ImageSourcePropType | undefined {
  const icon = plugin.icon?.toLocaleLowerCase()
  if (icon && providerLogos[icon]) return providerLogos[icon]
  if (plugin.id === 'builtin-aws') return providerLogos.aws
  if (plugin.id === 'builtin-azure') return providerLogos.azure
  if (plugin.id === 'builtin-gcp') return providerLogos.gcp
  return undefined
}

function pluginIcon(plugin: CatalogPlugin): IconName {
  const source = `${plugin.icon ?? ''} ${plugin.id} ${plugin.name} ${plugin.category ?? ''} ${plugin.description ?? ''}`.toLocaleLowerCase()
  return iconRules.find(rule => rule.terms.some(term => source.includes(term)))?.icon ?? 'extension-puzzle-outline'
}

function pluginColor(plugin: CatalogPlugin): string {
  let hash = 0
  for (const character of plugin.id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return palette[Math.abs(hash) % palette.length] ?? colors.accent
}

export function PluginGlyph({ plugin, size = 16 }: { plugin: CatalogPlugin; size?: number }) {
  const color = pluginColor(plugin)
  const logo = providerLogo(plugin)
  return <View style={[styles.glyph, { backgroundColor: `${color}22` }]}>{logo ? <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" /> : <Ionicons name={pluginIcon(plugin)} size={size} color={color} />}</View>
}

export function SelectedPluginChips({
  plugins,
  accessibilityLabel,
  removeLabel,
  onRemove,
}: {
  plugins: CatalogPlugin[]
  accessibilityLabel: string
  removeLabel: (name: string) => string
  onRemove: (id: string) => void
}) {
  if (plugins.length === 0) return null
  return (
    <ScrollView
      horizontal
      style={styles.scroller}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
    >
      {plugins.map(plugin => (
        <View key={plugin.id} style={styles.chip}>
          <PluginGlyph plugin={plugin} />
          <Text style={styles.name} numberOfLines={1}>{plugin.name}</Text>
          <Pressable hitSlop={7} onPress={() => onRemove(plugin.id)} accessibilityLabel={removeLabel(plugin.name)}>
            <Ionicons name="close" size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroller: { height: 39, flexGrow: 0, flexShrink: 0 },
  content: { height: 39, alignItems: 'flex-start', gap: 7, paddingBottom: 7 },
  chip: { maxWidth: 230, minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 5, paddingRight: 8, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  glyph: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  name: { maxWidth: 164, flexShrink: 1, color: colors.text, fontSize: 11, fontWeight: '800' },
})
