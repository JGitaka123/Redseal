import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

describe('Red Seal operations prototype', () => {
  it('moves from the dashboard to the plot inventory', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Good afternoon, Mzee.' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Projects & plots/i }))

    expect(screen.getByRole('heading', { name: 'Plot inventory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plot 1, Available/i })).toBeInTheDocument()
  })

  it('reserves an available plot and updates its state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Projects & plots/i }))
    await user.click(screen.getByRole('button', { name: /Plot 1, Available/i }))
    await user.click(screen.getByRole('button', { name: /Reserve this plot/i }))
    await user.type(screen.getByLabelText('Buyer name'), 'Mary Wanjiku')
    await user.type(screen.getByLabelText('Mobile number'), '0712 345 678')
    await user.click(screen.getByRole('button', { name: 'Confirm reservation' }))

    expect(screen.getByText('Plot 1 reserved for Mary Wanjiku')).toBeInTheDocument()
    expect(screen.getByText('Mary Wanjiku')).toBeInTheDocument()
  })
})
