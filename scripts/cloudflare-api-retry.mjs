const DEFAULT_LOOKUP_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000]);

export class RetryableCloudflareLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryableCloudflareLookupError";
  }
}

export async function withCloudflareLookupRetry({
  apiName,
  request,
  logger = console,
  sleepImpl = sleep,
  retryDelaysMs = DEFAULT_LOOKUP_RETRY_DELAYS_MS,
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof RetryableCloudflareLookupError) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      const delayMs = retryDelaysMs[attempt];
      logger.log(
        `${apiName} lookup hit a transient failure; retrying in ${delayMs}ms (attempt ${attempt + 2}/${retryDelaysMs.length + 1})`,
      );
      await sleepImpl(delayMs);
    }
  }
}

export function isTransientCloudflareStatus(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

function sleep(delayMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}
