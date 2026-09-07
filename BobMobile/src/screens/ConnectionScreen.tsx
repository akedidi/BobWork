import { Ionicons } from '@expo/vector-icons'
import React, { useContext, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { ApiError } from '../api'
import { AppContext } from '../context/AppContext'
import { colors, commonStyles } from '../theme'

export function ConnectionScreen() {
  const { t, connect } = useContext(AppContext)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await connect(link)
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === 'missing-token') setError(t('missingToken'))
      else if (caught instanceof ApiError && caught.message === 'invalid-link') setError(t('invalidLink'))
      else if (caught instanceof ApiError && caught.message === 'request-timeout') setError(t('connectionTimeout'))
      else if (caught instanceof ApiError && caught.message === 'api-unavailable') setError(t('apiUnavailable'))
      else if (caught instanceof ApiError && [401, 403, 404, 410].includes(caught.status ?? 0)) setError(t('connectionExpired'))
      else setError(t('connectionFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.hero}>
        <View style={styles.logo}><Image source={require('../../assets/bob-avatar.png')} style={styles.logoImage} resizeMode="contain" /></View>
        <Text style={commonStyles.title}>{t('connectTitle')}</Text>
        <Text style={[commonStyles.subtitle, styles.description]}>{t('connectDesc')}</Text>
      </View>
      <View style={[commonStyles.card, styles.card]}>
        <Text style={commonStyles.label}>{t('connectionLink')}</Text>
        <View style={styles.inputWrap}>
          <Ionicons name="link-outline" size={19} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            value={link}
            onChangeText={setLink}
            placeholder={t('connectionPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            multiline
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={[commonStyles.primaryButton, (!link.trim() || busy) && styles.disabled]} disabled={!link.trim() || busy} onPress={() => void submit()}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={commonStyles.primaryButtonText}>{t('connect')}</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: colors.background },
  hero: { alignItems: 'center', gap: 12, marginBottom: 28 },
  logo: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 6 },
  logoImage: { width: 66, height: 66 },
  description: { maxWidth: 360, textAlign: 'center' },
  card: { gap: 12 },
  inputWrap: { minHeight: 68, flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  input: { flex: 1, minHeight: 44, color: colors.text, fontSize: 14, lineHeight: 20, padding: 0 },
  error: { color: colors.danger, fontSize: 13 },
  disabled: { opacity: .5 },
})
