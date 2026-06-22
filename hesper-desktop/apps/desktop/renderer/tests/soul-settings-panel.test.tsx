// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoulSettingsPanel } from '../src/soul-settings-panel'

const transparentBackgrounds = ['transparent', 'rgba(0, 0, 0, 0)']

describe('SoulSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps the textarea read-only and chromeless until edit is clicked', async () => {
    vi.useRealTimers()
    const onUpdate = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(<SoulSettingsPanel settings={{ soul: '初始身份' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    const textareaStyle = window.getComputedStyle(textarea)

    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'true')
    expect(textareaStyle.borderTopStyle).toBe('none')
    expect(transparentBackgrounds).toContain(textareaStyle.backgroundColor)
    expect(textareaStyle.resize).toBe('none')

    await user.type(textarea, '新的身份')

    expect(textarea).toHaveValue('初始身份')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('shows textarea chrome and enables editing after clicking edit', async () => {
    vi.useRealTimers()
    const onUpdate = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    const editButton = screen.getByRole('button', { name: '编辑' })
    const textarea = screen.getByLabelText('身份设定')

    expect(editButton).toHaveAccessibleName('编辑')
    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'true')

    await user.click(editButton)

    const textareaStyle = window.getComputedStyle(textarea)
    expect(textarea).not.toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'false')
    expect(textareaStyle.borderTopStyle).not.toBe('none')
    expect(transparentBackgrounds).not.toContain(textareaStyle.backgroundColor)
    expect(textareaStyle.resize).toBe('none')

    await user.type(textarea, '新的身份')
    expect(textarea).toHaveValue('新的身份')

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('debounces idle saves until 300ms elapses after editing is enabled', () => {
    const onUpdate = vi.fn()

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

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

    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={firstOnUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    act(() => {
      vi.advanceTimersByTime(150)
    })

    rerender(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={latestOnUpdate} />)

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

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })
    fireEvent.blur(textarea)

    const textareaStyle = window.getComputedStyle(textarea)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' })
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

  it('cleans up pending saves on unmount', () => {
    const onUpdate = vi.fn()

    const { unmount } = render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })

    unmount()

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('syncs the draft when settings.soul changes externally', () => {
    const onUpdate = vi.fn()

    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '初始身份' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    expect(textarea).toHaveValue('初始身份')

    rerender(<SoulSettingsPanel settings={{ soul: '外部同步身份' }} onUpdate={onUpdate} />)

    expect(textarea).toHaveValue('外部同步身份')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('preserves dirty drafts when settings.soul rolls back during an in-flight save', () => {
    const onUpdate = vi.fn()

    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '旧身份' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const textarea = screen.getByLabelText('身份设定')
    expect(textarea).toHaveValue('旧身份')

    fireEvent.change(textarea, { target: { value: '第一次编辑' } })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenLastCalledWith({ soul: '第一次编辑' })

    rerender(<SoulSettingsPanel settings={{ soul: '第一次编辑' }} onUpdate={onUpdate} />)
    expect(textarea).toHaveValue('第一次编辑')

    fireEvent.change(textarea, { target: { value: '第二次编辑' } })

    rerender(<SoulSettingsPanel settings={{ soul: '旧身份' }} onUpdate={onUpdate} />)

    expect(textarea).toHaveValue('第二次编辑')

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenLastCalledWith({ soul: '第二次编辑' })
  })

  it('keeps textarea overflow hidden and lets the SOUL page own scrolling', () => {
    const { rerender } = render(<SoulSettingsPanel settings={{ soul: '短身份' }} onUpdate={vi.fn()} />)

    const panel = screen.getByRole('region', { name: 'SOUL 设置面板' })
    const textarea = screen.getByLabelText('身份设定') as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 720 })

    rerender(<SoulSettingsPanel settings={{ soul: Array.from({ length: 40 }, (_, index) => `身份设定第 ${index + 1} 行`).join('\n') }} onUpdate={vi.fn()} />)

    expect(window.getComputedStyle(panel).overflowY).toBe('auto')
    expect(window.getComputedStyle(textarea).overflowY).toBe('hidden')
    expect(textarea.style.height).toBe('720px')
  })
  it('makes the editing textarea taller while keeping page-level scrolling', () => {
    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={vi.fn()} />)

    const textarea = screen.getByLabelText('身份设定')
    expect(window.getComputedStyle(textarea).resize).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const panel = screen.getByRole('region', { name: 'SOUL 设置面板' })

    expect(window.getComputedStyle(textarea).resize).toBe('none')
    expect(window.getComputedStyle(panel).overflowY).toBe('auto')
    expect(textarea).toHaveStyle({ minHeight: 'min(420px, calc(100vh - 220px))', overflowY: 'hidden' })
  })
})
