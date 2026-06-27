import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import { createId, type ModelCapability, type ModelThinkingLevel } from '@hesper/shared'
import { themeTokens } from '../theme'
import { ThemedSelect, type ThemedSelectOptionGroup } from './ThemedSelect'

export type ModelOptionGroup = ThemedSelectOptionGroup

export type SkillOption = {
  id: string
  name: string
  description?: string
}

export type ComposerThinkingLevel = ModelThinkingLevel

export type ComposerDraftAttachment =
  | { id: string; kind: 'image'; name: string; mimeType: string; bytes: number; dataUrl: string }
  | { id: string; kind: 'text'; name: string; mimeType: string; bytes: number; content: string }

export type ComposerSendOptions = {
  prompt?: string
  displayPrompt?: string
  thinkingLevel?: ComposerThinkingLevel
  draftAttachments?: ComposerDraftAttachment[]
}

export type ComposerSkillMention = {
  start: number
  end: number
  skill: SkillOption
}

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  skillOptions?: SkillOption[]
  skillMentions?: ComposerSkillMention[]
  value?: string
  running?: boolean
  sendDisabled?: boolean
  sendDisabledReason?: string
  modelCapabilities?: ModelCapability[]
  attachments?: ComposerDraftAttachment[]
  onDraftChange?: (value: string) => void
  onAttachmentsChange?: (attachments: ComposerDraftAttachment[]) => void
  onSkillMentionsChange?: (mentions: ComposerSkillMention[]) => void
  onSend: (content: string, options?: ComposerSendOptions) => void
  onStop?: () => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  sendSignal?: number
}

type MentionToken = {
  start: number
  end: number
  query: string
}

type SkillMentionRange = ComposerSkillMention

type ComposerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'skill'; text: string; skill: SkillOption }

const emptyModelLabel = '未配置模型'
const composerThinkingLevelStorageKey = 'hesper.composer.thinkingLevel'
const defaultComposerThinkingLevel: ComposerThinkingLevel = 'high'
const composerThinkingLevelOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' }
] satisfies Array<{ value: ComposerThinkingLevel; label: string }>
const maxComposerAttachmentBatchSize = 10
const maxComposerImageAttachmentBytes = 10 * 1024 * 1024
const maxComposerTextAttachmentBytes = 1024 * 1024
const clipboardItemMimeTypes = new WeakMap<File, string>()
const composerTextareaMinRows = 4
const composerTextareaMaxRows = 15
const composerTextareaFallbackFontSize = 14
const composerTextareaFallbackLineHeight = 1.5
const composerTextareaFallbackMinHeight = 96

