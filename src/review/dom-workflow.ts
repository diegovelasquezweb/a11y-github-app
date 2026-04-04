import type { Octokit } from "@octokit/rest";

interface DispatchDomAuditInput {
  runnerOctokit: Octokit;
  runnerOwner: string;
  runnerRepo: string;
  workflow: string;
  ref: string;
  scanToken: string;
  callbackUrl: string;
  callbackToken: string;
  targetOwner: string;
  targetRepo: string;
  pullNumber: number;
  headSha: string;
  checkRunId: number;
  targetToken: string;
}

export function createScanToken(owner: string, repo: string, pullNumber: number): string {
  const normalizedOwner = owner.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const normalizedRepo = repo.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `${normalizedOwner}-${normalizedRepo}-pr${pullNumber}-${Date.now()}`;
}

export async function dispatchDomAuditWorkflow(input: DispatchDomAuditInput): Promise<void> {
  await input.runnerOctokit.rest.actions.createWorkflowDispatch({
    owner: input.runnerOwner,
    repo: input.runnerRepo,
    workflow_id: input.workflow,
    ref: input.ref,
    inputs: {
      scan_token: input.scanToken,
      callback_url: input.callbackUrl,
      callback_token: input.callbackToken,
      target_owner: input.targetOwner,
      target_repo: input.targetRepo,
      pull_number: String(input.pullNumber),
      head_sha: input.headSha,
      check_run_id: String(input.checkRunId),
      target_token: input.targetToken,
    },
  });
}
