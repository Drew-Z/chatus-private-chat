import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTransientCloudflareStatus,
  RetryableCloudflareLookupError,
  withCloudflareLookupRetry,
} from "./cloudflare-api-retry.mjs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_QUEUE_LIST_PAGES = 1_000;

export async function provisionDocumentIngestQueues({
  accountId,
  apiToken,
  queueName,
  deadLetterQueueName,
  fetchImpl = fetch,
  logger = console,
  sleepImpl,
  retryDelaysMs,
}) {
  const normalized = validateInputs({ accountId, apiToken, queueName, deadLetterQueueName });
  const context = {
    collectionUrl: `${CLOUDFLARE_API_BASE}/accounts/${normalized.accountId}/queues`,
    fetchImpl,
    headers: {
      Authorization: `Bearer ${normalized.apiToken}`,
      "Content-Type": "application/json",
    },
    logger,
    sleepImpl,
    retryDelaysMs,
  };

  const deadLetterQueue = await ensureQueue(context, normalized.deadLetterQueueName);
  const queue = await ensureQueue(context, normalized.queueName);
  return { deadLetterQueue, queue };
}

async function ensureQueue(context, queueName) {
  const existing = await lookupQueue(context, queueName);
  if (existing.queue) {
    context.logger.log(`Queue "${queueName}" already exists`);
    return { queueName, created: false };
  }

  let created;
  try {
    created = await requestEnvelope(context.fetchImpl, context.collectionUrl, {
      method: "POST",
      headers: context.headers,
      body: JSON.stringify({ queue_name: queueName }),
    });
  } catch (error) {
    if (!(error instanceof RetryableCloudflareLookupError)) throw error;
    const raced = await lookupQueue(context, queueName);
    if (raced.queue) {
      context.logger.log(`Queue "${queueName}" was created concurrently`);
      return { queueName, created: false };
    }
    throw error;
  }
  if (!isSuccessfulEnvelope(created)) {
    const raced = await lookupQueue(context, queueName);
    if (raced.queue) {
      context.logger.log(`Queue "${queueName}" was created concurrently`);
      return { queueName, created: false };
    }
    throw apiFailure("create", created);
  }

  const verified = await lookupQueue(context, queueName);
  if (!verified.queue) throw apiFailure("post-create verification", verified.response);
  context.logger.log(`Created Queue "${queueName}"`);
  return { queueName, created: true };
}

async function lookupQueue(context, queueName) {
  const exactMatches = [];
  let page = 1;
  let response;

  do {
    const url = new URL(context.collectionUrl);
    url.searchParams.set("page", String(page));
    response = await withCloudflareLookupRetry({
      apiName: "Cloudflare Queues API",
      logger: context.logger,
      sleepImpl: context.sleepImpl,
      retryDelaysMs: context.retryDelaysMs,
      request: async () => {
        const pageResponse = await requestEnvelope(
          context.fetchImpl,
          url,
          { method: "GET", headers: context.headers },
        );
        if (isTransientCloudflareStatus(pageResponse.status)) {
          throw new RetryableCloudflareLookupError(apiFailure("lookup", pageResponse).message);
        }
        return pageResponse;
      },
    });
    if (!isSuccessfulEnvelope(response)) throw apiFailure("lookup", response);
    if (!Array.isArray(response.payload.result)) {
      throw new Error(`Cloudflare Queues API returned an invalid queue list (status ${response.status})`);
    }
    exactMatches.push(...response.payload.result.filter(
      (queue) => isRecord(queue) && queue.queue_name === queueName,
    ));
    page = nextQueueListPage(response.payload.result_info, page, response.status);
  } while (page !== null);

  if (exactMatches.length > 1) {
    throw new Error(`Cloudflare Queues API returned multiple exact matches for Queue "${queueName}"`);
  }
  return { queue: exactMatches[0] || null, response };
}

function nextQueueListPage(resultInfo, requestedPage, status) {
  if (resultInfo === undefined) return null;
  if (!isRecord(resultInfo)) {
    throw new Error(`Cloudflare Queues API returned invalid pagination (status ${status})`);
  }

  const page = resultInfo.page;
  const totalPages = resultInfo.total_pages;
  if (page === undefined && totalPages === undefined) return null;
  if (
    !Number.isInteger(page)
    || page !== requestedPage
    || !Number.isInteger(totalPages)
    || totalPages < 0
    || totalPages > MAX_QUEUE_LIST_PAGES
    || (totalPages === 0 ? page !== 1 : totalPages < page)
  ) {
    throw new Error(`Cloudflare Queues API returned invalid pagination (status ${status})`);
  }
  return page < totalPages ? page + 1 : null;
}

function validateInputs({ accountId, apiToken, queueName, deadLetterQueueName }) {
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  const normalizedToken = typeof apiToken === "string" ? apiToken.trim() : "";
  const normalizedQueueName = normalizeQueueName(queueName, "CHATUS_DOCUMENT_INGEST_QUEUE_NAME");
  const normalizedDeadLetterQueueName = normalizeQueueName(
    deadLetterQueueName,
    "CHATUS_DOCUMENT_INGEST_DLQ_NAME",
  );
  if (!/^[a-f0-9]{32}$/iu.test(normalizedAccountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is invalid");
  if (!normalizedToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
  if (normalizedQueueName === normalizedDeadLetterQueueName) {
    throw new Error("Document ingest Queue and DLQ names must be different");
  }
  return {
    accountId: normalizedAccountId,
    apiToken: normalizedToken,
    queueName: normalizedQueueName,
    deadLetterQueueName: normalizedDeadLetterQueueName,
  };
}

function normalizeQueueName(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(normalized)) {
    throw new Error(`${name} is invalid`);
  }
  return normalized;
}

async function requestEnvelope(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new RetryableCloudflareLookupError(
      "Cloudflare Queues API request failed before receiving a response",
    );
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    const message = `Cloudflare Queues API returned invalid JSON (status ${response.status})`;
    if (isTransientCloudflareStatus(response.status)) throw new RetryableCloudflareLookupError(message);
    throw new Error(message);
  }
  if (
    !isRecord(payload)
    || (payload.success !== undefined && typeof payload.success !== "boolean")
    || (payload.errors != null && !Array.isArray(payload.errors))
    || (payload.messages != null && !Array.isArray(payload.messages))
  ) {
    throw new Error(
      `Cloudflare Queues API returned an invalid envelope (status ${response.status}; shape ${envelopeShape(payload)})`,
    );
  }
  if (payload.errors == null) payload.errors = [];
  if (payload.messages == null) payload.messages = [];
  return { status: response.status, ok: response.ok, payload };
}

function isSuccessfulEnvelope(response) {
  return response.ok && response.payload.success !== false;
}

function apiFailure(action, response) {
  const codes = response.payload.errors
    .flatMap((error) => isRecord(error) && Number.isFinite(Number(error.code)) ? [String(error.code)] : [])
    .slice(0, 3);
  return new Error(
    `Cloudflare Queue ${action} failed (status ${response.status}${codes.length ? `, codes ${codes.join(",")}` : ""})`,
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function envelopeShape(payload) {
  if (!isRecord(payload)) return valueShape(payload);
  return ["success", "errors", "messages", "result", "result_info"]
    .map((name) => `${name}=${Object.hasOwn(payload, name) ? valueShape(payload[name]) : "missing"}`)
    .join(",");
}

function valueShape(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

async function main() {
  await provisionDocumentIngestQueues({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    queueName: process.env.CHATUS_DOCUMENT_INGEST_QUEUE_NAME,
    deadLetterQueueName: process.env.CHATUS_DOCUMENT_INGEST_DLQ_NAME,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
