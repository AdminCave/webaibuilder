/**
 * Adapter to the real deploy engine (`@webaibuilder/deploy`). Bundles exactly
 * the functions that {@link DeployService} consumes via the {@link DeployEngine}
 * interface. The only place in the desktop main that imports the
 * (node/ssh2/basic-ftp-heavy) deploy package — tests inject a fake instead.
 */

import { deploy, detectDrift, preflight, rollback } from '@webaibuilder/deploy';

import type { DeployEngine } from './deployService';

export const realDeployEngine: DeployEngine = { preflight, deploy, rollback, detectDrift };
