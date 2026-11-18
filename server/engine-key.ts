import { z } from "zod";
import { platformName } from "./platforms.js";

/**
 * An engine is where answers come from: the connection (provider) and the answer surface (platform). ChatGPT by API
 * and the ChatGPT app through SurfacedBy are two engines, because answers from different surfaces are never combined.
 */
export const engineParam = z.string().regex(/^[a-z][a-z0-9_]{0,31}:[a-z][a-z0-9_]{0,63}$/);
export const engineChoice = z.union([z.literal("all"), engineParam]);
export type EngineChoice = z.infer<typeof engineChoice>;

/** DeepSeek checks are stored with platform `deepseek`; older jobs without a provider were ChatGPT checks. */
export function engineKey(job: { provider?: string | null; platform?: string | null }) {
  const provider = job.provider ?? "chatgpt";
  return provider + ":" + (provider === "deepseek" ? "deepseek" : job.platform ?? "chat_gpt");
}

/** A reader-facing name: the answer surface, and the connection when it is not the engine's own API. */
export function engineName(job: { provider?: string | null; platform?: string | null }) {
  const key = engineKey(job), provider = key.slice(0, key.indexOf(":")), platform = key.slice(key.indexOf(":") + 1);
  if (provider === "console") return platformName(platform) + " through SurfacedBy";
  if (provider === "dataforseo") return platformName(platform) + " through DataForSEO";
  return provider === "openrouter" ? "OpenRouter" : platformName(platform);
}
