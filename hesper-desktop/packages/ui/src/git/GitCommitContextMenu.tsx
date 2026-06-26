import type { CSSProperties } from 'react'
import { themeTokens } from '../theme'

export type GitCommitContextMenuProps = {
  commitHash: string
  x: number
  y: number
  onClose: () => void
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
  const runAction = (action: () => void) => {
    action()
    onClose()
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
      role="menu"
      aria-label="提交操作"
      style={{ ...menuStyle, left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
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

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1100,
  minWidth: 196,
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