export function Composer({
  workspacePath,
  modelId,
  modelOptions,
  modelOptionGroups,
  skillOptions = [],
  skillMentions: controlledSkillMentions,
  value: controlledValue,
  running = false,
  sendDisabled = false,
  sendDisabledReason,
  modelCapabilities,
  attachments = [],
  onDraftChange,
  onAttachmentsChange,
  onSkillMentionsChange,
  onSend,
  onStop,
  onSelectWorkspace,
  onModelChange,
  sendSignal = 0
}: ComposerProps) {
  const [internalValue, setInternalValue] = useState('')
  const [selectionStart, setSelectionStart] = useState(0)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const [dismissedMentionStart, setDismissedMentionStart] = useState<number>()
  const [textareaScroll, setTextareaScroll] = useState({ top: 0, left: 0 })
  const [internalSkillMentions, setInternalSkillMentions] = useState<SkillMentionRange[]>([])
  const [thinkingLevel, setThinkingLevel] = useState<ComposerThinkingLevel>(() => readStoredComposerThinkingLevel())
  const [draggingFiles, setDraggingFiles] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const value = controlledValue ?? internalValue
  const selectedSkillMentions = controlledSkillMentions ?? internalSkillMentions
  // sendSignal is edge-triggered; a non-zero value present at mount is historical and must not replay.
  const lastHandledSendSignalRef = useRef(sendSignal)
  const attachmentsRef = useRef(attachments)
  const mountedRef = useRef(true)
  const attachmentMutationVersionRef = useRef(0)
  const imageInputSupported = composerSupportsImageInput(modelCapabilities)
  const visibleAttachments = useMemo(() => visibleComposerAttachments(attachments, imageInputSupported), [attachments, imageInputSupported])
  const resolvedModelOptions = useMemo(() => modelOptions ?? (modelId.trim() ? [modelId] : []), [modelId, modelOptions])
  const hasConfiguredModel = modelId.trim().length > 0
  const canSend = useMemo(() => value.trim().length > 0 || visibleAttachments.length > 0, [value, visibleAttachments])
  const isSendDisabled = sendDisabled || !hasConfiguredModel
  const mentionToken = useMemo(() => findMentionToken(value, selectionStart), [selectionStart, value])
  const skillMentionRanges = useMemo(() => normalizeSkillMentionRanges(value, selectedSkillMentions), [selectedSkillMentions, value])
  const composerSegments = useMemo(() => createComposerSegments(value, skillMentionRanges), [skillMentionRanges, value])
  const hasSkillMentionPills = skillMentionRanges.length > 0
  const filteredSkills = useMemo(() => {
    if (!mentionToken || skillOptions.length === 0) return []
    const query = mentionToken.query.toLocaleLowerCase()
    return skillOptions.filter((skill) => skill.name.toLocaleLowerCase().includes(query))
  }, [mentionToken, skillOptions])
  const showSkillMenu = Boolean(mentionToken && mentionToken.start !== dismissedMentionStart && filteredSkills.length > 0)
  const selectedThinkingLevelLabel = composerThinkingLevelOptions.find((option) => option.value === thinkingLevel)?.label ?? '高'
  const workspaceDisplayName = useMemo(() => formatWorkspaceDisplayName(workspacePath), [workspacePath])

  const syncTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const minHeight = resolveComposerTextareaMinHeight(textarea)
    const maxHeight = resolveComposerTextareaMaxHeight(textarea)
    const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))

    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  const setComposerValue = useCallback((nextValue: string, nextSkillMentions?: SkillMentionRange[]) => {
    if (controlledValue === undefined) {
      setInternalValue(nextValue)
    }
    const resolvedSkillMentions = nextSkillMentions ?? (nextValue.length === 0 ? [] : undefined)
    if (resolvedSkillMentions !== undefined) {
      if (controlledSkillMentions === undefined) {
        setInternalSkillMentions(resolvedSkillMentions)
      }
      onSkillMentionsChange?.(resolvedSkillMentions)
    }
    onDraftChange?.(nextValue)
    setDismissedMentionStart(undefined)
  }, [controlledSkillMentions, controlledValue, onDraftChange, onSkillMentionsChange])

  const updateSelectionStart = useCallback(() => {
    setSelectionStart(textareaRef.current?.selectionStart ?? 0)
  }, [])

  const focusTextarea = useCallback((cursor?: number) => {
    window.setTimeout(() => {
      textareaRef.current?.focus()
      if (cursor !== undefined) {
        textareaRef.current?.setSelectionRange(cursor, cursor)
        setSelectionStart(cursor)
      }
    }, 0)
  }, [])

  const handleThinkingLevelChange = useCallback((nextValue: string) => {
    if (!isComposerThinkingLevel(nextValue)) {
      return
    }
    setThinkingLevel(nextValue)
    writeStoredComposerThinkingLevel(nextValue)
  }, [])

  const appendAttachments = useCallback((nextAttachments: ComposerDraftAttachment[], readVersion: number) => {
    if (nextAttachments.length === 0 || !mountedRef.current || readVersion !== attachmentMutationVersionRef.current) return
    const mergedAttachments = [...attachmentsRef.current, ...nextAttachments]
    attachmentsRef.current = mergedAttachments
    onAttachmentsChange?.(mergedAttachments)
  }, [onAttachmentsChange])

  const replaceAttachmentsAfterDestructiveMutation = useCallback((nextAttachments: ComposerDraftAttachment[]) => {
    attachmentMutationVersionRef.current += 1
    attachmentsRef.current = nextAttachments
    onAttachmentsChange?.(nextAttachments)
  }, [onAttachmentsChange])

  const removeAttachment = useCallback((attachmentId: string) => {
    replaceAttachmentsAfterDestructiveMutation(attachmentsRef.current.filter((attachment) => attachment.id !== attachmentId))
  }, [replaceAttachmentsAfterDestructiveMutation])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const supportedFiles = getClipboardFiles(event.clipboardData)
      .filter(isSupportedDraftAttachmentFile)
      .slice(0, maxComposerAttachmentBatchSize)
    if (supportedFiles.length === 0) return

    event.preventDefault()
    const readVersion = attachmentMutationVersionRef.current
    void readDraftAttachments(supportedFiles, readDraftAttachmentFromFile).then((nextAttachments) => appendAttachments(nextAttachments, readVersion))
  }, [appendAttachments])

  const handleDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return
    event.preventDefault()
    setDraggingFiles(true)
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return
    event.preventDefault()
    setDraggingFiles(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDraggingFiles(false)
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!hasDataTransferFiles(event.dataTransfer)) return
    event.preventDefault()
    setDraggingFiles(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    const supportedFiles = files
      .filter(isSupportedDraftAttachmentFile)
      .slice(0, maxComposerAttachmentBatchSize)
    if (supportedFiles.length === 0) return

    const readVersion = attachmentMutationVersionRef.current
    void readDraftAttachments(supportedFiles, readDraftAttachmentFromFile).then((nextAttachments) => appendAttachments(nextAttachments, readVersion))
  }, [appendAttachments])

  const confirmSkill = useCallback((skill: SkillOption) => {
    if (!mentionToken) return
    const mentionText = createSkillMentionText(skill)
    const replacement = `${mentionText} `
    const nextValue = `${value.slice(0, mentionToken.start)}${replacement}${value.slice(mentionToken.end)}`
    const cursor = mentionToken.start + replacement.length
    const shiftedMentions = adjustSkillMentionRanges(value, nextValue, skillMentionRanges, mentionToken.start, mentionToken.end)
    const nextSkillMentions = insertSkillMentionRange(shiftedMentions, {
      start: mentionToken.start,
      end: mentionToken.start + mentionText.length,
      skill
    })
    setComposerValue(nextValue, nextSkillMentions)
    setActiveSkillIndex(0)
    setDismissedMentionStart(undefined)
    focusTextarea(cursor)
  }, [focusTextarea, mentionToken, setComposerValue, skillMentionRanges, value])

  const deleteSkillMentionAtSelection = useCallback((key: 'Backspace' | 'Delete') => {
    const textarea = textareaRef.current
    if (!textarea) return false

    const deletion = createSkillMentionDeletion(value, textarea.selectionStart, textarea.selectionEnd, key, skillMentionRanges)
    if (!deletion) return false

    const nextSkillMentions = adjustSkillMentionRanges(value, deletion.value, skillMentionRanges, deletion.start, deletion.end)
    setComposerValue(deletion.value, nextSkillMentions)
    setActiveSkillIndex(0)
    setDismissedMentionStart(undefined)
    focusTextarea(deletion.cursor)
    return true
  }, [focusTextarea, setComposerValue, skillMentionRanges, value])

  const handleSend = useCallback(() => {
    if (running) {
      onStop?.()
      return
    }

    if (isSendDisabled) {
      return
    }

    const content = value.trim()
    const currentAttachments = attachmentsRef.current
    const sendableAttachments = visibleComposerAttachments(currentAttachments, imageInputSupported)
    if (!content && sendableAttachments.length === 0) {
      return
    }

    const injectedPrompt = createInjectedPrompt(content, skillOptions)
    const baseSendOptions = {
      thinkingLevel,
      ...(sendableAttachments.length > 0 ? { draftAttachments: sendableAttachments } : {})
    } satisfies ComposerSendOptions
    if (injectedPrompt && injectedPrompt !== content) {
      onSend(content, { ...baseSendOptions, prompt: injectedPrompt, displayPrompt: content })
    } else {
      onSend(content, baseSendOptions)
    }
    setComposerValue('', [])
    if (sendableAttachments.length > 0) {
      const sentAttachmentIds = new Set(sendableAttachments.map((attachment) => attachment.id))
      replaceAttachmentsAfterDestructiveMutation(currentAttachments.filter((attachment) => !sentAttachmentIds.has(attachment.id)))
    } else {
      attachmentMutationVersionRef.current += 1
    }
    setActiveSkillIndex(0)
  }, [imageInputSupported, isSendDisabled, onSend, onStop, replaceAttachmentsAfterDestructiveMutation, running, setComposerValue, skillOptions, thinkingLevel, value])

  useLayoutEffect(() => {
    syncTextareaHeight()
  }, [syncTextareaHeight, value])

  useEffect(() => {
    window.addEventListener('resize', syncTextareaHeight)
    return () => window.removeEventListener('resize', syncTextareaHeight)
  }, [syncTextareaHeight])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => () => {
    mountedRef.current = false
    attachmentMutationVersionRef.current += 1
  }, [])

  useEffect(() => {
    if (sendSignal <= 0 || sendSignal === lastHandledSendSignalRef.current) {
      return
    }

    lastHandledSendSignalRef.current = sendSignal
    handleSend()
  }, [handleSend, sendSignal])

  useEffect(() => {
    if (activeSkillIndex >= filteredSkills.length) {
      setActiveSkillIndex(0)
    }
  }, [activeSkillIndex, filteredSkills.length])

  useEffect(() => {
    if (!showSkillMenu) return
    skillOptionRefs.current[activeSkillIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeSkillIndex, filteredSkills.length, showSkillMenu])

  return (
    <section
      aria-label="消息输入区"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'grid',
        gap: themeTokens.spacing.sm,
        border: 0,
        borderRadius: themeTokens.radius.xl,
        background: themeTokens.color.surfaceMuted,
        boxShadow: `0 2px 6px -3px ${themeTokens.color.shadow}`,
        padding: themeTokens.spacing.md,
        position: 'relative'
      }}
    >
      {showSkillMenu ? (
        <>
          <style>{skillMenuScrollbarCss}</style>
          <div role="listbox" aria-label="技能提及建议" className="hesper-skill-mention-menu" style={skillMenuStyle}>
          {filteredSkills.map((skill, index) => {
            const selected = index === activeSkillIndex
            const label = skill.description ? `选择技能 ${skill.name}：${skill.description}` : `选择技能 ${skill.name}`
            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-label={label}
                aria-selected={selected}
                className="hesper-skill-mention-option"
                ref={(node) => {
                  skillOptionRefs.current[index] = node
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => confirmSkill(skill)}
                style={{
                  ...skillOptionStyle,
                  ...(selected ? skillOptionSelectedStyle : {})
                }}
              >
                <span style={skillNameStyle}>{skill.name}</span>
              </button>
            )
          })}
          </div>
        </>
      ) : null}
      {draggingFiles || visibleAttachments.length > 0 ? (
        <div aria-label="附件预览" style={attachmentPreviewAreaStyle}>
          {draggingFiles ? <div style={attachmentDropHintStyle}>松开即可添加附件</div> : null}
          {visibleAttachments.map((attachment) => attachment.kind === 'image' ? (
            <div key={attachment.id} style={imageAttachmentPreviewStyle}>
              <img src={attachment.dataUrl} alt="图片附件预览" style={imageAttachmentThumbnailStyle} />
              <button
                type="button"
                aria-label="移除图片附件"
                onClick={() => removeAttachment(attachment.id)}
                style={attachmentRemoveButtonStyle}
              >
                ×
              </button>
            </div>
          ) : (
            <div key={attachment.id} style={textAttachmentPreviewStyle}>
              <span style={textAttachmentNameStyle}>{attachment.name}</span>
              <span style={textAttachmentMetaStyle}>{formatAttachmentMeta(attachment)}</span>
              <button
                type="button"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => removeAttachment(attachment.id)}
                style={textAttachmentRemoveButtonStyle}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div style={editorWrapperStyle}>
        {hasSkillMentionPills ? (
          <div aria-hidden="true" style={{ ...highlightMirrorStyle, transform: `translate(${-textareaScroll.left}px, ${-textareaScroll.top}px)` }}>
            {composerSegments.map((segment, index) => segment.kind === 'skill' ? (
              <span key={`${segment.skill.id}-${index}`} data-skill-mention-pill="true" style={skillMentionPillStyle}>{segment.text}</span>
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            ))}
          </div>
        ) : null}
        {hasSkillMentionPills ? <style>{skillMentionSelectionCss}</style> : null}
        <textarea
          ref={textareaRef}
          className={hasSkillMentionPills ? 'hesper-theme-scrollbar hesper-skill-mention-textarea' : 'hesper-theme-scrollbar'}
          aria-label="消息输入框"
          placeholder="输入消息，支持 @skills"
          rows={4}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            const nextValue = event.target.value
            setComposerValue(nextValue, adjustSkillMentionRanges(value, nextValue, skillMentionRanges))
            setSelectionStart(event.target.selectionStart)
          }}
          onClick={updateSelectionStart}
          onKeyUp={updateSelectionStart}
          onSelect={updateSelectionStart}
          onPaste={handlePaste}
          onScroll={(event) => setTextareaScroll({
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft
          })}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.key === 'Backspace' || event.key === 'Delete') && deleteSkillMentionAtSelection(event.key)) {
              event.preventDefault()
              return
            }
            if (showSkillMenu) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveSkillIndex((index) => (index + 1) % filteredSkills.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveSkillIndex((index) => (index <= 0 ? filteredSkills.length - 1 : index - 1))
                return
              }
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                event.preventDefault()
                const skill = filteredSkills[activeSkillIndex]
                if (skill) confirmSkill(skill)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissedMentionStart(mentionToken?.start)
                setActiveSkillIndex(0)
                return
              }
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              handleSend()
            }
          }}
          style={{
            ...textareaStyle,
            ...(hasSkillMentionPills ? skillMentionTextareaStyle : {})
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: themeTokens.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hesper-soft-control"
          aria-label={`选择文件夹：${workspaceDisplayName}`}
          onClick={() => onSelectWorkspace?.()}
          style={{ ...controlButtonStyle, ...workspaceButtonStyle }}
        >
          <svg data-hesper-workspace-icon="empty-house" aria-hidden="true" viewBox="0 0 16 16" style={workspaceIconStyle}>
            <path d="M2.75 7.1 8 2.85l5.25 4.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.45 6.9v5.25h7.1V6.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6.65 12.15V9.05h2.7v3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <span style={workspaceLabelStyle}>{workspaceDisplayName}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: themeTokens.spacing.xs, flexWrap: 'wrap' }}>
          <div style={modelControlStyle}>
            <ThemedSelect
              ariaLabel="选择模型"
              value={modelId}
              options={resolvedModelOptions}
              emptyLabel={emptyModelLabel}
              {...(modelOptionGroups ? { optionGroups: modelOptionGroups } : {})}
              auxiliaryMenu={{
                label: '思考强度',
                ariaLabel: '思考强度选项',
                value: thinkingLevel,
                valueLabel: selectedThinkingLevelLabel,
                options: composerThinkingLevelOptions,
                onChange: handleThinkingLevelChange
              }}
              {...(onModelChange ? { onChange: onModelChange } : {})}
              minWidth={0}
              maxWidth={240}
              menuPlacement="top"
            />
          </div>
          <button
            type="button"
            className="hesper-send-button"
            aria-label={running ? '停止' : '发送'}
            title={!running && isSendDisabled ? sendDisabledReason ?? emptyModelLabel : undefined}
            disabled={!running && (!canSend || isSendDisabled)}
            onClick={handleSend}
            style={{
              ...sendButtonStyle,
              opacity: running || (canSend && !isSendDisabled) ? 1 : 0.45,
              cursor: running || (canSend && !isSendDisabled) ? 'pointer' : 'not-allowed'
            }}
          >
            {running ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <path d="M12 17V7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M6.5 12.5 12 7l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

export function composerSupportsImageInput(capabilities?: ModelCapability[]): boolean {
  return capabilities?.includes('imageInput') === true
}

export function visibleComposerAttachments(attachments: ComposerDraftAttachment[], imageInputSupported: boolean): ComposerDraftAttachment[] {
  return attachments.filter((attachment) => attachment.kind !== 'image' || imageInputSupported)
}

function createAttachmentId(): string {
  return createId('attachment' as Parameters<typeof createId>[0])
}

function getClipboardFiles(dataTransfer: DataTransfer): File[] {
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      if (!file) return []
      rememberClipboardItemMimeType(file, item.type)
      return [file]
    })
  if (itemFiles.length > 0) return itemFiles

  return Array.from(dataTransfer.files ?? [])
}

function rememberClipboardItemMimeType(file: File, mimeType: string): void {
  if (file.type || !mimeType) return
  clipboardItemMimeTypes.set(file, mimeType)
}

function effectiveAttachmentMimeType(file: File): string {
  return file.type || clipboardItemMimeTypes.get(file) || ''
}

function hasDataTransferFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files') || (dataTransfer.files?.length ?? 0) > 0
}

