// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'session-1', title: 'New chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }))
    },
    agent: { enqueue: vi.fn(), onEvent: vi.fn(() => () => undefined) },
    dialog: { selectDirectory: vi.fn() }
  }
}))

describe('renderer App', () => {
  it('renders the high-density shell and empty conversation state', async () => {
    render(<App />)
    expect(await screen.findByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })
})
