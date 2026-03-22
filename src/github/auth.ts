import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { CONFIG } from "../config.js";

function createAppOctokit(): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: CONFIG.appId,
      privateKey: CONFIG.privateKey,
    },
  });
}

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

export async function getRepoOctokit(owner: string, repo: string): Promise<Octokit> {
  const appOctokit = createAppOctokit();
  const installation = await appOctokit.rest.apps.getRepoInstallation({
    owner,
    repo,
  });

  return getInstallationOctokit(installation.data.id);
}
