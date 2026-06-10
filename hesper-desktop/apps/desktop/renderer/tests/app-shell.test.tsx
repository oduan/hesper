// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

const { listSessions, createSession } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'session-1',
    title: 'New chat',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  }))
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: createSession
    },
    agent: { enqueue: vi.fn(), onEvent: vi.fn(() => () => undefined) },
    dialog: { selectDirectory: vi.fn() }
  }
}))

describe('renderer App', () => {
  beforeEach(() => {
    listSessions.mockReset()
    createSession.mockClear()
    listSessions.mockResolvedValue([])
  })

  it('renders the high-density shell and empty conversation state', async () => {
    render(<App />)
    expect(await screen.findByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })

  it('shows a minimal error state when initial sessions load fails', async () => {
    listSessions.mockRejectedValueOnce(new Error('IPC unavailable'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('会话加载失败：IPC unavailable')
  })
})
