/**
 * Adapter auf die echte Deploy-Engine (`@webaibuilder/deploy`). Bündelt genau
 * die Funktionen, die {@link DeployService} über die {@link DeployEngine}-
 * Schnittstelle konsumiert. Der einzige Ort im Desktop-Main, der das
 * (node-/ssh2-/basic-ftp-lastige) Deploy-Paket importiert — Tests injizieren
 * stattdessen einen Fake.
 */

import { deploy, detectDrift, preflight, rollback } from '@webaibuilder/deploy';

import type { DeployEngine } from './deployService';

export const realDeployEngine: DeployEngine = { preflight, deploy, rollback, detectDrift };
