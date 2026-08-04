const productionAcceptanceLabelPattern = /^codex-accept-[0-9a-f]{24}-(a|b)$/u;

export function isProductionAcceptanceLabel(label) {
  return productionAcceptanceLabelPattern.test(label);
}

export async function retryTemporaryMemberDeletion(
  run,
  {
    allowUnauthorized = false,
    wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    attempts = 8,
    delayMs = 5_000,
  } = {},
) {
  let deletionMayHaveRevokedSession = false;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await run();
    if (status === 200 || (status === 401 && (allowUnauthorized || deletionMayHaveRevokedSession))) return;
    if (status !== 503 || attempt === attempts) {
      throw new Error(`temporary member deletion failed: HTTP ${status}`);
    }
    deletionMayHaveRevokedSession = true;
    await wait(delayMs);
  }
}

export async function runProductionAcceptanceCleanup({
  members,
  purgeMember,
  restoreAccess,
  logoutAdmin,
  verifyRelease,
}) {
  const failures = new Set();
  const attempt = async (operation, failureName) => {
    try {
      await operation();
    } catch {
      failures.add(failureName);
    }
  };

  for (const member of members) {
    await attempt(() => purgeMember(member), "member purge");
  }
  await attempt(restoreAccess, "access restoration");
  await attempt(logoutAdmin, "administrator logout");
  await attempt(verifyRelease, "release verification");

  if (failures.size > 0) {
    throw new Error(`production acceptance cleanup failed: ${[...failures].join(", ")}`);
  }
}
