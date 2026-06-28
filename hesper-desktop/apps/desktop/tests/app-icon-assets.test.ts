import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const desktopPngPath = fileURLToPath(new URL('../assets/hesper-icon.png', import.meta.url))
const rendererPngPath = fileURLToPath(new URL('../renderer/src/assets/hesper-icon.png', import.meta.url))
const icoPath = fileURLToPath(new URL('../assets/hesper-icon.ico', import.meta.url))
const svgPath = fileURLToPath(new URL('../assets/hesper-icon.svg', import.meta.url))
const interVariablePath = fileURLToPath(new URL('../renderer/src/assets/fonts/InterVariable.woff2', import.meta.url))
const miSansVariablePath = fileURLToPath(new URL('../renderer/src/assets/fonts/MiSansVF.ttf', import.meta.url))
const jetBrainsMonoVariablePath = fileURLToPath(new URL('../renderer/src/assets/fonts/JetBrainsMono[wght].ttf', import.meta.url))

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const woff2Signature = Buffer.from('wOF2', 'ascii')
const trueTypeSignatures = [Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('OTTO', 'ascii'), Buffer.from('ttcf', 'ascii')]

function expectWoff2Font(buffer: Buffer) {
  expect(buffer.subarray(0, 4)).toEqual(woff2Signature)
}

function expectTrueTypeFont(buffer: Buffer) {
  expect(trueTypeSignatures.some((signature) => buffer.subarray(0, 4).equals(signature))).toBe(true)
}

function readPngHeader(buffer: Buffer) {
  expect(buffer.subarray(0, 8)).toEqual(pngSignature)
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colorType: buffer.readUInt8(25)
  }
}

function readIcoSizes(buffer: Buffer) {
  expect(buffer.readUInt16LE(0)).toBe(0)
  expect(buffer.readUInt16LE(2)).toBe(1)
  const count = buffer.readUInt16LE(4)
  const sizes: number[] = []

  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    const width = buffer.readUInt8(offset) || 256
    const height = buffer.readUInt8(offset + 1) || 256
    expect(width).toBe(height)
    sizes.push(width)
  }

  return sizes.sort((left, right) => left - right)
}

describe('app icon assets', () => {
  it('ships bundled variable fonts for UI and code rendering', async () => {
    const [interVariable, miSansVariable, jetBrainsMonoVariable] = await Promise.all([
      readFile(interVariablePath),
      readFile(miSansVariablePath),
      readFile(jetBrainsMonoVariablePath)
    ])

    expectWoff2Font(interVariable)
    expectTrueTypeFont(miSansVariable)
    expectTrueTypeFont(jetBrainsMonoVariable)
    expect(interVariable.byteLength).toBeGreaterThan(0)
    expect(miSansVariable.byteLength).toBeGreaterThan(0)
    expect(jetBrainsMonoVariable.byteLength).toBeGreaterThan(0)
  })

  it('keeps a source SVG for the new evening-star line icon', async () => {
    const svg = await readFile(svgPath, 'utf8')

    expect(svg).toContain('data-icon="hesper-evening-star-line"')
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('Hesper evening star line icon')
    expect(svg).not.toMatch(/<text\b/i)
  })

  it('ships a 1024 square RGBA PNG for Electron', async () => {
    const png = await readFile(desktopPngPath)
    const header = readPngHeader(png)

    expect(header).toEqual({ width: 1024, height: 1024, bitDepth: 8, colorType: 6 })
  })

  it('keeps the renderer icon byte-for-byte in sync with the desktop PNG', async () => {
    const [desktopPng, rendererPng] = await Promise.all([
      readFile(desktopPngPath),
      readFile(rendererPngPath)
    ])

    expect(rendererPng).toEqual(desktopPng)
  })

  it('ships a Windows ICO with the expected app icon sizes', async () => {
    const ico = await readFile(icoPath)

    expect(readIcoSizes(ico)).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
