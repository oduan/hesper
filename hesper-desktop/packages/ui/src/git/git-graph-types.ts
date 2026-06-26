export type GitRefView = {
  name: string
  shortName: string
  type: 'local-branch' | 'remote-branch' | 'tag' | 'head'
  targetCommit?: string
}

export type GitGraphLaneView = {
  id: string
  color?: string
  active: boolean
  topActive?: boolean | undefined
  bottomActive?: boolean | undefined
}

export type GitGraphEdgeView = {
  fromLaneId: string
  toLaneId: string
}

export type GitGraphRowView = {
  commitHash: string
  shortHash: string
  parents: string[]
  subject: string
  authorName: string
  authorEmail: string
  authoredAt: string
  refs: GitRefView[]
  graph: {
    lanes: GitGraphLaneView[]
    nodeLaneId?: string
    edges?: GitGraphEdgeView[]
  }
}

export type GitCommitDetailView = {
  commitHash: string
  shortHash: string
  parents: string[]
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authoredAt: string
  committerName: string
  committerEmail: string
  committedAt: string
  refs: GitRefView[]
  files: Array<{
    path: string
    oldPath?: string
    status: string
    additions?: number
    deletions?: number
  }>
}
