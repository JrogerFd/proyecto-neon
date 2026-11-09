const DEFAULT_BACKEND_URL =
  import.meta.env?.VITE_BACKEND_URL ??
  (typeof window !== 'undefined' && window.location?.hostname
    ? window.location.origin
    : 'http://127.0.0.1:4174');

function timedSignal(signal, timeoutMs) {
  const abortApi = globalThis.AbortSignal;
  if (typeof abortApi?.timeout !== 'function') {
    return signal;
  }

  const timeout = abortApi.timeout(timeoutMs);
  return signal && typeof abortApi.any === 'function'
    ? abortApi.any([signal, timeout])
    : signal ?? timeout;
}

export class BackendClient {
  constructor({
    baseUrl = DEFAULT_BACKEND_URL,
    fetchImplementation = globalThis.fetch
  } = {}) {
    if (typeof fetchImplementation !== 'function') {
      throw new TypeError('A Fetch API implementation is required');
    }

    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImplementation.bind(globalThis);
  }

  async health({ signal } = {}) {
    const response = await this.fetch(`${this.baseUrl}/api/health`, {
      method: 'GET',
      signal: timedSignal(signal, 2000)
    });

    if (!response.ok) {
      throw new Error(`Backend health check failed (${response.status})`);
    }

    return response.json();
  }

  async simulate(request, { signal } = {}) {
    const response = await this.fetch(`${this.baseUrl}/api/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      signal: timedSignal(signal, 30000)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.error?.message ??
        `Backend simulation failed (${response.status})`
      );
    }

    return result;
  }
}
