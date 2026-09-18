export function isRetryableApiError(error) {
  return ['APIConnectionError', 'APIConnectionTimeoutError'].includes(error?.name)
    || [408, 409, 429].includes(error?.status)
    || (error?.status >= 500 && error?.status <= 599)
}

export async function withApiRetry(operation, { attempts = 3, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onRetry = () => {}, onFailure = () => {} } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation() } catch (error) {
      if (attempt === attempts || !isRetryableApiError(error)) {
        onFailure({ attempt, status: error.status, requestId: error.request_id, type: error.name })
        throw error
      }
      onRetry({ attempt, status: error.status, requestId: error.request_id })
      await sleep(400 * 2 ** (attempt - 1))
    }
  }
}
