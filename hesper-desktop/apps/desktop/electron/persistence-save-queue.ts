export interface PersistenceSaveQueueOptions {
  exportBytes: () => Uint8Array
  writeFile: (filePath: string, bytes: Uint8Array) => Promise<void> | void
  mkdir: (dirPath: string) => Promise<void> | void
  dirname: (filePath: string) => string
}

export interface PersistenceSaveQueue {
  save: (filePath: string) => Promise<void>
  flush: () => Promise<void>
}

export function createPersistenceSaveQueue({
  exportBytes,
  writeFile,
  mkdir,
  dirname
}: PersistenceSaveQueueOptions): PersistenceSaveQueue {
  let queueTail = Promise.resolve()
  const pendingTasks = new Set<Promise<void>>()

  function save(filePath: string): Promise<void> {
    const task = queueTail.then(async () => {
      await mkdir(dirname(filePath))
      const snapshot = exportBytes()
      await writeFile(filePath, snapshot)
    })

    queueTail = task.catch(() => undefined)
    pendingTasks.add(task)
    task.then(
      () => pendingTasks.delete(task),
      () => pendingTasks.delete(task)
    )

    return task
  }

  async function flush(): Promise<void> {
    const tasks = [...pendingTasks]
    const results = await Promise.allSettled(tasks)
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
  }

  return { save, flush }
}
