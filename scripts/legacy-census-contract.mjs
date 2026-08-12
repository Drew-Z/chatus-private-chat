export function validateLegacySurfaceCensus(payload, expected) {
  const { surfaceId, days } = expected;
  assert(payload && typeof payload === "object" && !Array.isArray(payload), "census: invalid payload");
  assert(
    JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(["days", "generatedAt", "rows", "surfaceId", "version"]),
    "census: invalid top-level fields",
  );
  assert(payload.version === 1 && payload.surfaceId === surfaceId && payload.days === days, "census: identity mismatch");
  assert(Number.isSafeInteger(payload.generatedAt) && payload.generatedAt > 0, "census: invalid generation time");
  assert(Array.isArray(payload.rows) && payload.rows.length <= days * 20, "census: invalid row count");
  const identities = [];
  for (const row of payload.rows) {
    assert(
      row && typeof row === "object" && !Array.isArray(row)
      && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([
        "access", "callerClass", "count", "day", "deploymentSha", "lastOccurredAt",
      ]),
      "census: invalid row fields",
    );
    assert(/^\d{4}-\d{2}-\d{2}$/.test(row.day), "census: invalid day");
    assert(typeof row.callerClass === "string" && row.callerClass.length <= 40, "census: invalid caller class");
    assert(row.access === "read" || row.access === "write", "census: invalid access");
    assert(Number.isSafeInteger(row.count) && row.count > 0, "census: invalid count");
    assert(Number.isSafeInteger(row.lastOccurredAt) && row.lastOccurredAt > 0, "census: invalid occurrence time");
    assert(new Date(row.lastOccurredAt).toISOString().slice(0, 10) === row.day, "census: occurrence day mismatch");
    assert(/^[a-f0-9]{40}$/.test(row.deploymentSha), "census: invalid deployment SHA");
    identities.push(`${row.day}|${row.callerClass}|${row.access}`);
  }
  assert(identities.every((value, index) => index === 0 || identities[index - 1] < value), "census: rows not canonical");
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