function isSupportedDraftAttachmentFile(file: File): boolean {
  return isSupportedImageAttachmentFile(file) || isSupportedTextAttachmentFile(file)
}

function isSupportedImageAttachmentFile(file: File): boolean {
  return effectiveAttachmentMimeType(file).startsWith('image/') && file.size <= maxComposerImageAttachmentBytes
}

function isSupportedTextAttachmentFile(file: File): boolean {
  const lowerName = file.name.toLocaleLowerCase()
  const supportedExtension = ['.txt', '.md', '.markdown', '.html', '.htm'].some((extension) => lowerName.endsWith(extension))
  return supportedExtension && isTextLikeAttachmentMimeType(effectiveAttachmentMimeType(file)) && file.size <= maxComposerTextAttachmentBytes
}

function isTextLikeAttachmentMimeType(mimeType: string): boolean {
  return mimeType.length === 0 || mimeType.startsWith('text/')
}

async function readDraftAttachments(files: File[], readFile: (file: File) => Promise<ComposerDraftAttachment | undefined>): Promise<ComposerDraftAttachment[]> {
  const results = await Promise.allSettled(files.map(readFile))
  return results.flatMap((result) => (
    result.status === 'fulfilled' && result.value ? [result.value] : []
  ))
}

async function readDraftAttachmentFromFile(file: File): Promise<ComposerDraftAttachment | undefined> {
  if (isSupportedImageAttachmentFile(file)) {
    return readImageDraftAttachment(file)
  }
  if (isSupportedTextAttachmentFile(file)) {
    return {
      id: createAttachmentId(),
      kind: 'text',
      name: file.name,
      mimeType: effectiveAttachmentMimeType(file) || inferTextAttachmentMimeType(file.name),
      bytes: file.size,
      content: await file.text()
    }
  }
  return undefined
}

