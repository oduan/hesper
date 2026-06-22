import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { AgentRun, Message, MessageContentType, RunStep, WorkerAgentInvocation } from '@hesper/shared'
import { themeTokens } from '../theme'
import { MarkdownOutput } from './MarkdownOutput'
import { RunSteps } from './RunSteps'
import { createSandboxedHtmlDocument } from './html-document'

export type WorkerAgentRunViewerProps = {
  invocation: WorkerAgentInvocation
  run?: AgentRun | undefined
  steps: RunStep[]
  messages: Message[]
  streamingText: string
  onLocalFileClick?: ((path: string) => void) | undefined
}

function compareCreatedAt<T extends { id: string; createdAt: string }>(left: T, right: T): number {
  const byCreatedAt = left.createdAt.localeCompare(right.createdAt)
  return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt
}

function sortChronologically<T extends { id: string; createdAt: string }>(items: T[]): T[] {
  return [...items].sort(compareCreatedAt)
}

function renderMessageContent(content: string, contentType: MessageContentType, onLocalFileClick?: ((path: string) => void) | undefined) {
  if (contentType === 'html') {
    return (
      <iframe
        title="HTML 输出"
        sandbox=""
        srcDoc={createSandboxedHtmlDocument(content)}
        style={iframeStyle}
      />
    )
  }

  if (contentType === 'markdown') {
    return <MarkdownOutput content={content} onLocalFileClick={onLocalFileClick} />
  }

  return <div style={plainTextStyle}>{content}</div>
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={cardStyle}>
      <h3 style={cardTitleStyle}>{title}</h3>
      {children}
    </section>
  )
}

export function WorkerAgentRunViewer({ invocation, run, steps, messages, streamingText, onLocalFileClick }: WorkerAgentRunViewerProps) {
  const orderedMessages = useMemo(() => sortChronologically(messages), [messages])
  const finalAssistantMessage = [...orderedMessages].reverse().find((message) => message.role === 'assistant')
  const childRunStartedAt = run?.startedAt ?? steps[0]?.createdAt

  return (
    <section aria-label="Worker Agent 查看器" style={viewerStyle}>
      <div style={introGridStyle}>
        <SectionCard title="任务">
          <MarkdownOutput content={invocation.task} onLocalFileClick={onLocalFileClick} />
        </SectionCard>
        {invocation.contextSummary ? (
          <SectionCard title="上下文">
            <MarkdownOutput content={invocation.contextSummary} onLocalFileClick={onLocalFileClick} />
          </SectionCard>
        ) : null}
        {invocation.expectedOutput ? (
          <SectionCard title="预期输出">
            <MarkdownOutput content={invocation.expectedOutput} onLocalFileClick={onLocalFileClick} />
          </SectionCard>
        ) : null}
        <SectionCard title="角色">
          <div style={monoBlockStyle}>{invocation.roleId}</div>
        </SectionCard>
        <SectionCard title="允许工具">
          {invocation.allowedToolIds.length > 0 ? (
            <ul style={toolListStyle}>
              {invocation.allowedToolIds.map((toolId) => (
                <li key={toolId}>
                  <code style={toolCodeStyle}>{toolId}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p style={emptyStateStyle}>暂无允许工具</p>
          )}
        </SectionCard>
        <SectionCard title="子运行">
          {run ? (
            <div style={metaStackStyle}>
              <div style={monoBlockStyle}>{run.id}</div>
              <div style={metaTextStyle}>状态：{run.status}</div>
              {run.startedAt ? <div style={metaTextStyle}>开始：{run.startedAt}</div> : null}
              {run.endedAt ? <div style={metaTextStyle}>结束：{run.endedAt}</div> : null}
            </div>
          ) : (
            <p style={emptyStateStyle}>子运行尚未创建</p>
          )}
        </SectionCard>
      </div>

      <section aria-label="子步骤" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>子步骤</h3>
        <RunSteps steps={steps} autoExpanded runStartedAt={childRunStartedAt} runEndedAt={run?.endedAt} onLocalFileClick={onLocalFileClick} />
      </section>

      {streamingText ? (
        <section aria-label="流式输出" style={sectionStyle}>
          <h3 style={sectionTitleStyle}>流式输出</h3>
          <div style={streamingBlockStyle}>{streamingText}</div>
        </section>
      ) : null}

      {finalAssistantMessage ? (
        <section aria-label="最终助手输出" style={sectionStyle}>
          <h3 style={sectionTitleStyle}>最终助手输出</h3>
          {renderMessageContent(finalAssistantMessage.content, finalAssistantMessage.contentType, onLocalFileClick)}
        </section>
      ) : null}
    </section>
  )
}

const viewerStyle: CSSProperties = {
  display: 'grid',
  gap: themeTokens.spacing.xl,
  minWidth: 0
}

const introGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: themeTokens.spacing.md,
  alignItems: 'start'
}

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: themeTokens.spacing.md,
  minWidth: 0
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: themeTokens.typography.body,
  lineHeight: 1.25,
  fontWeight: 800,
  color: themeTokens.color.text
}

const cardStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: themeTokens.spacing.md,
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.lg,
  background: themeTokens.color.surfaceMuted,
  padding: themeTokens.spacing.lg
}

const cardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: themeTokens.typography.body,
  lineHeight: 1.25,
  color: themeTokens.color.text,
  fontWeight: 800
}

const monoBlockStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: themeTokens.typography.body,
  lineHeight: 1.55,
  color: themeTokens.color.text,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
}

const metaStackStyle: CSSProperties = {
  display: 'grid',
  gap: 4
}

const metaTextStyle: CSSProperties = {
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body,
  lineHeight: 1.45
}

const toolListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 6
}

const toolCodeStyle: CSSProperties = {
  display: 'inline-block',
  maxWidth: '100%',
  padding: '2px 8px',
  borderRadius: themeTokens.radius.sm,
  background: themeTokens.color.surface,
  border: `1px solid ${themeTokens.color.border}`,
  color: themeTokens.color.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: themeTokens.typography.body,
  overflowWrap: 'anywhere'
}

const emptyStateStyle: CSSProperties = {
  margin: 0,
  color: themeTokens.color.textMuted
}

const plainTextStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  lineHeight: 1.55,
  color: themeTokens.color.text
}

const streamingBlockStyle: CSSProperties = {
  ...plainTextStyle,
  padding: themeTokens.spacing.md,
  borderRadius: themeTokens.radius.lg,
  border: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surfaceMuted
}

// User-supplied HTML/preview content keeps a neutral white canvas so external documents render predictably.
const iframeStyle: CSSProperties = {
  width: '100%',
  minHeight: 240,
  border: 0,
  borderRadius: themeTokens.radius.lg,
  background: '#fff'
}
