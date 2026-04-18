import type { KnownBlock, WebClient } from "@slack/web-api";
import type { DomAuditSummary, SlackContext } from "../types.js";
import { formatAuditResultBlocks, formatScanningBlocks, formatFixProgressBlocks } from "./formatter.js";

export async function postScanningMessage(
  client: WebClient,
  channelId: string,
  owner: string,
  repo: string,
  mode: string,
  branch?: string,
  threadTs?: string,
): Promise<SlackContext | null> {
  try {
    const blocks = formatScanningBlocks(owner, repo, mode, branch) as unknown as KnownBlock[];
    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `⏳ Auditing ${owner}/${repo}…`,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    if (!result.ts) return null;
    return { channelId, messageTs: result.ts, threadTs: threadTs ?? result.ts };
  } catch (err) {
    console.warn("[slack] postScanningMessage failed:", err);
    return null;
  }
}

export async function updateWithAuditResults(
  client: WebClient,
  slackContext: SlackContext,
  summary: DomAuditSummary,
  context: { owner: string; repo: string; branch?: string; githubCommentUrl?: string },
): Promise<void> {
  try {
    const blocks = formatAuditResultBlocks(summary, context) as unknown as KnownBlock[];
    const total = summary.totalFindings + (summary.patternFindings?.totalFindings ?? 0);
    const text = summary.status === "failure"
      ? `❌ Audit failed — ${context.owner}/${context.repo}`
      : `🔍 ${total} findings — ${context.owner}/${context.repo}`;

    await client.chat.update({
      channel: slackContext.channelId,
      ts: slackContext.messageTs,
      blocks,
      text,
    });
  } catch (err) {
    const status = (err as { data?: { error?: string } }).data?.error;
    if (status === "message_not_found") {
      try {
        const blocks = formatAuditResultBlocks(summary, context) as unknown as KnownBlock[];
        await client.chat.postMessage({
          channel: slackContext.channelId,
          blocks,
          text: `🔍 Audit results — ${context.owner}/${context.repo}`,
          ...(slackContext.threadTs ? { thread_ts: slackContext.threadTs } : {}),
        });
      } catch (fallbackErr) {
        console.warn("[slack] updateWithAuditResults fallback failed:", fallbackErr);
      }
      return;
    }
    console.warn("[slack] updateWithAuditResults failed:", err);
  }
}

export async function postFixProgress(
  client: WebClient,
  slackContext: SlackContext,
  owner: string,
  repo: string,
  findingIds: string,
): Promise<SlackContext | null> {
  try {
    const blocks = formatFixProgressBlocks(owner, repo, findingIds) as unknown as KnownBlock[];
    const result = await client.chat.postMessage({
      channel: slackContext.channelId,
      blocks,
      text: `🔧 Fixing ${findingIds} — ${owner}/${repo}`,
      thread_ts: slackContext.threadTs ?? slackContext.messageTs,
    });
    if (!result.ts) return null;
    return { channelId: slackContext.channelId, messageTs: result.ts, threadTs: slackContext.threadTs ?? slackContext.messageTs };
  } catch (err) {
    console.warn("[slack] postFixProgress failed:", err);
    return null;
  }
}