function readImageDraftAttachment(file: File): Promise<ComposerDraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const mimeType = effectiveAttachmentMimeType(file) || 'application/octet-stream'
    reader.addEventListener('load', () => {
      const dataUrl = typeof reader.result === 'string' ? normalizeImageDataUrlMimeType(reader.result, mimeType) : ''
      resolve({
        id: createAttachmentId(),
        kind: 'image',
        name: file.name,
        mimeType,
        bytes: file.size,
        dataUrl
      })
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取图片附件失败')))
    reader.readAsDataURL(file)
  })
}

function normalizeImageDataUrlMimeType(dataUrl: string, mimeType: string): string {
  if (!mimeType.startsWith('image/')) return dataUrl
  return dataUrl.replace(/^data:[^;,]*(;base64,)/u, `data:${mimeType}$1`)
}

function inferTextAttachmentMimeType(name: string): string {
  const lowerName = name.toLocaleLowerCase()
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) return 'text/markdown'
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'text/html'
  return 'text/plain'
}

function formatAttachmentMeta(attachment: ComposerDraftAttachment): string {
  const size = attachment.bytes < 1024 ? `${attachment.bytes} B` : `${Math.round(attachment.bytes / 1024)} KB`
  return `${attachment.mimeType || 'text/plain'} · ${size}`
}

