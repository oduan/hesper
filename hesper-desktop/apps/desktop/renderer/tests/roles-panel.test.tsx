// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RolesPanel } from '../src/roles-panel'

const tools = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem' as const, inputSchema: {}, enabled: true },
  { id: 'git.status', name: 'Git Status', description: 'Git status', category: 'git' as const, inputSchema: {}, enabled: true }
]

const role = {
  id: 'role-1',
  name: '运维助手',
  description: '执行命令',
  systemPrompt: '你是运维助手。',
  defaultToolIds: ['git.status']
}

describe('RolesPanel', () => {
  afterEach(() => cleanup())

  it('renders an empty state without a create action', () => {
    render(<RolesPanel roles={[]} tools={tools} />)

    expect(screen.getByText('暂无角色')).toBeInTheDocument()
    expect(screen.getByText('请让 Agent 创建角色后，再在这里维护名称、简介、提示词和默认工具。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
  })

  it('disables save for unchanged existing roles', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<RolesPanel roles={[role]} selectedRole={role} tools={tools} onSave={onSave} onDelete={vi.fn()} />)

    const saveButton = screen.getByRole('button', { name: '保存修改' })
    expect(saveButton).toBeDisabled()
    expect(saveButton).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)', color: 'var(--hesper-color-text-muted, #737aa2)', cursor: 'not-allowed' })

    await user.type(screen.getByLabelText('角色简介'), ' updated')

    expect(saveButton).toBeEnabled()
  })

  it('edits and saves an existing role', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<RolesPanel roles={[role]} selectedRole={role} tools={tools} onSave={onSave} onDelete={vi.fn()} />)

    await user.clear(screen.getByLabelText('角色名称'))
    await user.type(screen.getByLabelText('角色名称'), '更新角色')
    await user.click(screen.getByLabelText('Read File'))
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'role-1',
      name: '更新角色',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: expect.arrayContaining(['filesystem.read-file', 'git.status'])
    })
  })

  it('confirms before deleting a role', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<RolesPanel roles={[role]} selectedRole={role} tools={tools} onSave={vi.fn()} onDelete={onDelete} />)

    const deleteButton = screen.getByRole('button', { name: '删除角色' })
    expect(deleteButton).toHaveStyle({
      background: 'var(--hesper-color-danger-soft, rgba(220, 38, 38, 0.20))',
      color: 'var(--hesper-color-danger-strong, #dc2626)'
    })
    expect(deleteButton.getAttribute('style')).toContain('border-width: 1px')
    expect(deleteButton.getAttribute('style')).toContain('border-style: solid')
    expect(deleteButton.getAttribute('style')).toContain('border-color: var(--hesper-color-danger, #ef4444)')

    await user.click(deleteButton)

    expect(window.confirm).toHaveBeenCalledWith('确定要删除角色“运维助手”吗？此操作无法撤销。')
    expect(onDelete).toHaveBeenCalledWith('role-1')
  })
})
