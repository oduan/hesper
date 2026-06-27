export function runtimeCallableToolName(toolId: string): string {
  const normalized = toolId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return normalized || 'tool'
}
