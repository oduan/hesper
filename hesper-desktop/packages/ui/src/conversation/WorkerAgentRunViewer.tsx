import { useMemo, type CSSProperties } from 'react'
import type { AgentRun, Message, RunStep, WorkerAgentInvocation } from '@hesper/shared'
import { themeTokens } from '../theme'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import { RunSteps } from './RunSteps'

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

function buildWorkerAgentInputContent(invocation: WorkerAgentInvocation): string {
  const parts = [`任务：\n${invocation.task}`]

  if (invocation.contextSummary) {
    parts.push(`上下文摘要：\n${invocation.contextSummary}`)
  }

  if (invocation.expectedOutput) {
    parts.push(`预期输出：\n${invocation.expectedOutput}`)
  }

  if (invocation.roleId) {
    parts.push(`角色：\n${invocation.roleId}`)
  }

  parts.push(
    invocation.allowedToolIds.length > 0
      ? `允许工具：\n${invocation.allowedToolIds.map((toolId) => `- ${toolId}`).join('\n')}`
      : '允许工具：\n暂无允许工具'
  )

  return parts.join('\n\n')
}

function createWorkerAgentInputMessage(invocation: WorkerAgentInvocation, run?: AgentRun | undefined): Message {
  return {
    id: `${invocation.id}-input-message`,
    sessionId: run?.sessionId ?? invocation.parentRunId,
    role: 'user',
    content: buildWorkerAgentInputContent(invocation),
    contentType: 'markdown',
    runId: invocation.parentRunId,
    createdAt: invocation.createdAt
  }
}

export function WorkerAgentRunViewer({ invocation, run, steps, messages, streamingText, onLocalFileClick }: WorkerAgentRunViewerProps) {
  const orderedMessages = useMemo(() => sortChronologically(messages), [messages])
  const inputMessage = useMemo(() => createWorkerAgentInputMessage(invocation, run), [invocation, run])
  const finalAssistantMessage = [...orderedMessages].reverse().find((message) => message.role === 'assistant')
  const childRunStartedAt = run?.startedAt ?? steps[0]?.createdAt

  return (
    <section aria-label="Worker Agent 查看器" style={viewerStyle}>
      <section aria-label="Worker Agent 输入" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Worker Agent 输入</h3>
        <MessageBubble message={inputMessage} />
      </section>

      <section aria-label="Worker Agent 子运行状态" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Worker Agent 子运行状态</h3>
        {run ? (
          <div style={statusCardStyle}>
            <div style={monoBlockStyle}>{run.id}</div>
            <div style={metaTextStyle}>状态：{run.status}</div>
            {run.startedAt ? <div style={metaTextStyle}>开始：{run.startedAt}</div> : null}
            {run.endedAt ? <div style={metaTextStyle}>结束：{run.endedAt}</div> : null}
          </div>
        ) : (
          <p style={emptyStateStyle}>子运行尚未创建</p>
        )}
      </section>

      <section aria-label="Worker Agent 执行步骤" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Worker Agent 执行步骤</h3>
        {steps.length > 0 ? (
          <RunSteps steps={steps} autoExpanded runStartedAt={childRunStartedAt} runEndedAt={run?.endedAt} onLocalFileClick={onLocalFileClick} />
        ) : (
          <p style={emptyStateStyle}>暂无执行步骤</p>
        )}
      </section>

      <section aria-label="Worker Agent 实时输出" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Worker Agent 实时输出</h3>
        {streamingText ? (
          <OutputBlock content={streamingText} contentType="markdown" onLocalFileClick={onLocalFileClick} />
        ) : (
          <p style={emptyStateStyle}>暂无实时输出</p>
        )}
      </section>

      <section aria-label="Worker Agent 最终输出" style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Worker Agent 最终输出</h3>
        {finalAssistantMessage ? (
          <OutputBlock content={finalAssistantMessage.content} contentType={finalAssistantMessage.contentType} onLocalFileClick={onLocalFileClick} />
        ) : (
          <p style={emptyStateStyle}>暂无最终输出</p>
        )}
      </section>
    </section>
  )
}

const viewerStyle: CSSProperties = {
  display: 'grid',
  gap: themeTokens.spacing.xl,
  minWidth: 0
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

const statusCardStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 4,
  justifySelf: 'stretch',
  borderRadius: themeTokens.radius.lg,
  background: themeTokens.color.surfaceMuted,
  padding: themeTokens.spacing.md
}

const monoBlockStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: themeTokens.typography.body,
  lineHeight: 1.55,
  color: themeTokens.color.text,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
}

const metaTextStyle: CSSProperties = {
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body,
  lineHeight: 1.45
}

const emptyStateStyle: CSSProperties = {
  margin: 0,
  color: themeTokens.color.textMuted
}
