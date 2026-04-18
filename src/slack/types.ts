export interface SlackSlashCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackInteractionPayload {
  type: "view_submission" | "block_actions" | "block_suggestion";
  trigger_id: string;
  user: { id: string; username: string };
  view?: SlackViewPayload;
  actions?: SlackBlockAction[];
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string };
}

export interface SlackViewPayload {
  id: string;
  callback_id: string;
  private_metadata: string;
  state: {
    values: Record<string, Record<string, SlackInputValue>>;
  };
}

export interface SlackInputValue {
  type: string;
  value?: string;
  selected_option?: { value: string };
}

export interface SlackBlockAction {
  action_id: string;
  block_id: string;
  value?: string;
}

export interface AuditModalMetadata {
  channelId: string;
  threadTs?: string;
  userId: string;
}

export interface FixModalMetadata {
  channelId: string;
  threadTs?: string;
  messageTs: string;
  userId: string;
  owner: string;
  repo: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  pullNumber: number;
  installationId: number;
}

export interface SlackHandlerResult {
  status: number;
  body: Record<string, unknown> | string;
  contentType?: string;
}
