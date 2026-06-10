import { useEffect, type CSSProperties } from 'react'
import { AppShell, ConversationView } from '@hesper/ui'
import { AppStoreProvider, useAppStore } from './app-store'
import { hesperApi } from './ipc-client'

export function App() {
  return (
    <AppStoreProvider>
      <AppContent />
    </AppStoreProvider>
  )
}

function AppContent() {
  const { state, dispatch } = useAppStore()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const sessions = await hesperApi.sessions.list()
      if (!cancelled) {
        dispatch({ type: 'sessions.loaded', sessions })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => {
    return hesperApi.agent.onEvent((event) => {
      dispatch({ type: 'agent.event', event })
    })
  }, [dispatch])

  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId)
  const activeRunId = activeSession ? state.latestRunIdBySession[activeSession.id] : undefined
  const activeSteps = activeRunId ? state.stepsByRun[activeRunId] ?? [] : []
  const activeStreamingText = activeRunId ? state.streamingByRun[activeRunId] ?? '' : ''
  const activeMessages = activeSession ? state.messagesBySession[activeSession.id] ?? [] : []

  return (
    <AppShell
      sessions={state.sessions}
      activeSection={state.activeSection}
      title={activeSession?.title ?? '新建会话'}
    >
      {activeSession ? (
        <ConversationView
          session={activeSession}
          messages={activeMessages}
          steps={activeSteps}
          {...(activeStreamingText ? { output: activeStreamingText } : {})}
          onSend={() => undefined}
        />
      ) : (
        <EmptyConversationState onCreateSession={async () => createSession(dispatch)} />
      )}
    </AppShell>
  )
}

function EmptyConversationState({ onCreateSession }: { onCreateSession: () => Promise<void> }) {
  return (
    <section
      aria-label="空会话状态"
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 16,
        padding: 24
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px' }}>准备开始新的 hesper 会话</h2>
        <p style={{ margin: 0, opacity: 0.72 }}>当前还没有会话。先创建一个主界面会话壳，后续任务再接入完整交互。</p>
      </div>
      <button type="button" onClick={onCreateSession} style={primaryButtonStyle}>
        新建会话
      </button>
    </section>
  )
}

async function createSession(dispatch: ReturnType<typeof useAppStore>['dispatch']) {
  const session = await hesperApi.sessions.create({ title: 'New chat' })
  dispatch({ type: 'session.created', session })
}

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: '10px 18px',
  background: '#7c6cff',
  color: '#ffffff',
  fontWeight: 700,
  cursor: 'pointer'
}
