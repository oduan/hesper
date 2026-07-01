// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentCoreSettingsPanel } from '../src/agent-core-settings-panel'

const transparentBackgrounds = ['transparent', 'rgba(0, 0, 0, 0)']

describe('AgentCoreSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps both textareas read-only and chromeless until edit is clicked', async () => {
    vi.useRealTimers()
    const onUpdate = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(<AgentCoreSettingsPanel settings={{ soul: '初始身份', agents: '全局 agents' }} onUpdate={onUpdate} />)

    for (const label of ['身份设定', 'Agents 配置']) {
      const textarea = screen.getByLabelText(label)
      const textareaStyle = window.getComputedStyle(textarea)

      expect(textarea).toHaveAttribute('readonly')
      expect(textarea).toHaveAttribute('aria-readonly', 'true')
      expect(textareaStyle.borderTopStyle).toBe('none')
      expect(transparentBackgrounds).toContain(textareaStyle.backgroundColor)
      expect(textareaStyle.resize).toBe('none')
      expect(textarea).toHaveClass('hesper-theme-scrollbar')

      await user.type(textarea, '新增内容')
    }

    expect(screen.getByLabelText('身份设定')).toHaveValue('初始身份')
    expect(screen.getByLabelText('Agents 配置')).toHaveValue('全局 agents')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('enables editing per field and saves only the edited field', async () => {
    vi.useRealTimers()
    const onUpdate = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={onUpdate} />)

    await user.click(screen.getByRole('button', { name: '编辑 Agents' }))

    const agentsTextarea = screen.getByLabelText('Agents 配置')
    const agentsStyle = window.getComputedStyle(agentsTextarea)
    expect(agentsTextarea).not.toHaveAttribute('readonly')
    expect(agentsTextarea).toHaveAttribute('aria-readonly', 'false')
    expect(agentsStyle.borderTopStyle).not.toBe('none')
    expect(transparentBackgrounds).not.toContain(agentsStyle.backgroundColor)
    expect(agentsStyle.resize).toBe('none')

    await user.type(agentsTextarea, '分类 agents')
    expect(agentsTextarea).toHaveValue('分类 agents')

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ agents: '分类 agents' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('debounces idle saves until 300ms elapses after editing is enabled', () => {
    const onUpdate = vi.fn()

    render(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑 Soul' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    expect(onUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(onUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' })
  })

  it('uses the latest onUpdate without postponing an in-flight debounce timer', () => {
    const firstOnUpdate = vi.fn()
    const latestOnUpdate = vi.fn()

    const { rerender } = render(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={firstOnUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑 Soul' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    act(() => {
      vi.advanceTimersByTime(150)
    })

    rerender(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={latestOnUpdate} />)

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(firstOnUpdate).not.toHaveBeenCalled()
    expect(latestOnUpdate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(firstOnUpdate).not.toHaveBeenCalled()
    expect(latestOnUpdate).toHaveBeenCalledTimes(1)
    expect(latestOnUpdate).toHaveBeenCalledWith({ soul: '新的身份' })
  })

  it('flushes immediately on blur, exits editing, and removes textarea chrome', () => {
    const onUpdate = vi.fn()

    render(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑 Agents' }))

    const textarea = screen.getByLabelText('Agents 配置')
    fireEvent.change(textarea, { target: { value: '新的 agents' } })
    fireEvent.blur(textarea)

    const textareaStyle = window.getComputedStyle(textarea)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ agents: '新的 agents' })
    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'true')
    expect(textareaStyle.borderTopStyle).toBe('none')
    expect(transparentBackgrounds).toContain(textareaStyle.backgroundColor)
    expect(textareaStyle.resize).toBe('none')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('syncs drafts when settings change externally', () => {
    const onUpdate = vi.fn()

    const { rerender } = render(<AgentCoreSettingsPanel settings={{ soul: '初始身份', agents: '初始 agents' }} onUpdate={onUpdate} />)

    expect(screen.getByLabelText('身份设定')).toHaveValue('初始身份')
    expect(screen.getByLabelText('Agents 配置')).toHaveValue('初始 agents')

    rerender(<AgentCoreSettingsPanel settings={{ soul: '外部身份', agents: '外部 agents' }} onUpdate={onUpdate} />)

    expect(screen.getByLabelText('身份设定')).toHaveValue('外部身份')
    expect(screen.getByLabelText('Agents 配置')).toHaveValue('外部 agents')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('preserves dirty drafts when settings roll back during an in-flight save', () => {
    const onUpdate = vi.fn()

    const { rerender } = render(<AgentCoreSettingsPanel settings={{ soul: '旧身份', agents: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑 Soul' }))

    const textarea = screen.getByLabelText('身份设定')
    expect(textarea).toHaveValue('旧身份')

    fireEvent.change(textarea, { target: { value: '第一次编辑' } })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ soul: '第一次编辑' })

    rerender(<AgentCoreSettingsPanel settings={{ soul: '第一次编辑', agents: '' }} onUpdate={onUpdate} />)
    expect(textarea).toHaveValue('第一次编辑')

    fireEvent.change(textarea, { target: { value: '第二次编辑' } })

    rerender(<AgentCoreSettingsPanel settings={{ soul: '旧身份', agents: '' }} onUpdate={onUpdate} />)

    expect(textarea).toHaveValue('第二次编辑')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenLastCalledWith({ soul: '第二次编辑' })
  })

  it('keeps textareas capped with themed scrollbars and no native resize handle', () => {
    render(<AgentCoreSettingsPanel settings={{ soul: '', agents: '' }} onUpdate={vi.fn()} />)

    const panel = screen.getByRole('region', { name: 'Agent Core 设置面板' })
    const soulTextarea = screen.getByLabelText('身份设定')
    const agentsTextarea = screen.getByLabelText('Agents 配置')

    expect(window.getComputedStyle(panel).overflowY).toBe('auto')
    for (const textarea of [soulTextarea, agentsTextarea]) {
      expect(window.getComputedStyle(textarea).resize).toBe('none')
      expect(window.getComputedStyle(textarea).overflowY).toBe('auto')
      expect(textarea).toHaveClass('hesper-theme-scrollbar')
    }

    fireEvent.click(screen.getByRole('button', { name: '编辑 Soul' }))
    expect(soulTextarea).toHaveStyle({ minHeight: 'min(420px, calc(100vh - 220px))', maxHeight: 'min(420px, calc(100vh - 220px))', overflowY: 'auto' })
  })
})
