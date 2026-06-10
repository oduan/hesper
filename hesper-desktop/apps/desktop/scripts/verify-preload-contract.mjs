import fs from 'node:fs'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const ipcContractPath = path.join(appRoot, 'electron', 'ipc-contract.ts')
const preloadPath = path.join(appRoot, 'electron', 'preload.cjs')

function readObjectLiteral(source, declarationPattern, label) {
  const match = source.match(declarationPattern)
  if (!match?.[1]) {
    throw new Error(`Unable to locate ${label}`)
  }

  return Function(`"use strict"; return (${match[1]})`)()
}

const ipcContractSource = fs.readFileSync(ipcContractPath, 'utf8')
const preloadSource = fs.readFileSync(preloadPath, 'utf8')

const expectedChannels = readObjectLiteral(ipcContractSource, /export const ipcChannels = (\{[\s\S]*?\}) as const/, 'ipcChannels in ipc-contract.ts')
const expectedEvents = readObjectLiteral(ipcContractSource, /export const ipcEvents = (\{[\s\S]*?\}) as const/, 'ipcEvents in ipc-contract.ts')
const preloadChannels = readObjectLiteral(preloadSource, /const ipcChannels = (\{[\s\S]*?\})\r?\n/, 'ipcChannels in preload.cjs')
const preloadEvents = readObjectLiteral(preloadSource, /const ipcEvents = (\{[\s\S]*?\})\r?\n/, 'ipcEvents in preload.cjs')

if (JSON.stringify(expectedChannels) !== JSON.stringify(preloadChannels)) {
  throw new Error('preload.cjs ipcChannels drifted from ipc-contract.ts')
}

if (JSON.stringify(expectedEvents) !== JSON.stringify(preloadEvents)) {
  throw new Error('preload.cjs ipcEvents drifted from ipc-contract.ts')
}

console.log('[verify-preload-contract] preload contract matches ipc-contract.ts')
