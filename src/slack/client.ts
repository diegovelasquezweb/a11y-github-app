import { WebClient } from "@slack/web-api";
import { CONFIG } from "../config.js";

let instance: WebClient | null | undefined;

export function getSlackClient(): WebClient | null {
  if (instance !== undefined) return instance;
  if (!CONFIG.slackBotToken) {
    instance = null;
    return null;
  }
  instance = new WebClient(CONFIG.slackBotToken);
  return instance;
}
