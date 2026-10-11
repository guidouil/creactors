import { abortError, ExportResourceError } from './errors';

/** Bound a stalled native operation without counting time spent in a hidden tab. */
export class ProgressGuard {
  constructor(private controller: AbortController, private retryAt720p: () => boolean) {}

  check(): void {
    if (this.controller.signal.aborted) throw this.controller.signal.reason ?? abortError();
  }

  wait<T>(operation: Promise<T>): Promise<T> {
    // Native work starts when its promise is constructed. If cancellation won
    // that race, keep a rejection handler attached while returning its reason.
    if (this.controller.signal.aborted) {
      void operation.catch(() => {});
      return Promise.reject(this.controller.signal.reason ?? abortError());
    }
    return new Promise<T>((resolve, reject) => {
      let foregroundIdle = 0;
      let previousTick = performance.now();
      const signal = this.controller.signal;
      const cleanup = () => { clearInterval(timer); signal.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); reject(signal.reason ?? abortError()); };
      const timer = setInterval(() => {
        const now = performance.now();
        if (typeof document === 'undefined' || !document.hidden) foregroundIdle += now - previousTick;
        previousTick = now;
        if (foregroundIdle >= 30_000) {
          this.controller.abort(new ExportResourceError('Video encoding stopped making progress.', this.retryAt720p()));
        }
      }, 500);
      signal.addEventListener('abort', onAbort, { once: true });
      operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      // The signal may have changed between check() and listener registration.
      if (signal.aborted) onAbort();
    });
  }
}
