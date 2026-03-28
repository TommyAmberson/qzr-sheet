/**
 * Platform-aware file I/O.
 * Uses Tauri dialog + fs plugins when running in a native window,
 * falls back to browser APIs for `pnpm dev` (web-only mode).
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

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
      const handle = await (window as any).showSaveFilePicker({
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

export async function openQuizFromFile(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      multiple: false,
      filters: [{ name: 'Quiz JSON', extensions: ['json'] }],
    })
    if (!path) return null
    return readTextFile(path as string)
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsText(file)
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
      const handle = await (window as any).showSaveFilePicker({
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
    const blob = new Blob([odsBytes], { type: 'application/vnd.oasis.opendocument.spreadsheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultFilename
    a.click()
    URL.revokeObjectURL(url)
    return true
  }
}

export async function openOtsFile(): Promise<Uint8Array | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      multiple: false,
      filters: [{ name: 'Scoresheet Template', extensions: ['ots'] }],
    })
    if (!path) return null
    return readFile(path as string)
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.ots'
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

export async function confirmAction(message: string): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask(message, { title: 'qzr-sheet', kind: 'warning' })
  } else {
    return confirm(message)
  }
}
