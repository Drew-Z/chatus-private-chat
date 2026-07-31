import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTransientCloudflareStatus,
  RetryableCloudflareLookupError,
  withCloudflareLookupRetry,
} from "./cloudflare-api-retry.mjs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const R2_BUCKET_MISSING_CODE = 10006;

export async function provisionR2Bucket({
  accountId,
  apiToken,
  bucketName,
  fetchImpl = fetch,
  logger = console,
  sleepImpl,
  retryDelaysMs,
}) {
  const normalized = validateInputs({ accountId, apiToken, bucketName });
  const collectionUrl = `${CLOUDFLARE_API_BASE}/accounts/${normalized.accountId}/r2/buckets`;
  const bucketUrl = `${collectionUrl}/${encodeURIComponent(normalized.bucketName)}`;
  const headers = {
    Authorization: `Bearer ${normalized.apiToken}`,
    "Content-Type": "application/json",
  };

  const lookup = (url) => withCloudflareLookupRetry({
    apiName: "Cloudflare R2 API",
    logger,
    sleepImpl,
    retryDelaysMs,
    request: async () => {
      const response = await requestEnvelope(fetchImpl, url, { method: "GET", headers });
      if (isTransientCloudflareStatus(response.status)) {
        throw new RetryableCloudflareLookupError(apiFailure("lookup", response).message);
      }
      return response;
    },
  });

  const existing = await lookup(bucketUrl);
  if (isSuccessfulBucketResponse(existing, normalized.bucketName)) {
    logger.log(`R2 bucket "${normalized.bucketName}" already exists`);
    return { bucketName: normalized.bucketName, created: false };
  }
  if (!isMissingBucketResponse(existing)) throw apiFailure("lookup", existing);

  let created;
  try {
    created = await requestEnvelope(fetchImpl, collectionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: normalized.bucketName }),
    });
  } catch (error) {
    if (!(error instanceof RetryableCloudflareLookupError)) throw error;
    const raced = await lookup(bucketUrl);
    if (isSuccessfulBucketResponse(raced, normalized.bucketName)) {
      logger.log(`R2 bucket "${normalized.bucketName}" was created concurrently`);
      return { bucketName: normalized.bucketName, created: false };
    }
    throw error;
  }
  if (!isSuccessfulEnvelope(created)) {
    const raced = await lookup(bucketUrl);
    if (isSuccessfulBucketResponse(raced, normalized.bucketName)) {
      logger.log(`R2 bucket "${normalized.bucketName}" was created concurrently`);
      return { bucketName: normalized.bucketName, created: false };
    }
    throw apiFailure("create", created);
  }

  const verified = await lookup(bucketUrl);
  if (!isSuccessfulBucketResponse(verified, normalized.bucketName)) {
    throw apiFailure("post-create verification", verified);
  }
  logger.log(`Created R2 bucket "${normalized.bucketName}"`);
  return { bucketName: normalized.bucketName, created: true };
}

function validateInputs({ accountId, apiToken, bucketName }) {
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  const normalizedToken = typeof apiToken === "string" ? apiToken.trim() : "";
  const normalizedBucketName = typeof bucketName === "string" ? bucketName.trim() : "";
  if (!/^[a-f0-9]{32}$/u.test(normalizedAccountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID is invalid");
  if (!normalizedToken) throw new Error("CLOUDFLARE_API_TOKEN is required");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(normalizedBucketName)) {
    throw new Error("CHATUS_R2_BUCKET_NAME is invalid");
  }
  return {
    accountId: normalizedAccountId,
    apiToken: normalizedToken,
    bucketName: normalizedBucketName,
  };
}

async function requestEnvelope(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new RetryableCloudflareLookupError("Cloudflare R2 API request failed before receiving a response");
  }
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    const message = `Cloudflare R2 API returned invalid JSON (status ${response.status})`;
    if (isTransientCloudflareStatus(response.status)) throw new RetryableCloudflareLookupError(message);
    throw new Error(message);
  }
  if (
    !isRecord(payload)
    || typeof payload.success !== "boolean"
    || (payload.errors !== undefined && !Array.isArray(payload.errors))
  ) {
    throw new Error(`Cloudflare R2 API returned an invalid envelope (status ${response.status})`);
  }
  if (payload.errors === undefined) payload.errors = [];
  return { status: response.status, ok: response.ok, payload };
}

function isSuccessfulBucketResponse(response, bucketName) {
  return isSuccessfulEnvelope(response)
    && isRecord(response.payload.result)
    && response.payload.result.name === bucketName;
}

function isSuccessfulEnvelope(response) {
  return response.ok && response.payload.success === true;
}

function isMissingBucketResponse(response) {
  return response.status === 404
    && response.payload.success === false
    && response.payload.errors.some((error) => isRecord(error) && Number(error.code) === R2_BUCKET_MISSING_CODE);
}

function apiFailure(action, response) {
  const codes = response.payload.errors
    .flatMap((error) => isRecord(error) && Number.isFinite(Number(error.code)) ? [String(error.code)] : [])
    .slice(0, 3);
  return new Error(
    `Cloudflare R2 bucket ${action} failed (status ${response.status}${codes.length ? `, codes ${codes.join(",")}` : ""})`,
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  await provisionR2Bucket({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    bucketName: process.env.CHATUS_R2_BUCKET_NAME,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
