/**
 * The Amharic dictionary, one file per area of the app. A key in two files must have the same
 * Amharic (i18n:check reports a clash).
 */
import { ADMIN } from "./admin";
import { BILLING } from "./billing";
import { COMMON } from "./common";
import { CONSULTATION } from "./consultation";
import { FRONT_DESK } from "./front-desk";
import { LAB } from "./lab";
import { MCH } from "./mch";
import { MESSAGES } from "./messages";
import { OFFLINE } from "./offline";
import { PHARMACY } from "./pharmacy";
import { REPORTS } from "./reports";
import { AUDIT } from "./audit";
import { SHELL } from "./shell";

export const AM: Record<string, string> = { ...COMMON, ...SHELL, ...FRONT_DESK, ...CONSULTATION, ...LAB, ...PHARMACY, ...BILLING, ...MCH, ...ADMIN, ...REPORTS, ...AUDIT, ...OFFLINE, ...MESSAGES };

/** The server's messages on their own: lib/i18n.ts also matches the templated ones as patterns. */
export { MESSAGES };
