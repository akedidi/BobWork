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
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '26')
    expect(bar.style.backgroundImage).toContain('26.25%')
  })

  it('fills the bar from used + remaining when total is missing', () => {
    render(<UsageMeter usage={{
      available: true,
      usedAmount: 80,
      remainingAmount: 20,
      unit: 'Bobcoins',
      message: 'ok',
    }} />)

    expect(screen.getByText('80 / 100')).toBeInTheDocument()
    expect(screen.getByRole('progressbar').style.backgroundImage).toContain('80%')
  })

  it('fills the bar inside a clickable sidebar meter', () => {
    render(<UsageMeter
      compact
      onClick={() => undefined}
      usage={{
        available: true,
        usedAmount: 104.2,
        totalAmount: 500,
        remainingAmount: 395.8,
        unit: 'Bobcoins',
        message: 'ok',
      }}
    />)

    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('104.2 / 500')).toBeInTheDocument()
    expect(screen.getByRole('progressbar').style.backgroundImage).toContain('20.84%')
  })
})
