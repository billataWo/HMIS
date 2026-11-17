import type { Me } from "./api";

/** Whether the clinic's plan includes a module (null features: every module). */
export const inPlan = (me: Me, feature: string) => !me.features || me.features.includes(feature);
