import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UsageMeter } from './UsageMeter'

describe('UsageMeter', () => {
  it('renders used and total Bobcoins with a progress bar', () => {
    render(<UsageMeter usage={{
      available: true,
      usedAmount: 42,
      totalAmount: 160,
      remainingAmount: 118,
      unit: 'Bobcoins',
      message: 'ok',
    }} />)

    expect(screen.getByText('42 / 160')).toBeInTheDocument()
    expect(screen.getByText('118 restants')).toBeInTheDocument()
  })
})
