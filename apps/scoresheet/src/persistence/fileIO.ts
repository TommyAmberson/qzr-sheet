/**
 * Platform-aware file I/O.
 * Uses Tauri dialog + fs plugins when running in a native window,
 * falls back to browser APIs for `pnpm dev` (web-only mode).
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

interface FileSystemWritableFileStream {
  write(data: string | ArrayBuffer | Blob | Uint8Array): Promise<void>
  close(): Promise<void>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<{
    createWritable(): Promise<FileSystemWritableFileStream>
  }>
}

export async function saveQuizToFile(json: string, defaultFilename: string): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({
      defaultPath: defaultFilename,
      filters: [{ name: 'Quiz JSON', extensions: ['json'] }],
    })
    if (!path) return false
    await writeTextFile(path, json)
    return true
  } else if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as WindowWithFilePicker).showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{ description: 'Quiz JSON', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return true
    } catch {
      return false
    }
  } else {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultFilename
    a.click()
    URL.revokeObjectURL(url)
    return false
  }
}

export type OpenedQuizFile =
  | { type: 'json'; content: string }
  | { type: 'ods'; content: Uint8Array }

export async function openAnyQuizFile(): Promise<OpenedQuizFile | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile, readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      multiple: false,
      filters: [{ name: 'Quiz files', extensions: ['json', 'ods'] }],
    })
    if (!path) return null
    const p = path as string
    if (p.endsWith('.ods')) {
      return { type: 'ods', content: await readFile(p) }
    }
    return { type: 'json', content: await readTextFile(p) }
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.ods'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        if (file.name.endsWith('.ods')) {
          reader.onload = () =>
            resolve({ type: 'ods', content: new Uint8Array(reader.result as ArrayBuffer) })
          reader.onerror = () => resolve(null)
          reader.readAsArrayBuffer(file)
        } else {
          reader.onload = () => resolve({ type: 'json', content: reader.result as string })
          reader.onerror = () => resolve(null)
          reader.readAsText(file)
        }
      }
      input.click()
    })
  }
}

export async function exportOdsFile(
  odsBytes: Uint8Array,
  defaultFilename: string,
): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({
      defaultPath: defaultFilename,
      filters: [{ name: 'OpenDocument Spreadsheet', extensions: ['ods'] }],
    })
    if (!path) return false
    await writeFile(path, odsBytes)
    return true
  } else if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as WindowWithFilePicker).showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [
          {
            description: 'OpenDocument Spreadsheet',
            accept: { 'application/vnd.oasis.opendocument.spreadsheet': ['.ods'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(odsBytes)
      await writable.close()
      return true
    } catch {
      return false
    }
  } else {
    const blob = new Blob([odsBytes as Uint8Array<ArrayBuffer>], {
      type: 'application/vnd.oasis.opendocument.spreadsheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultFilename
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

export async function confirmAction(message: string): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask(message, { title: 'qzr-sheet', kind: 'warning' })
  } else {
    return confirm(message)
  }
}

export async function openOtsTemplate(): Promise<Uint8Array | null> {
  if (isTauri) {
    const { message, open } = await import('@tauri-apps/plugin-dialog')
    await message('Select your Scoresheet.ots file (or a quiz file you want to overwrite).', {
      title: 'Select Scoresheet Template',
      kind: 'info',
    })
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      multiple: false,
      filters: [{ name: 'Scoresheet Template', extensions: ['ots', 'ods'] }],
    })
    if (!path) return null
    return readFile(path as string)
  } else {
    return new Promise((resolve) => {
      alert('Select your Scoresheet.ots file (or a quiz file you want to overwrite).')
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.ots,.ods'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = () => resolve(null)
        reader.readAsArrayBuffer(file)
      }
      input.click()
    })
  }
}
