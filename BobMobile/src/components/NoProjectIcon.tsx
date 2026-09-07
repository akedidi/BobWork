import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { View } from 'react-native'
import { colors } from '../theme'

export function NoProjectIcon({ size = 18, color = colors.textMuted }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      <Ionicons name="folder-outline" size={size} color={color} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size + 2,
          height: Math.max(1.5, size * .11),
          borderRadius: 99,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  )
}