function formatWorkspaceDisplayName(workspacePath?: string): string {
  const trimmed = workspacePath?.trim()
  if (!trimmed) {
    return '未设置'
  }

  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, '')
  const normalized = withoutTrailingSeparators || trimmed
  const segments = normalized.split(/[\\/]/u).filter(Boolean)
  return segments.at(-1) ?? normalized
}

function resolveComposerTextareaMinHeight(textarea: HTMLTextAreaElement): number {
  const computedStyle = window.getComputedStyle(textarea)
  const cssMinHeight = parseCssPixelValue(computedStyle.minHeight, composerTextareaFallbackMinHeight)
  const rowMinHeight = resolveComposerTextareaLineHeight(computedStyle) * composerTextareaMinRows
  return Math.max(composerTextareaFallbackMinHeight, cssMinHeight, rowMinHeight)
}

function resolveComposerTextareaMaxHeight(textarea: HTMLTextAreaElement): number {
  const computedStyle = window.getComputedStyle(textarea)
  const lineHeight = resolveComposerTextareaLineHeight(computedStyle)
  const verticalPadding = parseCssPixelValue(computedStyle.paddingTop) + parseCssPixelValue(computedStyle.paddingBottom)
  const borderBoxExtra = Math.max(0, textarea.offsetHeight - textarea.clientHeight)
  return Math.ceil(lineHeight * composerTextareaMaxRows + verticalPadding + borderBoxExtra)
}

