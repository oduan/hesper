import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const appRoot = path.resolve(import.meta.dirname, '..')
const ipcContractPath = path.join(appRoot, 'electron', 'ipc-contract.ts')
const preloadTsPath = path.join(appRoot, 'electron', 'preload.ts')
const preloadCjsPath = path.join(appRoot, 'electron', 'preload.cjs')

export function readObjectLiteral(source, declarationPattern, label) {
  const match = source.match(declarationPattern)
  if (!match?.[1]) {
    throw new Error(`Unable to locate ${label}`)
  }

  return Function(`"use strict"; return (${match[1]})`)()
}

function getPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function isFunctionValue(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function findHesperApiInitializer(sourceFile) {
  let initializer

  function visit(node) {
    if (initializer) {
      return
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'hesperApi' && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
          initializer = declaration.initializer
          return
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return initializer
}

export function collectPreloadApiMethodMap(source, fileName = 'preload.ts') {
  const scriptKind = fileName.endsWith('.cjs') || fileName.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const hesperApiInitializer = findHesperApiInitializer(sourceFile)

  if (!hesperApiInitializer) {
    throw new Error(`Unable to locate hesperApi object in ${fileName}`)
  }

  const namespaces = {}

  for (const namespaceProperty of hesperApiInitializer.properties) {
    if (!ts.isPropertyAssignment(namespaceProperty)) {
      continue
    }

    const namespaceName = getPropertyName(namespaceProperty.name)
    if (!namespaceName || !ts.isObjectLiteralExpression(namespaceProperty.initializer)) {
      continue
    }

    const methods = []
    for (const methodProperty of namespaceProperty.initializer.properties) {
      if (ts.isMethodDeclaration(methodProperty)) {
        const methodName = getPropertyName(methodProperty.name)
        if (methodName) {
          methods.push(methodName)
        }
        continue
      }

      if (!ts.isPropertyAssignment(methodProperty) || !isFunctionValue(methodProperty.initializer)) {
        continue
      }

      const methodName = getPropertyName(methodProperty.name)
      if (methodName) {
        methods.push(methodName)
      }
    }

    namespaces[namespaceName] = methods.sort()
  }

  return Object.fromEntries(Object.entries(namespaces).sort(([left], [right]) => left.localeCompare(right)))
}

export function assertPreloadApiMethodsAligned(preloadTsSource, preloadCjsSource) {
  const preloadTsMethods = collectPreloadApiMethodMap(preloadTsSource, 'preload.ts')
  const preloadCjsMethods = collectPreloadApiMethodMap(preloadCjsSource, 'preload.cjs')

  if (JSON.stringify(preloadTsMethods) !== JSON.stringify(preloadCjsMethods)) {
    throw new Error(`preload API methods drifted between preload.ts and preload.cjs\npreload.ts: ${JSON.stringify(preloadTsMethods)}\npreload.cjs: ${JSON.stringify(preloadCjsMethods)}`)
  }
}

export function verifyPreloadContract() {
  const ipcContractSource = fs.readFileSync(ipcContractPath, 'utf8')
  const preloadTsSource = fs.readFileSync(preloadTsPath, 'utf8')
  const preloadCjsSource = fs.readFileSync(preloadCjsPath, 'utf8')

  const expectedChannels = readObjectLiteral(ipcContractSource, /export const ipcChannels = (\{[\s\S]*?\}) as const/, 'ipcChannels in ipc-contract.ts')
  const expectedEvents = readObjectLiteral(ipcContractSource, /export const ipcEvents = (\{[\s\S]*?\}) as const/, 'ipcEvents in ipc-contract.ts')
  const preloadChannels = readObjectLiteral(preloadCjsSource, /const ipcChannels = (\{[\s\S]*?\})\r?\n/, 'ipcChannels in preload.cjs')
  const preloadEvents = readObjectLiteral(preloadCjsSource, /const ipcEvents = (\{[\s\S]*?\})\r?\n/, 'ipcEvents in preload.cjs')

  if (JSON.stringify(expectedChannels) !== JSON.stringify(preloadChannels)) {
    throw new Error('preload.cjs ipcChannels drifted from ipc-contract.ts')
  }

  if (JSON.stringify(expectedEvents) !== JSON.stringify(preloadEvents)) {
    throw new Error('preload.cjs ipcEvents drifted from ipc-contract.ts')
  }

  assertPreloadApiMethodsAligned(preloadTsSource, preloadCjsSource)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPreloadContract()
  console.log('[verify-preload-contract] preload contract matches ipc-contract.ts and preload.ts API')
}
