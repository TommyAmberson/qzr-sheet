/**
 * A small stand-in for the Web Locks API, which jsdom lacks: exclusive locks only, with
 * `ifAvailable`, `signal` and `query`. Every test runs as one page, so another tab is imitated by
 * taking a lock with `holdAsOtherTab` and letting it go with `closeOtherTab`.
 */
type Grant = () => void

class StandInLockManager {
  private readonly held = new Set<string>()
  private readonly waiting = new Map<string, Grant[]>()

  async request<T>(
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => Promise<T> | T),
    maybeCallback?: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback)!
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null)
      await this.wait(name, options.signal)
    }
    this.held.add(name)
    try {
      return await callback({ name, mode: 'exclusive' } as Lock)
    } finally {
      this.letGo(name)
    }
  }

  async query(): Promise<LockManagerSnapshot> {
    return {
      held: [...this.held].map((name) => ({ name, mode: 'exclusive', clientId: 'tab' })),
      pending: [],
    }
  }

  /** Hold `name` as another open tab would, until closeOtherTab */
  holdAsOtherTab(name: string): void {
    if (this.held.has(name)) throw new Error(`${name} is already held`)
    this.held.add(name)
  }

  /** The other tab holding `name` closes: the browser lets its lock go */
  closeOtherTab(name: string): void {
    this.letGo(name)
  }

  private wait(name: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        const queue = this.waiting.get(name) ?? []
        this.waiting.set(
          name,
          queue.filter((g) => g !== grant),
        )
        reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      if (signal?.aborted) return abort()
      signal?.addEventListener('abort', abort)
      this.waiting.set(name, [...(this.waiting.get(name) ?? []), grant])
    })
  }

  private letGo(name: string): void {
    this.held.delete(name)
    const [next, ...rest] = this.waiting.get(name) ?? []
    this.waiting.set(name, rest)
    next?.()
  }
}

export let locks = new StandInLockManager()

/** A fresh lock manager for each test, as if every tab had closed */
export function installWebLocks(): void {
  locks = new StandInLockManager()
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

/** Imitate a browser without Web Locks */
export function removeWebLocks(): void {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
}
