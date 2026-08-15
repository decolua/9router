import { createHealthCheck } from "../shared/healthCheck.js";
import { HEALTH_CHECK } from "./config.js";

const { probeUrlAlive, waitForHealth } = createHealthCheck(HEALTH_CHECK);

export { probeUrlAlive, waitForHealth };
