// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoulSettingsPanel } from '../src/soul-settings-panel'

describe('SoulSettingsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('keeps the textarea read-only until edit is clicked', async () => {
    vi.useRealTimers()
    const onUpdate = vi.fn()
    const user = userEvent.setup({ delay: null })

    render(<SoulSettingsPanel settings={{ soul: '初始身份' }} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText('身份设定')
    expect(textarea).toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'true')

    await user.type(textarea, '新的身份')

    expect(textarea).toHaveValue('初始身份')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('shows an edit button next to the label and enables editing after click', async () => {
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

    expect(textarea).not.toHaveAttribute('readonly')
    expect(textarea).toHaveAttribute('aria-readonly', 'false')

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

  it('flushes immediately on blur without waiting for the debounce window', () => {
    const onUpdate = vi.fn()

    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))

    const textarea = screen.getByLabelText('身份设定')
    fireEvent.change(textarea, { target: { value: '新的身份' } })
    fireEvent.blur(textarea)

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ soul: '新的身份' })

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

  it('renders the soul field without borders while keeping a filled, non-resizable textarea', () => {
    render(<SoulSettingsPanel settings={{ soul: '' }} onUpdate={vi.fn()} />)

    const textarea = screen.getByLabelText('身份设定')
    const textareaStyle = window.getComputedStyle(textarea)
    expect(textareaStyle.borderTopStyle).toBe('none')
    expect(['transparent', 'rgba(0, 0, 0, 0)']).not.toContain(textareaStyle.backgroundColor)
    expect(textareaStyle.paddingLeft).toBe('0px')
    expect(textareaStyle.paddingRight).toBe('0px')
    expect(textareaStyle.resize).toBe('none')

    const fieldWrapper = textarea.parentElement
    expect(fieldWrapper).not.toBeNull()

    const fieldWrapperStyle = window.getComputedStyle(fieldWrapper as HTMLElement)
    expect(fieldWrapperStyle.borderTopStyle).toBe('none')
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(fieldWrapperStyle.backgroundColor)
    expect(['0px', '0']).toContain(fieldWrapperStyle.paddingLeft)
    expect(['0px', '0']).toContain(fieldWrapperStyle.paddingRight)
  })
})
