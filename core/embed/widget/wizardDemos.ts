import type { DemoCaseId } from "../demo/demoCase";
import { demoCase } from "../demo/demoCase";
import { CLIMATE_DEMO } from "./wizardClimateScript";
import { INBOX_DEMO } from "./wizardInboxScript";
import { LISBON_DEMO } from "./wizardLisbonScript";
import { WATER_DEMO } from "./wizardScript";
import type { WizardDemoScript } from "./wizardDemoScript";

/**
 * Every recording, keyed by the landing button that picks one.
 *
 * A lookup rather than a branch: the director, the typing loop and the
 * fixture all ask the same question ("which story is this?") and must not
 * each keep their own copy of the answer.
 */
export const WIZARD_DEMOS: Record<DemoCaseId, WizardDemoScript> = {
  "water-tracker": WATER_DEMO,
  "linear-github-todos": INBOX_DEMO,
  "lisbon-countdown": LISBON_DEMO,
  "tado-room-climate": CLIMATE_DEMO,
};

export function currentWizardDemo(): WizardDemoScript {
  return WIZARD_DEMOS[demoCase()];
}