function resolveComposerTextareaLineHeight(computedStyle: CSSStyleDeclaration): number {
  const fontSize = parseCssPixelValue(computedStyle.fontSize, composerTextareaFallbackFontSize)
  const rawLineHeight = computedStyle.lineHeight.trim()
  const parsedLineHeight = Number.parseFloat(rawLineHeight)

  if (!Number.isFinite(parsedLineHeight) || parsedLineHeight <= 0) {
    return fontSize * composerTextareaFallbackLineHeight
  }

  return rawLineHeight.endsWith('px') ? parsedLineHeight : parsedLineHeight * fontSize
}

function parseCssPixelValue(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isComposerThinkingLevel(value: string): value is ComposerThinkingLevel {
  return composerThinkingLevelOptions.some((option) => option.value === value)
}

function readStoredComposerThinkingLevel(): ComposerThinkingLevel {
  if (typeof window === 'undefined') {
    return defaultComposerThinkingLevel
  }
  try {
    const stored = window.localStorage.getItem(composerThinkingLevelStorageKey)
    return stored && isComposerThinkingLevel(stored) ? stored : defaultComposerThinkingLevel
  } catch {
    return defaultComposerThinkingLevel
  }
}

function writeStoredComposerThinkingLevel(value: ComposerThinkingLevel): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(composerThinkingLevelStorageKey, value)
  } catch {
    // Ignore storage failures so the composer remains usable in restricted environments.
  }
}

function findMentionToken(value: string, caret: number): MentionToken | undefined {
  if (caret < 0) return undefined
  const nextChar = value[caret]
  if (nextChar && !/\s/.test(nextChar)) return undefined
  const beforeCaret = value.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
  if (!match || match.index === undefined) return undefined
  const prefix = match[1] ?? ''
  return {
    start: match.index + prefix.length,
    end: caret,
    query: match[2] ?? ''
  }
}

function createSkillMentionText(skill: SkillOption): string {
  return `@${skill.name}`
}

function normalizeSkillMentionRanges(content: string, ranges: SkillMentionRange[]): SkillMentionRange[] {
  return ranges
    .filter((range) => content.slice(range.start, range.end) === createSkillMentionText(range.skill))
    .sort((left, right) => left.start - right.start)
}

function insertSkillMentionRange(ranges: SkillMentionRange[], inserted: SkillMentionRange): SkillMentionRange[] {
  return [...ranges.filter((range) => inserted.start >= range.end || inserted.end <= range.start), inserted]
    .sort((left, right) => left.start - right.start)
}

function adjustSkillMentionRanges(
  previousValue: string,
  nextValue: string,
  ranges: SkillMentionRange[],
  explicitChangeStart?: number,
  explicitChangeEnd?: number
): SkillMentionRange[] {
  if (ranges.length === 0) return []

  const change = explicitChangeStart === undefined || explicitChangeEnd === undefined
    ? findTextChangeBounds(previousValue, nextValue)
    : { start: explicitChangeStart, oldEnd: explicitChangeEnd }
  const delta = nextValue.length - previousValue.length

  const adjusted = ranges.flatMap((range): SkillMentionRange[] => {
    if (change.oldEnd <= range.start) {
      return [{ ...range, start: range.start + delta, end: range.end + delta }]
    }
    if (change.start >= range.end) {
      return [range]
    }
    return []
  })

  return normalizeSkillMentionRanges(nextValue, adjusted)
}

