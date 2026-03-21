import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { CONFIG } from "../config.js";

export function getInstallationOctokit(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: CONFIG.appId,
      privateKey: CONFIG.privateKey,
      installationId,
    },
  });
}
