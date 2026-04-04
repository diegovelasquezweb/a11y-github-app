import type { Octokit } from "@octokit/rest";

interface DispatchFixWorkflowInput {
  runnerOctokit: Octokit;
  runnerOwner: string;
  runnerRepo: string;
  workflow: string;
  ref: string;
  targetOwner: string;
  targetRepo: string;
  pullNumber: number;
  headSha: string;
  baseRef: string;
  findingId: string;
  requestedBy: string;
  targetToken: string;
  checkRunId: number;
}

export async function dispatchFixWorkflow(input: DispatchFixWorkflowInput): Promise<void> {
  await input.runnerOctokit.rest.actions.createWorkflowDispatch({
    owner: input.runnerOwner,
    repo: input.runnerRepo,
    workflow_id: input.workflow,
    ref: input.ref,
    inputs: {
      target_owner: input.targetOwner,
      target_repo: input.targetRepo,
      pull_number: String(input.pullNumber),
      head_sha: input.headSha,
      base_ref: input.baseRef,
      finding_id: input.findingId,
      requested_by: input.requestedBy,
      target_token: input.targetToken,
      check_run_id: String(input.checkRunId),
    },
  });
}
