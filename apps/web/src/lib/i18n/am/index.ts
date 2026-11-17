/**
 * The Amharic dictionary, one file per area of the app. A key in two files must have the same
 * Amharic (i18n:check reports a clash).
 */
import { COMMON } from "./common";
import { CONSULTATION } from "./consultation";
import { FRONT_DESK } from "./front-desk";
import { LAB } from "./lab";
import { PHARMACY } from "./pharmacy";
import { SHELL } from "./shell";

export const AM: Record<string, string> = { ...COMMON, ...SHELL, ...FRONT_DESK, ...CONSULTATION, ...LAB, ...PHARMACY };