function findTextChangeBounds(previousValue: string, nextValue: string): { start: number; oldEnd: number } {
  let start = 0
  while (start < previousValue.length && start < nextValue.length && previousValue[start] === nextValue[start]) {
    start += 1
  }

  let previousEnd = previousValue.length
  let nextEnd = nextValue.length
  while (previousEnd > start && nextEnd > start && previousValue[previousEnd - 1] === nextValue[nextEnd - 1]) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return { start, oldEnd: previousEnd }
}

function createComposerSegments(content: string, ranges: SkillMentionRange[]): ComposerSegment[] {
  if (ranges.length === 0) return [{ kind: 'text', text: content }]

  const segments: ComposerSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, range.start) })
    }
    segments.push({ kind: 'skill', text: content.slice(range.start, range.end), skill: range.skill })
    cursor = range.end
  }
  if (cursor < content.length) {
    segments.push({ kind: 'text', text: content.slice(cursor) })
  }
  return segments
}

function createSkillMentionDeletion(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  key: 'Backspace' | 'Delete',
  ranges: SkillMentionRange[]
): { value: string; cursor: number; start: number; end: number } | undefined {
  if (ranges.length === 0) return undefined

  if (selectionStart !== selectionEnd) {
    const intersecting = ranges.filter((range) => selectionStart < range.end && selectionEnd > range.start)
    if (intersecting.length === 0) return undefined

    const start = Math.min(selectionStart, ...intersecting.map((range) => range.start))
    const end = Math.max(selectionEnd, ...intersecting.map((range) => expandSkillMentionDeletionEnd(content, range.end)))
    return { value: `${content.slice(0, start)}${content.slice(end)}`, cursor: start, start, end }
  }

  const caret = selectionStart
  const range = ranges.find((candidate) => {
    const expandedEnd = expandSkillMentionDeletionEnd(content, candidate.end)
    if (key === 'Backspace') return caret > candidate.start && caret <= expandedEnd
    return caret >= candidate.start && caret < expandedEnd
  })
  if (!range) return undefined

  const end = expandSkillMentionDeletionEnd(content, range.end)
  return { value: `${content.slice(0, range.start)}${content.slice(end)}`, cursor: range.start, start: range.start, end }
}

function expandSkillMentionDeletionEnd(content: string, end: number): number {
  return end < content.length && /\s/.test(content[end] ?? '') ? end + 1 : end
}

function createInjectedPrompt(content: string, skills: SkillOption[]): string | undefined {
  const referencedSkills = findReferencedSkills(content, skills)
  if (referencedSkills.length === 0) return undefined

  const lines = referencedSkills.flatMap((skill) => [
    `- 技能：${skill.name}`,
    ...(skill.description ? [`  简介：${skill.description}`] : [])
  ])
  return `以下是用户通过 @ 提及的技能。请先用可调用工具 \`skills_get\`（registry id: \`skills.get\`）按技能名称读取完整 SKILL.md；请参考技能名称和简介理解用户意图，不要假设已注入完整 SKILL.md 正文。\n${lines.join('\n')}\n\n用户消息：\n${content}`
}

function findReferencedSkills(content: string, skills: SkillOption[]): SkillOption[] {
  const found = new Set<string>()
  const orderedSkills = [...skills].sort((left, right) => right.name.length - left.name.length)
  for (const skill of orderedSkills) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(skill.name)}(?=\\s|$)`, 'iu')
    if (pattern.test(content)) {
      found.add(skill.id)
    }
  }
  return skills.filter((skill) => found.has(skill.id))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const skillMenuScrollbarCss = `
