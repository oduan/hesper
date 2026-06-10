import type { Message, OutputMode, RunStep, Session } from '@hesper/shared'
import { darkTheme } from '../theme'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { OutputBlock } from './OutputBlock'
import { RightNavigation, type NavigationItem } from './RightNavigation'
import { RunSteps } from './RunSteps'

export type ConversationViewProps = {
  session: Session
  messages: Message[]
  steps?: RunStep[]
  output?: string
  outputMode?: OutputMode
  navigationOpen?: boolean
  navigationItems?: NavigationItem[]
  onSend: (content: string) => void
}

export function ConversationView({
  session,
  messages,
  steps = [],
  output,
  outputMode,
  navigationOpen = false,
  navigationItems = [],
  onSend
}: ConversationViewProps) {
  const resolvedMode = outputMode ?? session.outputMode

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: navigationOpen ? 'minmax(0, 1fr) 280px' : 'minmax(0, 1fr)', gap: darkTheme.spacing.md }}>
      <section
        aria-label="会话详情"
        style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', gap: darkTheme.spacing.md, minWidth: 0, minHeight: 0 }}
      >
        <div
          style={{
            minHeight: 0,
            overflow: 'auto',
            display: 'grid',
            alignContent: 'start',
            gap: darkTheme.spacing.md,
            paddingRight: darkTheme.spacing.xs
          }}
        >
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {steps.length > 0 ? <RunSteps steps={steps} /> : null}
          {output ? <OutputBlock content={output} contentType={resolvedMode} /> : null}
        </div>
        <Composer
          {...(session.workspacePath ? { workspacePath: session.workspacePath } : {})}
          modelId={session.defaultModelId ?? '未设置模型'}
          outputMode={resolvedMode}
          onSend={onSend}
        />
      </section>
      <RightNavigation open={navigationOpen} items={navigationItems} />
    </div>
  )
}
