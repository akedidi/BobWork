import React, { useEffect, useRef, useState } from 'react'
import { TextInput, type LayoutChangeEvent, type NativeSyntheticEvent, type TextInputContentSizeChangeEventData, type TextInputProps } from 'react-native'

const MIN_HEIGHT = 40
const MAX_HEIGHT = 156
const LINE_HEIGHT = 20
const VERTICAL_INSET = 20
const HORIZONTAL_INSET = 24
const AVERAGE_CHARACTER_WIDTH = 7.2

type GrowingPromptInputProps = Omit<TextInputProps, 'multiline' | 'scrollEnabled' | 'onContentSizeChange'>

export function GrowingPromptInput({ value, style, onChangeText, onLayout, ...props }: GrowingPromptInputProps) {
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [width, setWidth] = useState(0)
  const nativeContentHeight = useRef(MIN_HEIGHT)

  useEffect(() => {
    if (!value) {
      nativeContentHeight.current = MIN_HEIGHT
      setHeight(MIN_HEIGHT)
      return
    }
    setHeight(resolveHeight(value, width, nativeContentHeight.current))
  }, [value, width])

  const resize = (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    nativeContentHeight.current = event.nativeEvent.contentSize.height
    const nextHeight = resolveHeight(value ?? '', width, nativeContentHeight.current)
    setHeight(current => current === nextHeight ? current : nextHeight)
  }

  const changeText = (nextValue: string) => {
    setHeight(current => {
      const nextHeight = resolveHeight(nextValue, width, nativeContentHeight.current)
      return current === nextHeight ? current : nextHeight
    })
    onChangeText?.(nextValue)
  }

  const layout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width)
    setWidth(current => current === nextWidth ? current : nextWidth)
    onLayout?.(event)
  }

  return (
    <TextInput
      {...props}
      value={value}
      style={[style, { height, lineHeight: LINE_HEIGHT }]}
      multiline
      scrollEnabled={height >= MAX_HEIGHT - 1}
      onContentSizeChange={resize}
      onChangeText={changeText}
      onLayout={layout}
      textAlignVertical="top"
      maxLength={64000}
    />
  )
}

export function estimatePromptHeight(value: string, width: number) {
  if (!value) return MIN_HEIGHT
  if (width <= 0) return MIN_HEIGHT
  const usableWidth = Math.max(80, width - HORIZONTAL_INSET)
  const charactersPerLine = Math.max(10, Math.floor(usableWidth / AVERAGE_CHARACTER_WIDTH))
  const lines = value.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)), 0)
  return clampHeight(lines * LINE_HEIGHT + VERTICAL_INSET)
}

function resolveHeight(value: string, width: number, measuredHeight: number) {
  return clampHeight(Math.max(measuredHeight, estimatePromptHeight(value, width)))
}

function clampHeight(height: number) {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(height)))
}
