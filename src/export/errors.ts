export class ExportCapabilityError extends Error {
  constructor(message = 'No native video export configuration succeeded.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExportCapabilityError';
  }
}

export class ExportResourceError extends Error {
  constructor(message: string, readonly retryAt720p: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExportResourceError';
  }
}

export function abortError(): DOMException {
  return new DOMException('Video export was canceled.', 'AbortError');
}
