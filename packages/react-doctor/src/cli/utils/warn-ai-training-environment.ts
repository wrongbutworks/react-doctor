import { highlighter, warnAiTrainingLicenseOnce } from "@react-doctor/core";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";

export const warnIfAiTrainingEnvironment = (): void => {
  const detected = warnAiTrainingLicenseOnce({
    write: (message) => {
      process.stderr.write(`${highlighter.warn(`[react-doctor] ${message}`)}\n`);
    },
  });
  if (detected === null) return;
  recordCount(METRIC.aiTrainingWarningShown, 1, { environment: detected });
};
