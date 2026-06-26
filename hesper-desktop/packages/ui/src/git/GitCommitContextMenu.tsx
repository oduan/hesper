import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { themeTokens } from '../theme'

const menuWidth = 220
const menuHeight = 190
const viewportMargin = 8

export type GitCommitContextMenuProps = {
  commitHash: string
  x: number
  y: number
  onClose: (restoreFocus?: boolean) => void
  onCreateBranch: (commitHash: string) => void
  onCreateTag: (commitHash: string) => void
  onCheckout: (ref: string) => void
  onCopyCommitId?: ((commitHash: string) => void) | undefined
  onViewDetail: (commitHash: string) => void
}

export function GitCommitContextMenu({
  commitHash,
  x,
  y,
  onClose,
  onCreateBranch,
  onCreateTag,
  onCheckout,
  onCopyCommitId,
  onViewDetail
}: GitCommitContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const position = useMemo(() => clampMenuPosition(x, y), [x, y])

  useEffect(() => {
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    firstItem?.focus()
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose(false)
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    document.addEventListener('focusin', handleFocusIn, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      document.removeEventListener('focusin', handleFocusIn, { capture: true })
    }
  }, [onClose])

  const runAction = (action: () => void) => {
    action()
    onClose(false)
  }

  const copyCommitId = () => {
    if (onCopyCommitId) {
      onCopyCommitId(commitHash)
      return
    }

    void navigator.clipboard?.writeText(commitHash)
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="提交操作"
      style={{ ...menuStyle, left: position.x, top: position.y, width: menuWidth }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      <MenuItem onClick={() => runAction(() => onCreateBranch(commitHash))}>从选中提交新建分支</MenuItem>
      <MenuItem onClick={() => runAction(() => onCreateTag(commitHash))}>创建标签</MenuItem>
      <MenuItem onClick={() => runAction(() => onCheckout(commitHash))}>检出此提交</MenuItem>
      <MenuItem onClick={() => runAction(copyCommitId)}>复制 Commit ID</MenuItem>
      <MenuItem onClick={() => runAction(() => onViewDetail(commitHash))}>查看提交详情</MenuItem>
    </div>
  )
}

type MenuItemProps = {
  children: string
  onClick: () => void
}

function MenuItem({ children, onClick }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" style={menuItemStyle} onClick={onClick}>
      {children}
    </button>
  )
}

const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

  event.preventDefault()
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  if (items.length === 0) return

  const currentIndex = Math.max(0, items.findIndex((item) => item === document.activeElement))
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : event.key === 'ArrowDown'
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length

  items[nextIndex]?.focus()
}

const clampMenuPosition = (x: number, y: number) => {
  const maxX = Math.max(viewportMargin, window.innerWidth - menuWidth - viewportMargin)
  const maxY = Math.max(viewportMargin, window.innerHeight - menuHeight - viewportMargin)

  return {
    x: Math.min(Math.max(viewportMargin, x), maxX),
    y: Math.min(Math.max(viewportMargin, y), maxY)
  }
}

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1100,
  minWidth: menuWidth,
  padding: themeTokens.spacing.xs,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: themeTokens.color.border,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.text,
  boxShadow: `0 18px 48px ${themeTokens.color.shadow}`,
  display: 'grid',
  gap: 2
}

const menuItemStyle: CSSProperties = {
  width: '100%',
  border: 0,
  borderRadius: themeTokens.radius.sm,
  background: 'transparent',
  color: themeTokens.color.text,
  cursor: 'pointer',
  font: 'inherit',
  padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
  textAlign: 'left'
}
