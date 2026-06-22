// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { themeTokens } from '@hesper/ui'
import { RolesPanel } from '../src/roles-panel'

const tools = [
  { id: 'filesystem.read-file', name: 'Read File', description: 'Read', category: 'filesystem' as const, inputSchema: {}, enabled: true },
  { id: 'git.status', name: 'Git Status', description: 'Git status', category: 'git' as const, inputSchema: {}, enabled: true }
]

const modelOptions = ['gpt-4o', 'deepseek-chat']
const modelOptionGroups = [
  {
    id: 'openai',
    label: 'OpenAI',
    options: [{ value: 'gpt-4o', label: 'GPT-4o' }]
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    options: [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }]
  }
]

const role = {
  id: 'role-1',
  name: '运维助手',
  description: '执行命令',
  systemPrompt: '你是运维助手。',
  defaultToolIds: ['git.status'],
  defaultModelId: 'gpt-4o',
  defaultModelRef: { providerId: 'openai', modelId: 'gpt-4o' }
}

const reviewerRole = {
  id: 'role-2',
  name: '审查助手',
  description: '审查代码',
  systemPrompt: '你是审查助手。',
  defaultToolIds: ['filesystem.read-file'],
  defaultModelId: 'deepseek-chat',
  defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
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

  it('keeps save disabled when switching selected roles after draft edits', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <RolesPanel
        roles={[role, reviewerRole]}
        selectedRole={role}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const nameInput = screen.getByLabelText('角色名称')
    const saveButton = screen.getByRole('button', { name: '保存修改' })

    await user.clear(nameInput)
    await user.type(nameInput, '临时修改')
    expect(saveButton).toBeEnabled()

    rerender(
      <RolesPanel
        roles={[role, reviewerRole]}
        selectedRole={reviewerRole}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByLabelText('角色名称')).toHaveValue('审查助手')
    expect(screen.getByLabelText('角色简介')).toHaveValue('审查代码')
    expect(screen.getByLabelText('默认模型')).toHaveValue('deepseek-chat')
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  })

  it('shows the selected default model and enables save when it changes', async () => {
    const user = userEvent.setup()
    render(
      <RolesPanel
        roles={[role]}
        selectedRole={role}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    const defaultModelSelect = screen.getByLabelText('默认模型')
    const saveButton = screen.getByRole('button', { name: '保存修改' })

    expect(defaultModelSelect).toHaveValue('gpt-4o')
    expect(saveButton).toBeDisabled()

    await user.selectOptions(defaultModelSelect, 'deepseek-chat')

    expect(saveButton).toBeEnabled()
  })

  it('shows an unavailable selected default model without enabling save', () => {
    const legacyRole = {
      id: 'role-legacy',
      name: '旧模型角色',
      description: '保留旧模型',
      systemPrompt: '你是旧模型角色。',
      defaultToolIds: ['git.status'],
      defaultModelId: 'legacy-model'
    }

    render(
      <RolesPanel
        roles={[legacyRole]}
        selectedRole={legacyRole}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByLabelText('默认模型')).toHaveValue('legacy-model')
    expect(screen.getByRole('option', { name: '当前模型（不可用）：legacy-model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  })

  it('edits and saves an existing role', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <RolesPanel
        roles={[role]}
        selectedRole={role}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={onSave}
        onDelete={vi.fn()}
      />
    )

    await user.clear(screen.getByLabelText('角色名称'))
    await user.type(screen.getByLabelText('角色名称'), '更新角色')
    await user.selectOptions(screen.getByLabelText('默认模型'), 'deepseek-chat')
    await user.click(screen.getByLabelText('Read File'))
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'role-1',
      name: '更新角色',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: expect.arrayContaining(['filesystem.read-file', 'git.status']),
      defaultModelId: 'deepseek-chat',
      defaultModelRef: { providerId: 'deepseek', modelId: 'deepseek-chat' }
    })
  })

  it('clears the default model when switched to inherit', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <RolesPanel
        roles={[role]}
        selectedRole={role}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={onSave}
        onDelete={vi.fn()}
      />
    )

    await user.selectOptions(screen.getByLabelText('默认模型'), screen.getByRole('option', { name: '继承调用/父会话模型' }))
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'role-1',
      defaultModelId: ''
    }))
    expect(onSave.mock.calls[0]?.[0].defaultModelRef).toBeUndefined()
  })

  it('confirms before deleting a role', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(
      <RolesPanel
        roles={[role]}
        selectedRole={role}
        tools={tools}
        modelOptions={modelOptions}
        modelOptionGroups={modelOptionGroups}
        onSave={vi.fn()}
        onDelete={onDelete}
      />
    )

    const deleteButton = screen.getByRole('button', { name: '删除角色' })
    expect(deleteButton).toHaveStyle({
      background: themeTokens.color.dangerSoft,
      color: themeTokens.color.dangerStrong
    })
    expect(deleteButton.getAttribute('style')).toContain('border-width: 1px')
    expect(deleteButton.getAttribute('style')).toContain('border-style: solid')
    expect(deleteButton.getAttribute('style')).toContain(`border-color: ${themeTokens.color.danger}`)

    await user.click(deleteButton)

    expect(window.confirm).toHaveBeenCalledWith('确定要删除角色“运维助手”吗？此操作无法撤销。')
    expect(onDelete).toHaveBeenCalledWith('role-1')
  })
})
