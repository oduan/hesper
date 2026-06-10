import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import desktopPackage from '../package.json'

const appRoot = path.resolve(import.meta.dirname, '..')
const ipcContractPath = path.join(appRoot, 'electron', 'ipc-contract.ts')
const preloadPath = path.join(appRoot, 'electron', 'preload.cjs')

function readObjectLiteral(source: string, declarationPattern: RegExp, label: string) {
  const match = source.match(declarationPattern)
  if (!match?.[1]) {
    throw new Error(`Unable to locate ${label}`)
  }

  return Function(`"use strict"; return (${match[1]})`)() as Record<string, string>
}

describe('desktop runtime tooling', () => {
  it('keeps preload.cjs channels and events aligned with ipc-contract.ts', () => {
    const ipcContractSource = fs.readFileSync(ipcContractPath, 'utf8')
    const preloadSource = fs.readFileSync(preloadPath, 'utf8')

    const expectedChannels = readObjectLiteral(ipcContractSource, /export const ipcChannels = (\{[\s\S]*?\}) as const/, 'ipcChannels in ipc-contract.ts')
    const expectedEvents = readObjectLiteral(ipcContractSource, /export const ipcEvents = (\{[\s\S]*?\}) as const/, 'ipcEvents in ipc-contract.ts')
    const preloadChannels = readObjectLiteral(preloadSource, /const ipcChannels = (\{[\s\S]*?\})\n/, 'ipcChannels in preload.cjs')
    const preloadEvents = readObjectLiteral(preloadSource, /const ipcEvents = (\{[\s\S]*?\})\n/, 'ipcEvents in preload.cjs')

    expect(preloadChannels).toEqual(expectedChannels)
    expect(preloadEvents).toEqual(expectedEvents)
  })

  it('keeps dev script self-contained for preload.cjs startup', () => {
    const devScript = desktopPackage.scripts.dev

    expect(devScript).toContain('node scripts/copy-preload.mjs --watch')
    expect(devScript).toContain('dist/electron/preload.cjs')
  })
})
