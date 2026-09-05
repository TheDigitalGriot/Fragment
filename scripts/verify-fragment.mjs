#!/usr/bin/env node
/**
 * Repo-root entry for Fragment's invariant gate.
 *
 * The gate itself now lives INSIDE packages/create-fragment/scripts/ so that a
 * PUBLISHED `create-fragment` install carries it (it is listed in package.json
 * "files"). A gate that only exists in the repo checkout is a control that
 * ships to nobody.
 *
 * This file stays so `node scripts/verify-fragment.mjs <dir>` keeps working
 * from the repo root — one implementation, two entry paths, no second copy to
 * drift out of sync. Importing it runs it: the gate reads process.argv and
 * exits with its own status.
 */
import '../packages/create-fragment/scripts/verify-fragment.mjs';
