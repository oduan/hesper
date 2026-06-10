import { describe, expect, it } from 'vitest'
import { createInMemoryPersistence } from '@hesper/persistence'
import { createSessionService } from './session-service'

const now = '2026-06-10T05:00:00.000Z'

describe('createSessionService', () => {
  it('creates, updates, archives and deletes sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const created = await service.createSession({ title: 'First', now })
    expect(created).toMatchObject({
      title: 'First',
      status: 'active',
      outputMode: 'markdown'
    })

    await service.updateTitle(created.id, 'Updated')
    await service.setWorkspacePath(created.id, 'C:/workspace')
    await service.setDefaultModel(created.id, 'mock/model')
    await service.setOutputMode(created.id, 'html')
    await service.archiveSession(created.id)

    const archived = await service.getSession(created.id)
    expect(archived).toMatchObject({
      title: 'Updated',
      workspacePath: 'C:/workspace',
      defaultModelId: 'mock/model',
      outputMode: 'html',
      status: 'archived'
    })

    await service.deleteSession(created.id)
    await expect(service.getSession(created.id)).rejects.toThrow(`Session not found: ${created.id}`)
  })

  it('lists sessions by visible order and excludes deleted sessions', async () => {
    const persistence = await createInMemoryPersistence()
    const service = createSessionService(persistence)

    const first = await service.createSession({ title: 'First', now })
    const second = await service.createSession({ title: 'Second', now })
    await service.deleteSession(second.id)

    const sessions = await service.listSessions()
    expect(sessions.map((session) => session.id)).toEqual([first.id])
  })
})
