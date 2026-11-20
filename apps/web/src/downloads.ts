/** Save bytes as a file through the browser's download */
export function saveFile(data: BlobPart, fileName: string, type: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([data], { type }))
  link.download = fileName
  // Attached while clicked, and the file let go only once the browser has started saving it
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
}