.hesper-skill-mention-menu {
  scrollbar-width: thin;
  scrollbar-color: var(--hesper-color-scrollbar-thumb, ${themeTokens.color.scrollbarThumb}) transparent;
}
.hesper-skill-mention-menu::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.hesper-skill-mention-menu::-webkit-scrollbar-track {
  background: transparent;
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb {
  background: var(--hesper-color-scrollbar-thumb, ${themeTokens.color.scrollbarThumb});
  border-radius: 999px;
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb:hover {
  background: var(--hesper-color-scrollbar-thumb-hover, ${themeTokens.color.scrollbarThumbHover});
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb:active {
  background: var(--hesper-color-scrollbar-thumb-active, ${themeTokens.color.scrollbarThumbActive});
}
`

const skillMentionSelectionCss = `
.hesper-skill-mention-textarea::selection {
  background: #0067d7;
  color: #ffffff;
  -webkit-text-fill-color: #ffffff;
  text-shadow: none;
}
.hesper-skill-mention-textarea::-moz-selection {
  background: #0067d7;
  color: #ffffff;
  text-shadow: none;
}
`

const skillMenuStyle = {
  position: 'absolute',
  left: themeTokens.spacing.md,
  width: '20%',
  boxSizing: 'border-box',
  bottom: 'calc(100% - 14px)',
  zIndex: 20,
  display: 'grid',
  gap: 2,
  maxHeight: 180,
  overflowY: 'auto',
  overflowX: 'hidden',
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.lg,
  background: 'var(--hesper-color-surface, #1f2335)',
  boxShadow: `0 4px 10px -6px ${themeTokens.color.shadow}`,
  padding: 6
} satisfies CSSProperties

const skillOptionStyle = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: themeTokens.radius.md,
  background: 'transparent',
  color: themeTokens.color.text,
  cursor: 'pointer',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 2,
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  textAlign: 'left',
  font: 'inherit'
} satisfies CSSProperties

const skillOptionSelectedStyle = {
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))'
} satisfies CSSProperties

const skillNameStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const attachmentPreviewAreaStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: themeTokens.spacing.sm,
  flexWrap: 'wrap'
} satisfies CSSProperties

const attachmentDropHintStyle = {
  border: `1px dashed ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.lg,
  color: themeTokens.color.textMuted,
  padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.md}`,
  fontSize: themeTokens.typography.body
} satisfies CSSProperties

const imageAttachmentPreviewStyle = {
  position: 'relative',
  width: 96,
  height: 72,
  borderRadius: themeTokens.radius.lg,
  overflow: 'hidden',
  background: themeTokens.color.softControl
} satisfies CSSProperties

const imageAttachmentThumbnailStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover'
} satisfies CSSProperties

const attachmentRemoveButtonStyle = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  border: 0,
  borderRadius: 999,
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#ffffff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  fontSize: 16
} satisfies CSSProperties

const textAttachmentPreviewStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: themeTokens.spacing.sm,
  rowGap: 2,
  alignItems: 'center',
  minWidth: 160,
  maxWidth: 280,
  borderRadius: themeTokens.radius.lg,
  background: themeTokens.color.softControl,
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`
} satisfies CSSProperties

const textAttachmentNameStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.text
} satisfies CSSProperties

const textAttachmentMetaStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: themeTokens.color.textMuted,
  fontSize: 12
} satisfies CSSProperties

const textAttachmentRemoveButtonStyle = {
  gridRow: '1 / span 2',
  gridColumn: 2,
  width: 24,
  height: 24,
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: themeTokens.color.textMuted,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  fontSize: 16
} satisfies CSSProperties

const editorWrapperStyle = {
  position: 'relative',
  minHeight: 96,
  overflow: 'hidden'
} satisfies CSSProperties

const sharedEditorTextStyle = {
  padding: '0 2px',
  fontFamily: 'inherit',
  fontSize: themeTokens.typography.body,
  fontWeight: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.5
} satisfies CSSProperties

const skillMentionEditorTextLayoutStyle = {
  ...sharedEditorTextStyle,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word'
} satisfies CSSProperties

const highlightMirrorStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  boxSizing: 'border-box',
  pointerEvents: 'none',
  overflow: 'hidden',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  textShadow: 'none',
  zIndex: 0,
  ...skillMentionEditorTextLayoutStyle
} satisfies CSSProperties

const skillMentionPillStyle = {
  display: 'inline',
  border: 0,
  borderRadius: '3px',
  background: themeTokens.color.softControl,
  boxShadow: `1px 0 0 1px ${themeTokens.color.softControl}`,
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
  color: 'transparent',
  WebkitTextFillColor: 'transparent',
  padding: 0,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
} satisfies CSSProperties

const skillMentionTextareaStyle = {
  caretColor: themeTokens.color.text,
  ...skillMentionEditorTextLayoutStyle
} satisfies CSSProperties

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'block',
  position: 'relative',
  zIndex: 1,
  resize: 'none',
  minHeight: 96,
  overflow: 'hidden',
  borderRadius: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: themeTokens.color.text,
  ...sharedEditorTextStyle
} satisfies CSSProperties

const controlButtonStyle = {
  borderRadius: themeTokens.radius.md,
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.textMuted,
  cursor: 'pointer',
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  fontSize: themeTokens.typography.body,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const workspaceButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: themeTokens.spacing.xs
} satisfies CSSProperties

const workspaceIconStyle = {
  width: 16,
  height: 16,
  display: 'block',
  flex: '0 0 auto'
} satisfies CSSProperties

const workspaceLabelStyle = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const modelControlStyle = {
  display: 'flex',
  alignItems: 'center',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body
} satisfies CSSProperties

const sendButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: themeTokens.radius.lg,
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1
} satisfies CSSProperties

const sendIconStyle = {
  width: 23,
  height: 23,
  display: 'block'
} satisfies CSSProperties
