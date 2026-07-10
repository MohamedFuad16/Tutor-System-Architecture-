import dotenv from "dotenv";
dotenv.config();
import express from "express";
import * as fs from "fs";
import path from "path";
import compression from "compression";
import OpenAI from "openai";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer, WebSocket as WSWebSocket } from "ws";
import type { IncomingHttpHeaders, Server as HttpServer } from "http";
import {
  detectFreshnessSearch,
  formatSourcesForPrompt,
  searchSerper,
  type NormalizedWebSource,
  type WebSearchMode,
} from "./server/web-search.js";
import {
  createLearnerStore,
  learnerUserIdFromHeaders,
  normalizeLearnerUserId,
} from "./server/learner-store.js";
import {
  BRAIN_RUNTIME_SETTING_LIMITS,
  DEFAULT_BRAIN_RUNTIME_SETTINGS,
  MASTERY_EVIDENCE_POLICIES,
  WEB_SEARCH_POLICIES,
  normalizeBrainRuntimeSettings,
  type BrainRuntimeSettings,
} from "./src/lib/brainRuntimeSettings.js";
import { buildChatAgentToolDefinitions } from "./src/lib/chatAgentTools.js";
import { VOICE_AGENT_TOOL_DEFINITIONS } from "./src/lib/voiceAgentTools.js";

export {
  BRAIN_RUNTIME_SETTING_LIMITS,
  DEFAULT_BRAIN_RUNTIME_SETTINGS,
  MASTERY_EVIDENCE_POLICIES,
  WEB_SEARCH_POLICIES,
  normalizeBrainRuntimeSettings,
};

type ServerStartOptions = {
  host: string;
  port: number;
};

const DEEPGRAM_PRICING = {
  voiceAgentPerMinute: 0.075,
  aura1Per1kCharacters: 0.015,
  aura2Per1kCharacters: 0.03,
  fluxEnglishPerHour: 4.5,
};

type OpenRouterPricing = Record<
  string,
  { prompt: number; completion: number; name?: string }
>;

let pricingCache: {
  fetchedAt: number;
  models: OpenRouterPricing;
  stale: boolean;
} | null = null;

const PRICING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PCM16_MONO_48K_BYTES_PER_SECOND = 48000 * 2;
const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4-flash";
const LEARNING_AGENT_MODEL = "deepseek/deepseek-v4-flash";
const VOICE_FOREGROUND_MODEL =
  process.env.VOICE_FOREGROUND_MODEL || "openai/gpt-4o-mini";
const VOICE_BACKGROUND_MODEL =
  process.env.VOICE_BACKGROUND_MODEL ||
  process.env.GPT55_MODEL ||
  "openai/gpt-5.5";
const VOICE_BROKER_FAST_ACK = /^(1|true|yes|on)$/i.test(
  String(process.env.VOICE_BROKER_FAST_ACK || "").trim(),
);
const VOICE_BROKER_FAST_ACK_TEXT =
  process.env.VOICE_BROKER_FAST_ACK_TEXT || "Okay.";
const VOICE_BROKER_FAST_ACK_FILE = process.env.VOICE_BROKER_FAST_ACK_FILE || "";
const VOICE_BROKER_TTS_DEADLINE_MS = Math.max(
  50,
  Number(process.env.VOICE_BROKER_TTS_DEADLINE_MS || 180),
);
const VOICE_BROKER_STT_MODEL = process.env.VOICE_BROKER_STT_MODEL || "nova-3";
const VOICE_BROKER_TTS_MODEL =
  process.env.VOICE_BROKER_TTS_MODEL || "aura-2-thalia-en";
const VOICE_BROKER_TTS_SAMPLE_RATE = Math.max(
  8000,
  Number(process.env.VOICE_BROKER_TTS_SAMPLE_RATE || 48000),
);
const VOICE_BACKGROUND_TOOL_DEFINITIONS = [
  {
    name: "openrouter:web_search",
    description:
      "Delegate current web research to the GPT-5.5 background model through OpenRouter's hosted web search tool.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The learner's current/search/background request in natural language.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "create_pdf",
    description:
      "Delegate PDF creation or extraction work to the GPT-5.5 background model.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The requested PDF task.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "inspect_code",
    description:
      "Delegate code reading, bug fixing, or analysis work to the GPT-5.5 background model.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The code task to inspect.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "analyze_request",
    description:
      "Delegate slow analysis, planning, file work, and non-teaching background tasks while the foreground tutor keeps speaking.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The background work to perform.",
        },
      },
      required: ["task"],
    },
  },
] as const;
const OPENROUTER_SERVER_FALLBACK_FLAG = "ALLOW_SERVER_OPENROUTER_FALLBACK";
const DEEPGRAM_SERVER_FALLBACK_FLAG = "ALLOW_SERVER_DEEPGRAM_FALLBACK";
const MAX_DOCUMENT_UPLOAD_MB = 50;
const MAX_DOCUMENT_UPLOAD_BYTES = MAX_DOCUMENT_UPLOAD_MB * 1024 * 1024;

const roundCost = (value: number) =>
  Math.round((value || 0) * 1_000_000) / 1_000_000;

const estimateTokensFromText = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return Math.max(1, Math.ceil(text.length / 4));
};

const ttsCostForModel = (model: string, characters: number) => {
  const rate = model.includes("aura-2")
    ? DEEPGRAM_PRICING.aura2Per1kCharacters
    : DEEPGRAM_PRICING.aura1Per1kCharacters;
  return roundCost((Math.max(0, characters) / 1000) * rate);
};

const MISO_TTS_8B_VOICE = "miso-tts-8b";
const MISO_TTS_HEALTH_TIMEOUT_MS = 800;
const VOICE_WS_BUFFER_HIGH_WATER_BYTES = 1_000_000;
const VOICE_AGENT_MESSAGE_BUFFER_LIMIT = 80;

const readMisoTtsApiUrlOverride = (headers: IncomingHttpHeaders) => {
  const raw = headers["x-miso-tts-api-url"];
  if (Array.isArray(raw)) return raw[0] || "";
  return typeof raw === "string" ? raw : "";
};

const isLoopbackHostnameValue = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
};

const misoTtsApiBaseUrl = (overrideUrl = "") => {
  const raw = (
    overrideUrl.trim() ||
    process.env.MISO_TTS_API_URL ||
    "http://127.0.0.1:8080"
  ).trim();
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("MisoTTS API URL must use http or https.");
  }
  if (!isLoopbackHostnameValue(parsed.hostname)) {
    throw new Error(
      "MisoTTS API URL must point to a loopback host such as localhost or 127.0.0.1.",
    );
  }
  return parsed.toString().replace(/\/+$/, "");
};

const probeMisoTtsHealth = async (overrideUrl = "") => {
  let baseUrl = "";
  try {
    baseUrl = misoTtsApiBaseUrl(overrideUrl);
  } catch (error) {
    return {
      configured: false,
      reachable: false,
      status: 0,
      error: error instanceof Error ? error.message : "Invalid MisoTTS URL",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    MISO_TTS_HEALTH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      configured: true,
      reachable: response.ok,
      status: response.status,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      status: 0,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Health probe timed out"
          : error instanceof Error
            ? error.message
            : "MisoTTS health probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const voiceAgentCostForSeconds = (seconds: number) =>
  roundCost((Math.max(0, seconds) / 60) * DEEPGRAM_PRICING.voiceAgentPerMinute);

const rawByteLength = (data: any) => {
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (Array.isArray(data))
    return data.reduce((sum, chunk) => sum + rawByteLength(chunk), 0);
  if (typeof data === "string") return Buffer.byteLength(data);
  return Buffer.byteLength(Buffer.from(data));
};

const compactActivityText = (value: unknown, maxLength = 180) => {
  const compact =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!compact) return "";
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 3)}...`;
};

const extractSpeechTextFromStructuredValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const preferredFields = [
    "spoken",
    "speech",
    "answer",
    "summary",
    "content",
    "text",
    "result",
    "message",
  ];
  for (const field of preferredFields) {
    const extracted = extractSpeechTextFromStructuredValue(record[field]);
    if (extracted) return extracted;
  }
  const firstString = Object.values(record).find(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  );
  return typeof firstString === "string" ? firstString : "";
};

const normalizeSpokenMarkdown = (value: string) =>
  value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

const backgroundTransitionFor = (text: string) => {
  const value = text.toLowerCase();
  if (/\b(stock|share|ticker|market|quote|price|prices)\b/.test(value)) {
    return "Also";
  }
  if (/\b(code|debug|bug|error|repo|repository|fix|implement)\b/.test(value)) {
    return "One more thing";
  }
  if (/\b(pdf|file|document|create|generate|download)\b/.test(value)) {
    return "Quick update";
  }
  if (
    /\b(source|sources|web|search|latest|current|news|research)\b/.test(value)
  ) {
    return "I found it";
  }
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return ["Also", "By the way", "Quick update", "One more thing"][
    Math.abs(hash) % 4
  ];
};

const normalizeBackgroundSpokenInsertion = (value: unknown) => {
  let text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  text = text
    .replace(/^```(?:json|markdown|text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (/^[{[]/.test(text)) {
    try {
      const extracted = extractSpeechTextFromStructuredValue(JSON.parse(text));
      if (extracted) text = extracted;
    } catch {
      // Fall through to the text cleanup path.
    }
  }
  text = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(
      /\b(?:foreground|background|tool|function)\s*(?:result|call)\s*:\s*/gi,
      "",
    )
    .replace(
      /\b(?:background\s+check|background\s+update|summary|answer)\s*:\s*/gi,
      "",
    )
    .replace(/\[(?:source|citation|ref|reference)\s*\d+\]/gi, "")
    .replace(/\[[0-9,\s]+\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  text = normalizeSpokenMarkdown(text);
  if (!text) return "";
  if (
    /^(by the way|also|quick note|quick update|one more thing|i found it)\b/i.test(
      text,
    )
  ) {
    return compactActivityText(text, 1400);
  }
  const transition = backgroundTransitionFor(text);
  const separator = /^(quick update|one more thing|i found it)$/i.test(
    transition,
  )
    ? ": "
    : ", ";
  return compactActivityText(`${transition}${separator}${text}`, 1400);
};

const estimateSpokenTextMs = (text: string) => {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(24_000, Math.max(1_600, wordCount * 340));
};

const sanitizeApiKey = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key || key === "undefined" || key === "null") return "";
  return key;
};

const isTruthyEnv = (value: unknown) =>
  /^(1|true|yes|on)$/i.test(String(value || "").trim());

type RequestLike = {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | null };
  url?: string;
};

const firstHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || "" : value || "";

const hostNameFromHeader = (host: string | string[] | undefined) => {
  const rawHost = firstHeader(host).trim().toLowerCase();
  if (!rawHost) return "";
  if (rawHost.startsWith("[")) {
    const end = rawHost.indexOf("]");
    return end > 0 ? rawHost.slice(1, end) : rawHost;
  }
  return rawHost.split(":")[0];
};

const isLoopbackHost = (host: string | string[] | undefined) => {
  const hostname = hostNameFromHeader(host);
  return isLoopbackHostnameValue(hostname);
};

const isLoopbackAddress = (address?: string | null) => {
  const normalized = String(address || "").replace(/^::ffff:/, "");
  return normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
};

const debugAdminToken = sanitizeApiKey(
  process.env.TUTOR_DEBUG_TOKEN || process.env.ADMIN_DEBUG_TOKEN,
);

const tokenFromAuthorization = (authorization: string) => {
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
};

const getOpenRouterServerFallbackKey = () =>
  isTruthyEnv(process.env[OPENROUTER_SERVER_FALLBACK_FLAG])
    ? sanitizeApiKey(process.env.OPENROUTER_API_KEY)
    : "";

const getDeepgramServerFallbackKey = () =>
  isTruthyEnv(process.env[DEEPGRAM_SERVER_FALLBACK_FLAG])
    ? sanitizeApiKey(process.env.DEEPGRAM_API_KEY)
    : "";

const resolveOpenRouterApiKey = (headers: IncomingHttpHeaders) =>
  sanitizeApiKey(tokenFromAuthorization(firstHeader(headers.authorization))) ||
  getOpenRouterServerFallbackKey();

const openRouterRequiredMessage =
  "OpenRouter API key is required. Add your own key in Settings, or set ALLOW_SERVER_OPENROUTER_FALLBACK=true for a shared deployment fallback.";

const debugTokenFromRequest = (request: RequestLike) => {
  const headerToken = sanitizeApiKey(
    request.headers["x-debug-token"] ||
      request.headers["x-admin-token"] ||
      tokenFromAuthorization(firstHeader(request.headers.authorization)),
  );
  if (headerToken) return headerToken;

  try {
    const url = new URL(
      request.url || "",
      `http://${firstHeader(request.headers.host) || "localhost"}`,
    );
    return sanitizeApiKey(url.searchParams.get("debugToken"));
  } catch {
    return "";
  }
};

const isAuthorizedDebugRequest = (request: RequestLike) => {
  const requestToken = debugTokenFromRequest(request);
  if (debugAdminToken && requestToken === debugAdminToken) return true;

  return (
    process.env.NODE_ENV !== "production" &&
    isLoopbackHost(request.headers.host) &&
    isLoopbackAddress(request.socket.remoteAddress)
  );
};

// When the voice/signaling server runs on a separate host from the web app
// (e.g. the broker on an Azure VM while the app is served from Vercel), the
// app's origins must be listed here so their cross-origin WebSocket
// handshakes are accepted. Comma-separated full origins, e.g.
// "https://tutor-system-architecture.vercel.app,http://localhost:5173".
const VOICE_ALLOWED_ORIGINS = new Set(
  String(process.env.VOICE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, "").toLowerCase())
    .filter(Boolean),
);

// A browser always sends an Origin on a WebSocket handshake. Requiring it to
// match the host the app is served from blocks cross-site WebSocket hijacking
// while letting the deployed app's own page open the voice broker. Voice keys
// are supplied per-connection by the client (BYOK); server fallback keys stay
// gated behind the ALLOW_SERVER_* env flags regardless of this check.
const isSameOriginBrokerRequest = (request: RequestLike) => {
  const origin = firstHeader(request.headers.origin).trim();
  if (!origin) return false;
  let originHost = "";
  try {
    const parsedOrigin = new URL(origin);
    if (VOICE_ALLOWED_ORIGINS.has(parsedOrigin.origin.toLowerCase())) {
      return true;
    }
    originHost = parsedOrigin.host.toLowerCase();
  } catch {
    return false;
  }
  if (!originHost) return false;
  const forwardedHost = hostNameFromHeader(
    request.headers["x-forwarded-host"] as string | string[] | undefined,
  );
  const hostCandidates = [
    firstHeader(request.headers.host).trim().toLowerCase(),
    forwardedHost,
    hostNameFromHeader(request.headers.host),
  ].filter(Boolean);
  const originHostname = originHost.split(":")[0];
  return hostCandidates.some(
    (candidate) => candidate === originHost || candidate === originHostname,
  );
};

const isAuthorizedLocalVoiceBrokerRequest = (request: RequestLike) =>
  isAuthorizedDebugRequest(request) || isSameOriginBrokerRequest(request);

const wsCanSend = (socket: WSWebSocket | null | undefined) =>
  Boolean(
    socket &&
    socket.readyState === WSWebSocket.OPEN &&
    socket.bufferedAmount < VOICE_WS_BUFFER_HIGH_WATER_BYTES,
  );

const redactSensitiveUrl = (url: string) =>
  url.replace(
    /([?&](?:openRouterKey|deepgramKey|apiKey|debugToken|token|key)=)[^&]*/gi,
    "$1[redacted]",
  );

const normalizeVoiceLanguage = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const language = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return language === "ja" || language === "ko" ? language : "en";
};

const normalizeVoiceInputSampleRate = (value: unknown) => {
  const sampleRate = Number(value);
  if (!Number.isFinite(sampleRate)) return 48000;
  const rounded = Math.round(sampleRate);
  if (rounded < 8000 || rounded > 96000) return 48000;
  return rounded;
};

const VOICE_STUDY_CONTEXT_LIMIT = 8000;

const compactVoiceStudyContext = (value: unknown) => {
  const raw = typeof value === "string" ? value : "";
  const compact = raw.replace(/\n{3,}/g, "\n\n").trim();
  if (!compact) return "";
  if (compact.length <= VOICE_STUDY_CONTEXT_LIMIT) return compact;
  return `${compact.slice(0, VOICE_STUDY_CONTEXT_LIMIT - 68)}\n\n[Local voice context truncated by the server.]`;
};

const deepgramKeyFromRequest = (request: { headers: IncomingHttpHeaders }) =>
  sanitizeApiKey(
    request.headers["x-deepgram-key"] || request.headers["x-voice-key"],
  );

const normalizeModelPricing = (raw: any): OpenRouterPricing => {
  const models: OpenRouterPricing = {};
  const rows = Array.isArray(raw?.data) ? raw.data : [];
  rows.forEach((model: any) => {
    if (!model?.id || !model?.pricing) return;
    models[model.id] = {
      name: model.name,
      prompt: Number(model.pricing.prompt || 0),
      completion: Number(model.pricing.completion || 0),
    };
  });
  return models;
};

const fetchOpenRouterPricing = async (force = false) => {
  const now = Date.now();
  if (
    !force &&
    pricingCache &&
    now - pricingCache.fetchedAt < PRICING_CACHE_TTL_MS
  ) {
    return pricingCache;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok)
      throw new Error(`OpenRouter pricing failed: ${response.status}`);
    const payload = await response.json();
    pricingCache = {
      fetchedAt: now,
      models: normalizeModelPricing(payload),
      stale: false,
    };
    return pricingCache;
  } catch (error) {
    console.warn("[PRICING] OpenRouter pricing fetch failed:", error);
    if (pricingCache) return { ...pricingCache, stale: true };
    pricingCache = { fetchedAt: now, models: {}, stale: true };
    return pricingCache;
  }
};

const openRouterCost = (
  pricing: OpenRouterPricing,
  model: string,
  inputTokens: number,
  outputTokens: number,
) => {
  const modelPricing =
    pricing[model] ||
    pricing[model.replace(/^openai\//, "")] ||
    pricing[`openai/${model}`];
  if (!modelPricing) return 0;
  return roundCost(
    inputTokens * modelPricing.prompt + outputTokens * modelPricing.completion,
  );
};

type SystemActivityKind =
  | "system"
  | "model"
  | "tool"
  | "retrieval"
  | "memory"
  | "voice"
  | "web"
  | "error";

type SystemActivityStatus =
  | "started"
  | "progress"
  | "completed"
  | "failed"
  | "fallback"
  | "blocked";

type SystemActivityEvent = {
  id: string;
  timestamp: number;
  kind: SystemActivityKind;
  status: SystemActivityStatus;
  title: string;
  detail?: string;
  requestId?: string;
  model?: string;
  toolName?: string;
  phase?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

type SystemActivityInput = Omit<SystemActivityEvent, "id" | "timestamp">;

const SYSTEM_ACTIVITY_LIMIT = 250;

const activityId = () =>
  `activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeClientRequestId = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Za-z0-9_:-]{1,120}$/.test(trimmed) ? trimmed : "";
};

const safeActivityMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata) return undefined;
  const safe: Record<string, unknown> = {};
  Object.entries(metadata).forEach(([key, value]) => {
    if (/key|token|authorization|secret|password/i.test(key)) {
      safe[key] = "[redacted]";
      return;
    }
    if (typeof value === "string") {
      safe[key] = value.length > 420 ? `${value.slice(0, 417)}...` : value;
      return;
    }
    safe[key] = value;
  });
  return safe;
};

const objectMetadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const compactStringList = (value: unknown, limit = 12) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

const nonNegativeInteger = (value: unknown) => {
  const next = Number(value || 0);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
};

const compactBrainContextMetadata = (value: unknown) => {
  const metadata = objectMetadata(value);
  const scope = objectMetadata(metadata.scope);
  return {
    userId: normalizeLearnerUserId(metadata.userId || scope.userId),
    proofAttemptId: normalizeClientRequestId(metadata.proofAttemptId),
    mode: compactActivityText(metadata.mode, 40),
    agentLayer: compactActivityText(metadata.agentLayer, 60),
    activeBookId: compactActivityText(
      metadata.activeBookId || scope.activeBookId,
      160,
    ),
    activeBookTitle: compactActivityText(
      metadata.activeBookTitle || scope.activeBookTitle,
      200,
    ),
    activeDocumentId: compactActivityText(
      metadata.activeDocumentId || scope.activeDocumentId,
      160,
    ),
    documentIds: compactStringList(metadata.documentIds),
    readyDocumentIds: compactStringList(metadata.readyDocumentIds),
    contextDocumentIds: compactStringList(metadata.contextDocumentIds),
    documentCount: nonNegativeInteger(metadata.documentCount),
    readyDocumentCount: nonNegativeInteger(metadata.readyDocumentCount),
    unreadyDocumentCount: nonNegativeInteger(metadata.unreadyDocumentCount),
    omittedReadyDocumentCount: nonNegativeInteger(
      metadata.omittedReadyDocumentCount,
    ),
    rawContextChars: nonNegativeInteger(metadata.rawContextChars),
    memoryContextChars: nonNegativeInteger(metadata.memoryContextChars),
    activeBookContextChars: nonNegativeInteger(metadata.activeBookContextChars),
    documentContextChars: nonNegativeInteger(metadata.documentContextChars),
    contextCompacted: Boolean(metadata.contextCompacted),
  };
};

const compactRuntimeSettings = (settings: BrainRuntimeSettings) => ({
  webSearchPolicy: settings.webSearchPolicy,
  masteryEvidencePolicy: settings.masteryEvidencePolicy,
  toolIterationLimit: settings.toolIterationLimit,
  memoryConceptLimit: settings.memoryConceptLimit,
  activityRefreshMs: settings.activityRefreshMs,
  bktTransitProbability: settings.bktTransitProbability,
  bktSlipProbability: settings.bktSlipProbability,
  bktGuessProbability: settings.bktGuessProbability,
});

const stripWebSearchSystemPrefix = (text: string) =>
  text
    .replace(
      /^\[SYSTEM:\s*The user has explicitly selected the Web Search skill\.[^\]]*\]\s*/i,
      "",
    )
    .trim();

const searchDetectionForExplicitRequest = (
  text: string,
): { query: string; mode: WebSearchMode } => {
  const cleanText = stripWebSearchSystemPrefix(text) || text;
  const explicitSearch = detectFreshnessSearch(`search the web ${cleanText}`);
  if (explicitSearch) {
    return {
      ...explicitSearch,
      query: cleanText.trim().slice(0, 240),
    };
  }
  const mode: WebSearchMode = /\b(news|today|headline|headlines)\b/i.test(
    cleanText,
  )
    ? "news"
    : "search";
  return { query: cleanText.trim().slice(0, 240), mode };
};

const slugifyId = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "general-study";

const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : trimmed;

  try {
    return JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(jsonStr.slice(start, end + 1));
    }
    throw new Error("Learning agent returned non-JSON content.");
  }
};

const fallbackLearningUpdate = (body: any) => {
  const project = String(body?.activeProject || "").trim();
  const userMessage = String(body?.userMessage || "").trim();
  const assistantMessage = String(body?.assistantMessage || "").trim();
  const cleanAssistant =
    assistantMessage
      .replace(/\bPrompt:\s*/gi, "")
      .replace(/\bLearning note:\s*/gi, "")
      .replace(/\bReview hook:[\s\S]*$/gi, "")
      .replace(/\s+/g, " ")
      .trim() ||
    userMessage.replace(/\s+/g, " ").trim() ||
    "The learner explored a tutor concept.";
  const title =
    project && project !== "General Study"
      ? project
      : userMessage.match(
          /\b(Python|JavaScript|React|TypeScript|Algorithms|System Design|Concurrency|Networking|Machine Learning|Calculus|History)\b/i,
        )?.[0] || "General Study";
  const conceptName =
    title === "General Study" ? "General Conversation" : title;
  return {
    userName: String(body?.userName || "Learner").trim() || "Learner",
    bookTitle: title,
    bookSource: "chat",
    overview: `A session learning book collecting the learner's tutor conversations about ${title}.`,
    chapterTitle: title === "General Study" ? "Conversation Notes" : title,
    chapterSummary: `Key idea: ${cleanAssistant}\n\nHow to review it: restate the idea, identify the mechanism, and test it with a fresh example.`,
    conversationSummary: `Revision note: ${cleanAssistant}\n\nReview check: explain the takeaway without looking, then apply it to a new example.`,
    knowledgeSummary: `Current learning focus: ${conceptName}. The learner should revise the core takeaway, the mechanism behind it, and one example application.`,
    conceptsLearned: [conceptName],
    risks: [] as string[],
    confidence: 0.45,
    concepts: [
      {
        name: conceptName,
        summary: `Key idea: ${cleanAssistant}\n\nApplication: turn the answer into a short explanation and one test example.`,
        mastery: 0.35,
        confidence: 0.45,
        parentConcepts: [] as string[],
        childConcepts: [] as string[],
        evidence: [userMessage.slice(0, 160)].filter(Boolean),
      },
    ],
    model: "local-session-fallback",
  };
};

type TutorServerAppOptions = {
  serveClient?: boolean;
  voiceProvider?: "deepgram" | "mock";
};

export async function createTutorServerApp(
  options: TutorServerAppOptions = {},
) {
  const app = express();

  app.use(compression());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));

  const uploadDir =
    process.env.TUTOR_UPLOAD_DIR ||
    (process.env.VERCEL
      ? path.join("/tmp", "tutor-uploads")
      : path.join(process.cwd(), "uploads"));
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      const originalName = file.originalname.toLowerCase();
      const mimeType = file.mimetype.toLowerCase();
      const isPdf =
        originalName.endsWith(".pdf") &&
        [
          "application/pdf",
          "application/x-pdf",
          "application/octet-stream",
        ].includes(mimeType);
      if (!isPdf) {
        cb(new Error("Only PDF documents are supported."));
        return;
      }
      cb(null, true);
    },
  });
  const learnerStore = createLearnerStore();

  const documentUpload: express.RequestHandler = (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message =
          error.code === "LIMIT_FILE_SIZE"
            ? `Document is too large. Upload a PDF up to ${MAX_DOCUMENT_UPLOAD_MB} MB.`
            : error.message;
        res.status(status).json({ error: message });
        return;
      }

      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Invalid document upload.",
      });
    });
  };

  // Log incoming requests for the Admin Server Console
  app.use((req, res, next) => {
    if (
      !req.url.startsWith("/src/") &&
      !req.url.startsWith("/node_modules/") &&
      !req.url.startsWith("/@")
    ) {
      console.log(`[HTTP] ${req.method} ${redactSensitiveUrl(req.url)}`);
    }
    next();
  });

  // WebSocket Server for Console Broadcaster
  const wssDebug = new WebSocketServer({ noServer: true });
  let debugClients: WSWebSocket[] = [];
  const logHistory: string[] = []; // Buffer to store last 100 logs

  wssDebug.on("connection", (ws) => {
    debugClients.push(ws);
    // Flush history to newly connected client
    logHistory.forEach((payload) => {
      if (ws.readyState === WSWebSocket.OPEN) ws.send(payload);
    });

    ws.on("close", () => {
      debugClients = debugClients.filter((c) => c !== ws);
    });
  });

  // Override console methods to broadcast
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const broadcastLog = (type: "log" | "error" | "warn", args: any[]) => {
    const msg = args
      .map((a) => {
        if (a instanceof Error) {
          return a.stack || a.message;
        }
        if (typeof a === "object" && a !== null) {
          try {
            return JSON.stringify(a);
          } catch (e) {
            return "[Circular object]";
          }
        }
        return String(a);
      })
      .join(" ");
    const payload = JSON.stringify({ type, timestamp: Date.now(), msg });
    logHistory.push(payload);
    if (logHistory.length > 100) logHistory.shift(); // Keep only last 100

    debugClients.forEach((c) => {
      if (c.readyState === WSWebSocket.OPEN) c.send(payload);
    });
  };

  console.log = (...args) => {
    broadcastLog("log", args);
    originalLog.apply(console, args);
  };
  console.error = (...args) => {
    broadcastLog("error", args);
    originalError.apply(console, args);
  };
  console.warn = (...args) => {
    broadcastLog("warn", args);
    originalWarn.apply(console, args);
  };

  const systemActivityEvents: SystemActivityEvent[] = [];
  const recordSystemActivity = (input: SystemActivityInput) => {
    const event: SystemActivityEvent = {
      id: activityId(),
      timestamp: Date.now(),
      ...input,
      metadata: safeActivityMetadata(input.metadata),
    };
    systemActivityEvents.unshift(event);
    if (systemActivityEvents.length > SYSTEM_ACTIVITY_LIMIT) {
      systemActivityEvents.length = SYSTEM_ACTIVITY_LIMIT;
    }
    return event;
  };
  const summarizeSystemActivity = () => {
    const byKind: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let latestError: SystemActivityEvent | null = null;

    systemActivityEvents.forEach((event) => {
      byKind[event.kind] = (byKind[event.kind] || 0) + 1;
      byStatus[event.status] = (byStatus[event.status] || 0) + 1;
      if (
        !latestError &&
        (event.kind === "error" || event.status === "failed")
      ) {
        latestError = event;
      }
    });

    return {
      total: systemActivityEvents.length,
      byKind,
      byStatus,
      latestError,
      latestEventAt: systemActivityEvents[0]?.timestamp || null,
      retentionLimit: SYSTEM_ACTIVITY_LIMIT,
    };
  };
  const debugRequestLike = (req: express.Request): RequestLike => ({
    headers: req.headers,
    socket: { remoteAddress: req.socket.remoteAddress },
    url: req.originalUrl || req.url,
  });
  const applyDebugCors = (req: express.Request, res: express.Response) => {
    const origin = firstHeader(req.headers.origin);
    if (!origin) return;

    let allowed = false;
    if (origin === "null") {
      allowed = process.env.NODE_ENV !== "production";
    } else {
      try {
        allowed = isLoopbackHost(new URL(origin).host);
      } catch {
        allowed = false;
      }
    }

    if (!allowed) return;

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Debug-Token, X-Admin-Token, X-LearningAI-User-Id",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  };

  recordSystemActivity({
    kind: "system",
    status: "completed",
    title: "Local system activity ledger initialized",
    detail:
      "Admin can inspect recent local model, tool, retrieval, memory, and error events.",
    metadata: {
      runtime: process.env.VERCEL ? "vercel" : "node",
      localOnly: true,
      retentionLimit: SYSTEM_ACTIVITY_LIMIT,
    },
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "tutor-server",
      runtime: process.env.VERCEL ? "vercel" : "node",
      providers: {
        openRouter: Boolean(getOpenRouterServerFallbackKey()),
        openRouterByok: true,
        serper: Boolean(sanitizeApiKey(process.env.SERPER_API_KEY)),
        deepgram: Boolean(getDeepgramServerFallbackKey()),
      },
    });
  });

  app.get("/api/learner/profile", (req, res) => {
    const userId = learnerUserIdFromHeaders(req.headers);
    const profile = learnerStore.ensureProfile(
      userId,
      typeof req.query.displayName === "string"
        ? req.query.displayName
        : "Learner",
    );
    res.json({
      ok: true,
      profile: {
        userId: profile.userId,
        displayName: profile.displayName,
        storageProvider: "server-local-sqlite",
      },
    });
  });

  app.post("/api/learner/profile", (req, res) => {
    const userId = normalizeLearnerUserId(
      req.body?.userId || learnerUserIdFromHeaders(req.headers),
    );
    const profile = learnerStore.ensureProfile(
      userId,
      req.body?.displayName || "Learner",
    );
    recordSystemActivity({
      kind: "memory",
      status: "completed",
      title: "Learner profile initialized",
      detail:
        "Local learner profile is mapped to a server-side SQLite brain folder.",
      metadata: {
        userId: profile.userId,
        storageProvider: "server-local-sqlite",
      },
    });
    res.json({
      ok: true,
      profile: {
        userId: profile.userId,
        displayName: profile.displayName,
        storageProvider: "server-local-sqlite",
      },
    });
  });

  app.post("/api/learner/migrate", (req, res) => {
    const userId = learnerUserIdFromHeaders(req.headers);
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    const safeRecords = records.slice(0, 2000).map((record: any) => ({
      userId,
      tableName: String(record?.tableName || "unknown"),
      recordId: String(record?.recordId || record?.id || "record"),
      record: record?.record ?? record,
    }));
    const result = learnerStore.copyMigrationRecords(safeRecords);
    recordSystemActivity({
      kind: "memory",
      status: "completed",
      title: "Learner cache migration snapshot copied",
      detail: `${result.copied} local cache row${result.copied === 1 ? "" : "s"} copied to the server learner store.`,
      metadata: {
        userId,
        copied: result.copied,
        destructive: false,
      },
    });
    res.json({ ok: true, ...result });
  });

  app.get("/api/learner/documents/:documentId/file", (req, res) => {
    const userId = normalizeLearnerUserId(
      req.query.userId || learnerUserIdFromHeaders(req.headers),
    );
    const document = learnerStore.getDocument(userId, req.params.documentId);
    if (!document || !fs.existsSync(document.filePath)) {
      return res.status(404).json({ error: "Document file not found." });
    }
    res.type(document.mimeType || "application/pdf");
    res.sendFile(document.filePath);
  });

  app.get("/api/learner/documents/:documentId/text", (req, res) => {
    const userId = normalizeLearnerUserId(
      req.query.userId || learnerUserIdFromHeaders(req.headers),
    );
    const document = learnerStore.getDocument(userId, req.params.documentId);
    if (!document) {
      return res.status(404).json({ error: "Document text not found." });
    }
    res.type("text/plain");
    res.send(learnerStore.readDocumentText(userId, req.params.documentId));
  });

  app.post("/api/learner/background-tasks", (req, res) => {
    const userId = learnerUserIdFromHeaders(req.headers);
    const taskId =
      typeof req.body?.taskId === "string" && req.body.taskId.trim()
        ? req.body.taskId.trim()
        : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const result = learnerStore.recordBackgroundTask({
      userId,
      taskId,
      requestId: req.body?.requestId,
      source: req.body?.source || "client",
      taskType: req.body?.taskType || req.body?.jobName || "background_task",
      status: req.body?.status || "queued",
      inputSummary: req.body?.inputSummary,
      outputSummary: req.body?.outputSummary,
      error: req.body?.error,
      metadata: req.body?.metadata,
    });
    recordSystemActivity({
      kind: "tool",
      status:
        result.status === "failed"
          ? "failed"
          : result.status === "queued" || result.status === "running"
            ? "started"
            : "completed",
      title: "Learner background task recorded",
      detail: `${result.taskId} is ${result.status}.`,
      requestId: req.body?.requestId,
      phase: "background_task",
      metadata: {
        userId,
        taskId: result.taskId,
        status: result.status,
      },
    });
    res.json({ ok: true, task: result });
  });

  app.options("/api/debug/system-activity", (req, res) => {
    applyDebugCors(req, res);
    res.status(204).end();
  });

  app.get("/api/debug/system-activity", async (req, res) => {
    applyDebugCors(req, res);
    if (!isAuthorizedDebugRequest(debugRequestLike(req))) {
      return res.status(403).json({
        error:
          "Debug activity requires a trusted local request or debug token.",
      });
    }

    const misoTtsHealth = await probeMisoTtsHealth(
      readMisoTtsApiUrlOverride(req.headers),
    );

    res.json({
      ok: true,
      service: "tutor-system-activity",
      generatedAt: new Date().toISOString(),
      localOnly: true,
      retention: {
        limit: SYSTEM_ACTIVITY_LIMIT,
        strategy: "newest-first in-memory ring buffer",
      },
      summary: summarizeSystemActivity(),
      meters: {
        providers: {
          openRouter: Boolean(getOpenRouterServerFallbackKey()),
          openRouterByok: true,
          serper: Boolean(sanitizeApiKey(process.env.SERPER_API_KEY)),
          deepgram: Boolean(getDeepgramServerFallbackKey()),
          misoTts: misoTtsHealth.reachable,
        },
        providerDetails: {
          misoTts: {
            configured: misoTtsHealth.configured,
            reachable: misoTtsHealth.reachable,
            status: misoTtsHealth.status,
            error: misoTtsHealth.error,
          },
        },
        graph: {
          codeArchitecture: "Graphify",
          learnerBrain: "local Dexie learning book and concept records",
        },
        tuning: {
          defaultChatModel: DEFAULT_CHAT_MODEL,
          learningAgentModel: LEARNING_AGENT_MODEL,
          toolIterationLimitDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.toolIterationLimit,
          toolIterationLimitRange: `${BRAIN_RUNTIME_SETTING_LIMITS.toolIterationLimit.min}-${BRAIN_RUNTIME_SETTING_LIMITS.toolIterationLimit.max}`,
          memoryConceptLimitDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.memoryConceptLimit,
          memoryConceptLimitRange: `${BRAIN_RUNTIME_SETTING_LIMITS.memoryConceptLimit.min}-${BRAIN_RUNTIME_SETTING_LIMITS.memoryConceptLimit.max}`,
          activityRefreshMsDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.activityRefreshMs,
          activityRefreshMsRange: `${BRAIN_RUNTIME_SETTING_LIMITS.activityRefreshMs.min}-${BRAIN_RUNTIME_SETTING_LIMITS.activityRefreshMs.max}`,
          webSearchPolicyDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.webSearchPolicy,
          webSearchPolicies: WEB_SEARCH_POLICIES.join(", "),
          masteryEvidencePolicyDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.masteryEvidencePolicy,
          masteryEvidencePolicies: MASTERY_EVIDENCE_POLICIES.join(", "),
          bktTransitProbabilityDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.bktTransitProbability,
          bktTransitProbabilityRange: `${BRAIN_RUNTIME_SETTING_LIMITS.bktTransitProbability.min}-${BRAIN_RUNTIME_SETTING_LIMITS.bktTransitProbability.max}`,
          bktSlipProbabilityDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.bktSlipProbability,
          bktSlipProbabilityRange: `${BRAIN_RUNTIME_SETTING_LIMITS.bktSlipProbability.min}-${BRAIN_RUNTIME_SETTING_LIMITS.bktSlipProbability.max}`,
          bktGuessProbabilityDefault:
            DEFAULT_BRAIN_RUNTIME_SETTINGS.bktGuessProbability,
          bktGuessProbabilityRange: `${BRAIN_RUNTIME_SETTING_LIMITS.bktGuessProbability.min}-${BRAIN_RUNTIME_SETTING_LIMITS.bktGuessProbability.max}`,
          websocketDebugPath: "/ws/debug",
        },
      },
      events: systemActivityEvents,
    });
  });

  app.get("/api/pricing", async (_req, res) => {
    const openRouter = await fetchOpenRouterPricing();
    const fetchedAt = new Date(openRouter.fetchedAt).toISOString();
    res.json({
      fetchedAt,
      source: openRouter.stale
        ? "openrouter-cache-or-empty"
        : "openrouter-live",
      stale: openRouter.stale,
      openRouter: {
        fetchedAt,
        source: "https://openrouter.ai/api/v1/models",
        models: openRouter.models,
        stale: openRouter.stale,
      },
      deepgram: {
        fetchedAt: new Date().toISOString(),
        source: "maintained-fallback",
        pricing: DEEPGRAM_PRICING,
      },
    });
  });

  // API Route to Ingest and Classify Documents
  app.post("/api/documents/ingest", documentUpload, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const filePath = req.file.path;
    const userId = learnerUserIdFromHeaders(req.headers);
    const documentId = normalizeClientRequestId(req.body?.documentId) || "";
    const bookId = normalizeClientRequestId(req.body?.bookId) || "";
    const documentTitle =
      String(req.body?.title || req.file.originalname || "Untitled PDF")
        .replace(/\.pdf$/i, "")
        .trim() || "Untitled PDF";
    try {
      const { execFile } = await import("child_process");
      execFile(
        "python3",
        ["scripts/classify_and_extract.py", filePath],
        { maxBuffer: 1024 * 1024 * 96, timeout: 120_000 },
        async (error, stdout, stderr) => {
          if (error) {
            fs.unlink(filePath, () => {});
            console.error("Python Extraction Error:", stderr);
            return res
              .status(500)
              .json({ error: "Failed to process document" });
          }

          let result;
          try {
            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : stdout;
            result = JSON.parse(jsonStr);
          } catch (e) {
            fs.unlink(filePath, () => {});
            console.error("Failed to parse JSON from Python script:", stdout);
            return res
              .status(500)
              .json({ error: "Invalid response from python script" });
          }

          if (result.error) {
            fs.unlink(filePath, () => {});
            return res.status(400).json({ error: result.error });
          }

          let extractedText = result.content || "";

          // If Scanned or Mixed, perform Vision Parsing on page images.
          if (
            result.classification === "Scanned" ||
            result.classification === "Mixed"
          ) {
            const apiKey = resolveOpenRouterApiKey(req.headers);

            if (apiKey && result.images && result.images.length > 0) {
              try {
                const openai = new OpenAI({
                  baseURL: "https://openrouter.ai/api/v1",
                  apiKey: apiKey,
                });

                for (const img of result.images) {
                  const response = await openai.chat.completions.create({
                    model: "qwen/qwen2.5-vl-72b-instruct",
                    messages: [
                      {
                        role: "user",
                        content: [
                          {
                            type: "text",
                            text: `Extract all readable text, diagrams, tables, and layout cues from page ${Number(img.page_num ?? 0) + 1}. Output concise markdown only from the provided source image; do not add outside facts.`,
                          },
                          {
                            type: "image_url",
                            image_url: {
                              url: `data:${img.mime_type};base64,${img.data}`,
                            },
                          },
                        ],
                      },
                    ],
                  });

                  const pageText =
                    response.choices[0]?.message?.content?.trim();
                  if (pageText) {
                    extractedText += `\n\n## OCR / Vision Page ${Number(img.page_num ?? 0) + 1}\n\n${pageText}`;
                  }
                }
              } catch (visionError) {
                console.error("Vision API Error:", visionError);
              }
            }
          }

          let serverDocument = null;
          if (documentId && bookId) {
            try {
              serverDocument = learnerStore.storeDocument({
                userId,
                documentId,
                bookId,
                title: documentTitle,
                mimeType: req.file?.mimetype || "application/pdf",
                size: req.file?.size || 0,
                sourcePath: filePath,
                extractedText,
                classification: result.classification,
                extractionMode: result.extraction_mode,
                totalPages: result.total_pages,
                status: "ready",
              });
              recordSystemActivity({
                kind: "memory",
                status: "completed",
                title: "Document persisted to learner store",
                detail: `${documentTitle} is stored under the active local learner profile.`,
                metadata: {
                  userId,
                  documentId,
                  bookId,
                  storageProvider: "server-local-sqlite",
                  extractedTextChars: extractedText.length,
                },
              });
            } catch (storeError) {
              fs.unlink(filePath, () => {});
              console.error("Learner document store error:", storeError);
              return res.status(500).json({
                error:
                  storeError instanceof Error
                    ? storeError.message
                    : "Failed to store document.",
              });
            }
          }

          fs.unlink(filePath, () => {});
          res.json({
            classification: result.classification,
            extractionMode: result.extraction_mode,
            totalPages: result.total_pages,
            pagesWithText: result.pages_with_text,
            renderedImagePages: result.images?.length || 0,
            content: serverDocument
              ? serverDocument.textPreview
              : extractedText,
            serverDocument,
          });
        },
      );
    } catch (e: any) {
      fs.unlink(filePath, () => {});
      res.status(500).json({ error: e.message });
    }
  });

  // API Route to Generate Title
  app.post("/api/title", async (req, res) => {
    try {
      const apiKey = resolveOpenRouterApiKey(req.headers);

      if (!apiKey) {
        return res.status(401).json({ error: openRouterRequiredMessage });
      }

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
      });

      const { image, text } = req.body;
      const transcriptText = typeof text === "string" ? text.trim() : "";

      if (!image && !transcriptText) {
        return res.status(400).json({ error: "Image or text is required." });
      }

      const response = transcriptText
        ? await openai.chat.completions.create({
            model: "openai/gpt-4o-mini",
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "Generate a very short, specific title for a voice tutoring conversation. Output only the title, 2 to 5 words, with no quotes or punctuation.",
              },
              {
                role: "user",
                content: transcriptText.slice(0, 4000),
              },
            ],
          })
        : await openai.chat.completions.create({
            model: "qwen/qwen2.5-vl-72b-instruct",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Look at this page from a document. Generate a very short (2-4 words) specific topic or title for what this document is about. Output ONLY the title.",
                  },
                  { type: "image_url", image_url: { url: image } },
                ],
              },
            ],
          });

      const title = response.choices[0]?.message?.content?.trim();
      res.json({ title: title || "General Study" });
    } catch (error: any) {
      console.error("Title API Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate title" });
    }
  });

  // API Route to Generate Persona
  app.post("/api/generate-persona", async (req, res) => {
    try {
      const apiKey = resolveOpenRouterApiKey(req.headers);
      if (!apiKey)
        return res.status(401).json({ error: openRouterRequiredMessage });

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
      });

      const { description } = req.body;
      if (!description)
        return res.status(400).json({ error: "Description is required." });

      const response = await openai.chat.completions.create({
        model: "anthropic/claude-3.5-sonnet", // Use Sonnet for high-quality prompt generation
        messages: [
          {
            role: "system",
            content:
              "You are an expert prompt engineer. The user will give you a brief description of a persona for an AI Tutor. Write a highly detailed, professional System Prompt that the AI should follow to embody this persona. The prompt must require clear professional language, no emojis unless the user explicitly asks for them, concise markdown, and a tutoring style that teaches without gimmicks. The output MUST ONLY be the raw system prompt text, nothing else. No prefixes like 'Here is the prompt'.",
          },
          {
            role: "user",
            content: description,
          },
        ],
      });

      res.json({ prompt: response.choices[0]?.message?.content?.trim() });
    } catch (error: any) {
      console.error("Persona Generation Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate persona" });
    }
  });

  // API Route to Trace Action (DeepSeek via OpenRouter)
  app.post("/api/trace", async (req, res) => {
    const activityStartedAt = Date.now();
    const requestId = activityId();
    try {
      const apiKey = resolveOpenRouterApiKey(req.headers);
      if (!apiKey) {
        recordSystemActivity({
          kind: "memory",
          status: "blocked",
          title: "Trace explanation blocked",
          detail:
            "OpenRouter API key is required before a model can explain the trace.",
          requestId,
          model: LEARNING_AGENT_MODEL,
          durationMs: Date.now() - activityStartedAt,
        });
        return res.status(401).json({ error: openRouterRequiredMessage });
      }

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
      });

      const { action, payload } = req.body;
      recordSystemActivity({
        kind: "memory",
        status: "started",
        title: "Trace explanation requested",
        detail: String(action || "unknown action"),
        requestId,
        model: LEARNING_AGENT_MODEL,
        metadata: {
          action,
          payloadKeys:
            payload && typeof payload === "object"
              ? Object.keys(payload).slice(0, 12)
              : [],
        },
      });

      const response = await openai.chat.completions.create({
        model: LEARNING_AGENT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an expert system tracker tracing user actions and brain updates. The user provides a raw JSON payload of an action that just happened in the AI Tutor App. Your job is to output a single, neat, layman-readable paragraph explaining what just happened in the background.",
          },
          {
            role: "user",
            content: `Action: ${action}\nPayload: ${JSON.stringify(payload)}`,
          },
        ],
      });

      recordSystemActivity({
        kind: "memory",
        status: "completed",
        title: "Trace explanation generated",
        detail: String(action || "unknown action"),
        requestId,
        model: LEARNING_AGENT_MODEL,
        durationMs: Date.now() - activityStartedAt,
      });

      res.json({ explanation: response.choices[0]?.message?.content?.trim() });
    } catch (error: any) {
      recordSystemActivity({
        kind: "error",
        status: "failed",
        title: "Trace explanation failed",
        detail: error.message || "Failed to generate trace",
        requestId,
        model: LEARNING_AGENT_MODEL,
        durationMs: Date.now() - activityStartedAt,
      });
      console.error("Trace API Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate trace" });
    }
  });

  app.post("/api/learning-book-update", async (req, res) => {
    const activityStartedAt = Date.now();
    const requestId = activityId();
    const apiKey = resolveOpenRouterApiKey(req.headers);
    const body = req.body || {};

    if (!apiKey) {
      recordSystemActivity({
        kind: "memory",
        status: "blocked",
        title: "Learning-book update blocked",
        detail:
          "OpenRouter API key is required before the local learning book can be model-refined.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        metadata: {
          activeBookId: body.activeBookId || "",
          activeDocumentId: body.activeDocumentId || "",
          fallbackAvailable: true,
        },
        durationMs: Date.now() - activityStartedAt,
      });
      return res.status(401).json({
        error: openRouterRequiredMessage,
      });
    }

    const userMessage = String(body.userMessage || "").slice(0, 8000);
    const assistantMessage = String(body.assistantMessage || "").slice(
      0,
      12000,
    );
    if (!userMessage && !assistantMessage) {
      recordSystemActivity({
        kind: "memory",
        status: "blocked",
        title: "Learning-book update skipped",
        detail: "Conversation text was empty.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        durationMs: Date.now() - activityStartedAt,
      });
      return res.status(400).json({ error: "Conversation text is required." });
    }

    recordSystemActivity({
      kind: "memory",
      status: "started",
      title: "Learning-book update started",
      detail:
        "The local learner book agent is summarizing the completed tutor turn.",
      requestId,
      model: LEARNING_AGENT_MODEL,
      metadata: {
        activeBookId: body.activeBookId || "",
        activeDocumentId: body.activeDocumentId || "",
        documentCount: Array.isArray(body.documentContexts)
          ? body.documentContexts.length
          : 0,
        userMessageChars: userMessage.length,
        assistantMessageChars: assistantMessage.length,
      },
    });

    try {
      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });

      const response = await openai.chat.completions.create({
        model: LEARNING_AGENT_MODEL,
        temperature: 0.15,
        messages: [
          {
            role: "system",
            content: `You are the DeepSeek V4 Flash learning-book agent for an AI tutor.
After each chat, update the learner's virtual brain.
Return ONLY valid JSON. No markdown.
Schema:
{
  "userName": "string",
  "bookTitle": "string",
  "bookSource": "chat|pdf|library|mixed",
  "overview": "stable overview of the whole session learning book",
  "chapterTitle": "short chapter title for this conversation",
  "chapterSummary": "a self-contained revision chapter in Markdown with a clear explanation, mechanism, distinctions, and a worked example; include a fenced Mermaid flowchart for processes and a fenced language-specific code sample when code was actually taught",
  "conversationSummary": "notebook-quality learning material, not a chat recap: preserve definitions, reasoning, examples, mistakes, and application steps without greetings or tool chatter",
  "knowledgeSummary": "cumulative notes on what the learner now appears to know, including precise concept relationships",
  "conceptsLearned": ["plain names of concepts learned or practiced"],
  "risks": ["misconceptions or weak spots"],
  "confidence": 0.0,
  "concepts": [
    {
      "name": "atomic concept name",
      "summary": "what the learner discussed or learned",
      "mastery": 0.0,
      "confidence": 0.0,
      "parentConcepts": ["larger concept"],
      "childConcepts": ["subconcept"],
      "evidence": ["short evidence from conversation"]
    }
  ]
}
Maintain one learning book for the current session. Use bookTitle as the broad session title (e.g. "Python Programming"). 
CRITICAL RULES:
- You MUST dynamically generate a specific, highly relevant \`chapterTitle\` based strictly on what the user actually asked about in this message (e.g. "List Comprehensions", "Promises and Async/Await", "Calculus Integrals"). DO NOT use generic chapter titles like "Conversation Notes".
- The summaries must be substantial study material. Avoid one-line summaries and headings such as "Concepts to revise". Capture the actual learning, key distinctions, worked examples, misconceptions, and next review hooks.
- Write for a capable teenager: clear and direct, but never childish.
- If the lesson explains a process, include a small \`\`\`mermaid flowchart. If it teaches code, include a runnable fenced code example in the correct language. Do not invent a diagram or code sample for subjects where it would add noise.
- Never include raw tool JSON, provider metadata, hidden prompts, greetings, or a transcript-style recap.
- Each concept summary should be useful by itself when shown in the Revision library. Include how the concept works, not just that it was mentioned.
- If the current book already exists, prefer continuing it and adding/refining chapters. Do not invent advanced concepts absent from the conversation.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              userName: body.userName || "Learner",
              activeProject: body.activeProject || "General Study",
              currentSessionId: body.currentSessionId || "",
              activeBookId: body.activeBookId || "",
              activeDocumentId: body.activeDocumentId || "",
              conversationId: body.conversationId || "",
              documentContexts: Array.isArray(body.documentContexts)
                ? body.documentContexts.slice(0, 6)
                : [],
              currentBook: body.currentBook || null,
              recentBookTitles: body.recentBookTitles || [],
              userMessage,
              assistantMessage,
            }),
          },
        ],
      });

      const content = response.choices[0]?.message?.content || "";
      const parsed = extractJsonObject(content);
      recordSystemActivity({
        kind: "memory",
        status: "completed",
        title: "Learning-book update completed",
        detail: String(
          parsed.bookTitle || body.activeProject || "General Study",
        ),
        requestId,
        model: LEARNING_AGENT_MODEL,
        metadata: {
          conceptCount: Array.isArray(parsed.concepts)
            ? parsed.concepts.length
            : 0,
          riskCount: Array.isArray(parsed.risks) ? parsed.risks.length : 0,
          confidence: parsed.confidence,
        },
        durationMs: Date.now() - activityStartedAt,
      });
      res.json({
        ...parsed,
        userName: parsed.userName || body.userName || "Learner",
        bookTitle: parsed.bookTitle || body.activeProject || "General Study",
        model: LEARNING_AGENT_MODEL,
      });
    } catch (error) {
      recordSystemActivity({
        kind: "memory",
        status: "fallback",
        title: "Learning-book update used local fallback",
        detail:
          error instanceof Error
            ? error.message
            : "Model refinement failed; safe fallback JSON was returned.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        durationMs: Date.now() - activityStartedAt,
      });
      console.warn(
        "[LEARNING_BOOK] DeepSeek update failed, using safe fallback:",
        error instanceof Error ? error.message : error,
      );
      res.json(fallbackLearningUpdate(body));
    }
  });

  app.post("/api/generate-flashcards", async (req, res) => {
    const activityStartedAt = Date.now();
    const requestId = activityId();
    const apiKey = resolveOpenRouterApiKey(req.headers);
    const body = req.body || {};

    if (!apiKey) {
      recordSystemActivity({
        kind: "tool",
        status: "blocked",
        title: "Flashcard generation blocked",
        detail:
          "OpenRouter API key is required before flashcards can be model-generated.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        toolName: "generate_flashcards",
        durationMs: Date.now() - activityStartedAt,
      });
      return res.status(401).json({ error: openRouterRequiredMessage });
    }

    const content = String(body.content || "").slice(0, 8000);
    if (!content) {
      recordSystemActivity({
        kind: "tool",
        status: "blocked",
        title: "Flashcard generation skipped",
        detail: "No content was provided.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        toolName: "generate_flashcards",
        durationMs: Date.now() - activityStartedAt,
      });
      return res.status(400).json({ error: "Content is required." });
    }

    try {
      recordSystemActivity({
        kind: "tool",
        status: "started",
        title: "Flashcard generation started",
        detail:
          "The study-card tool is extracting recall cards from tutor content.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        toolName: "generate_flashcards",
        metadata: { contentChars: content.length },
      });
      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });

      const response = await openai.chat.completions.create({
        model: LEARNING_AGENT_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are an AI study assistant. Extract the key educational concepts from the provided text and generate 1-3 flashcards. Return ONLY a valid JSON object matching the schema. No markdown.",
          },
          {
            role: "user",
            content: `Please generate flashcards from this text:\n\n${content}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_flashcards",
              description: "Generates study flashcards based on the text.",
              parameters: {
                type: "object",
                properties: {
                  cards: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        front: { type: "string" },
                        back: { type: "string" },
                        conceptId: {
                          type: "string",
                          description:
                            "Optional existing concept id if the source text names one clearly; otherwise omit.",
                        },
                      },
                      required: ["front", "back"],
                    },
                  },
                },
                required: ["cards"],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "generate_flashcards" },
        },
      });

      const message = response.choices[0]?.message;
      let cards = [];
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0] as any;
        if (toolCall.function && toolCall.function.arguments) {
          const args = JSON.parse(toolCall.function.arguments);
          if (args.cards) cards = args.cards;
        }
      } else if (message?.content) {
        try {
          const parsed = extractJsonObject(message.content);
          if (parsed.cards) cards = parsed.cards;
        } catch (e) {}
      }

      if (!Array.isArray(cards) || cards.length === 0) {
        const sentences = content
          .replace(/\s+/g, " ")
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => sentence.trim().length > 35)
          .slice(0, 3);
        cards = (sentences.length ? sentences : [content.slice(0, 280)]).map(
          (sentence, index) => ({
            front:
              index === 0
                ? "What is the core idea from this tutor answer?"
                : `What should you remember from note ${index + 1}?`,
            back: sentence.trim(),
          }),
        );
      }

      recordSystemActivity({
        kind: "tool",
        status: "completed",
        title: "Flashcard generation completed",
        detail: `${cards.length} card${cards.length === 1 ? "" : "s"} prepared.`,
        requestId,
        model: LEARNING_AGENT_MODEL,
        toolName: "generate_flashcards",
        durationMs: Date.now() - activityStartedAt,
      });
      res.json({ cards });
    } catch (error) {
      recordSystemActivity({
        kind: "tool",
        status: "fallback",
        title: "Flashcard generation used fallback",
        detail:
          error instanceof Error
            ? error.message
            : "Model card generation failed; local sentence fallback was returned.",
        requestId,
        model: LEARNING_AGENT_MODEL,
        toolName: "generate_flashcards",
        durationMs: Date.now() - activityStartedAt,
      });
      console.warn("[FLASHCARDS] Generation failed:", error);
      const sentences = content
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => sentence.trim().length > 35)
        .slice(0, 3);
      res.json({
        cards: (sentences.length ? sentences : [content.slice(0, 280)]).map(
          (sentence, index) => ({
            front:
              index === 0
                ? "What is the core idea from this tutor answer?"
                : `What should you remember from note ${index + 1}?`,
            back: sentence.trim(),
          }),
        ),
        fallback: true,
      });
    }
  });

  // API Route for chat TTS
  app.post("/api/tts", async (req, res) => {
    try {
      console.log(`[TTS] Request received for speech generation`);

      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (!text) {
        return res.status(400).json({ error: "Text is required." });
      }
      const requestedVoice =
        typeof req.body?.voice === "string"
          ? req.body.voice
          : "aura-asteria-en";
      const ttsModel =
        requestedVoice === MISO_TTS_8B_VOICE
          ? MISO_TTS_8B_VOICE
          : requestedVoice === "gpt-4o-mini-tts"
            ? requestedVoice
            : /^aura-[a-z0-9-]+-en$/i.test(requestedVoice)
              ? requestedVoice
              : "aura-asteria-en";
      const billedText = text.slice(0, 4000);
      const inputCharacters = billedText.length;
      const estimatedCost = ttsCostForModel(ttsModel, inputCharacters);

      if (ttsModel === MISO_TTS_8B_VOICE) {
        const response = await fetch(
          `${misoTtsApiBaseUrl(readMisoTtsApiUrlOverride(req.headers))}/v1/audio/speech`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: billedText,
              speaker: 0,
              max_audio_length_ms: Math.min(
                90_000,
                Math.max(2_000, inputCharacters * 90),
              ),
            }),
          },
        );

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(
            `MisoTTS error ${response.status}: ${JSON.stringify(err)}`,
          );
        }

        res.setHeader(
          "Content-Type",
          response.headers.get("Content-Type") || "audio/wav",
        );
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Usage-Provider", "misotts");
        res.setHeader("X-Usage-Model", MISO_TTS_8B_VOICE);
        res.setHeader("X-Usage-Unit", "characters");
        res.setHeader("X-Usage-Input-Chars", String(inputCharacters));
        res.setHeader("X-Usage-Cost", "0");
        res.setHeader("X-Usage-Estimated", "true");

        const body = response.body as any;
        if (body && typeof body.pipe === "function") {
          body.pipe(res);
        } else if (body && body.getReader) {
          try {
            for await (const chunk of body) {
              if (res.writableEnded) break;
              res.write(chunk);
            }
          } catch (e) {
            console.warn(
              "[TTS] Client stream disconnected during MisoTTS write.",
            );
          }
          if (!res.writableEnded) res.end();
        } else {
          const buffer = Buffer.from(await response.arrayBuffer());
          res.send(buffer);
        }
        return;
      }

      if (ttsModel === "gpt-4o-mini-tts") {
        try {
          const openaiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
          if (!openaiKey) throw new Error("OpenAI API Key is missing");
          const openai = new OpenAI({
            apiKey: openaiKey,
          });
          const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: billedText,
          });
          const buffer = Buffer.from(await mp3.arrayBuffer());
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("X-Usage-Provider", "openai");
          res.setHeader("X-Usage-Model", "gpt-4o-mini-tts");
          res.setHeader("X-Usage-Unit", "characters");
          res.setHeader("X-Usage-Input-Chars", String(inputCharacters));
          res.setHeader("X-Usage-Cost", String(estimatedCost));
          res.setHeader("X-Usage-Estimated", "false");
          res.send(buffer);
          return;
        } catch (openaiErr) {
          console.warn(
            "[TTS] OpenAI TTS failed, falling back to Deepgram default:",
            openaiErr,
          );
        }
      }

      const ttsModelForDeepgram =
        ttsModel === "gpt-4o-mini-tts" ? "aura-asteria-en" : ttsModel;
      const deepgramKey =
        deepgramKeyFromRequest(req) || getDeepgramServerFallbackKey();
      if (!deepgramKey) {
        return res.status(503).json({
          error: "Deepgram API Key is missing",
          code: "PROVIDER_KEY_MISSING",
          provider: "deepgram",
        });
      }

      const response = await fetch(
        `https://api.deepgram.com/v1/speak?model=${ttsModelForDeepgram}&encoding=mp3`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${deepgramKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: billedText,
          }),
        },
      );

      console.log(`[TTS] Deepgram response status: ${response.status}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`TTS error ${response.status}: ${JSON.stringify(err)}`);
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("X-Usage-Provider", "deepgram");
      res.setHeader("X-Usage-Model", ttsModel);
      res.setHeader("X-Usage-Unit", "characters");
      res.setHeader("X-Usage-Input-Chars", String(inputCharacters));
      res.setHeader("X-Usage-Cost", String(estimatedCost));
      res.setHeader("X-Usage-Estimated", "false");

      const body = response.body as any;
      if (body && typeof body.pipe === "function") {
        body.pipe(res);
      } else if (body && body.getReader) {
        try {
          for await (const chunk of body) {
            if (res.writableEnded) break;
            res.write(chunk);
          }
        } catch (e) {
          console.warn("[TTS] Client stream disconnected during write.");
        }
        if (!res.writableEnded) res.end();
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      }
    } catch (error: any) {
      console.error("TTS API Error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to generate audio" });
    }
  });

  app.post("/api/voice-current-page", async (req, res) => {
    const startedAt = Date.now();
    const requestId =
      normalizeClientRequestId(req.body?.requestId) || activityId();
    const visionId = `voice_page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const query = String(req.body?.query || "Describe this page.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    const image = String(req.body?.image || "").trim();

    if (!image || !image.startsWith("data:image/")) {
      recordSystemActivity({
        kind: "tool",
        status: "blocked",
        title: "Voice current-page vision blocked",
        detail: "Voice look_at_current_page requires a rendered page image.",
        requestId,
        toolName: "look_at_current_page",
        phase: "voice_tool",
        metadata: { visionId },
      });
      return res.status(400).json({
        requestId,
        visionId,
        error: "Current page image is required.",
      });
    }

    const apiKey = resolveOpenRouterApiKey(req.headers);
    if (!apiKey) {
      recordSystemActivity({
        kind: "tool",
        status: "blocked",
        title: "Voice current-page vision blocked",
        detail:
          "OpenRouter API key is required before voice mode can inspect the current page image.",
        requestId,
        toolName: "look_at_current_page",
        phase: "voice_tool",
        metadata: { visionId },
      });
      return res.status(401).json({
        requestId,
        visionId,
        error: openRouterRequiredMessage,
      });
    }

    recordSystemActivity({
      kind: "tool",
      status: "started",
      title: "Voice current-page vision started",
      detail: query,
      requestId,
      model: "openai/gpt-4o-mini",
      toolName: "look_at_current_page",
      phase: "voice_tool",
      metadata: { visionId },
    });

    try {
      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
      const visionResponse = await openai.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: query || "Describe this page." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      });
      const result =
        visionResponse.choices[0]?.message?.content ||
        "Empty response from vision model.";
      recordSystemActivity({
        kind: "tool",
        status: "completed",
        title: "Voice current-page vision completed",
        detail: "Voice mode inspected the currently rendered PDF page image.",
        requestId,
        model: "openai/gpt-4o-mini",
        toolName: "look_at_current_page",
        phase: "voice_tool",
        durationMs: Date.now() - startedAt,
        metadata: { visionId, resultChars: result.length },
      });
      return res.json({
        requestId,
        visionId,
        model: "openai/gpt-4o-mini",
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Current page vision unavailable.";
      recordSystemActivity({
        kind: "tool",
        status: "failed",
        title: "Voice current-page vision unavailable",
        detail: message,
        requestId,
        model: "openai/gpt-4o-mini",
        toolName: "look_at_current_page",
        phase: "voice_tool",
        durationMs: Date.now() - startedAt,
        metadata: { visionId },
      });
      return res.status(503).json({
        requestId,
        visionId,
        error: "Current page vision temporarily unavailable.",
      });
    }
  });

  app.post("/api/voice-web-search", async (req, res) => {
    const startedAt = Date.now();
    const requestId =
      normalizeClientRequestId(req.body?.requestId) || activityId();
    const searchId = `voice_web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const query = String(req.body?.query || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const mode: WebSearchMode = req.body?.mode === "news" ? "news" : "search";
    const maxResults = Math.min(
      Math.max(Number(req.body?.maxResults || 6) || 6, 1),
      10,
    );
    const serperRuntimeKey =
      sanitizeApiKey(req.headers["x-serper-api-key"]) ||
      sanitizeApiKey(req.body?.serperApiKey) ||
      sanitizeApiKey(process.env.SERPER_API_KEY);

    if (!query) {
      recordSystemActivity({
        kind: "web",
        status: "blocked",
        title: "Voice web search blocked",
        detail: "Voice web_search requires a query.",
        requestId,
        toolName: "web_search",
        phase: "voice_tool",
      });
      return res.status(400).json({
        requestId,
        searchId,
        sources: [],
        error: "Query is required.",
      });
    }

    recordSystemActivity({
      kind: "web",
      status: "started",
      title: "Voice web search started",
      detail: query,
      requestId,
      toolName: "web_search",
      phase: "voice_tool",
      metadata: { searchId, mode, maxResults },
    });

    try {
      const sources = await searchSerper({
        query,
        mode,
        maxResults,
        apiKey: serperRuntimeKey || undefined,
      });
      recordSystemActivity({
        kind: "web",
        status: "completed",
        title: "Voice web search completed",
        detail: `${sources.length} source${sources.length === 1 ? "" : "s"} returned.`,
        requestId,
        toolName: "web_search",
        phase: "voice_tool",
        durationMs: Date.now() - startedAt,
        metadata: {
          searchId,
          mode,
          sourceCount: sources.length,
          domains: sources.map((source) => source.domain).slice(0, 8),
        },
      });
      return res.json({ requestId, searchId, sources });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Search temporarily unavailable.";
      recordSystemActivity({
        kind: "web",
        status: "failed",
        title: "Voice web search unavailable",
        detail: message,
        requestId,
        toolName: "web_search",
        phase: "voice_tool",
        durationMs: Date.now() - startedAt,
        metadata: { searchId, mode },
      });
      return res.status(503).json({
        requestId,
        searchId,
        sources: [],
        error: "Search temporarily unavailable",
      });
    }
  });

  app.post("/api/chat", async (req, res) => {
    const activityStartedAt = Date.now();
    let requestId = activityId();
    let requestedModelForRun = DEFAULT_CHAT_MODEL;
    let usedModelForRun = DEFAULT_CHAT_MODEL;
    let runtimeSettingsForRun: Record<string, string | number> | undefined;
    // Enable SSE. no-transform stops the compression middleware (and any
    // downstream proxy) from buffering the stream so tokens flush incrementally.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const sendEvent = (type: string, data: any) => {
      res.write(`data: ${JSON.stringify({ type, requestId, ...data })}\n\n`);
      // compression() wraps res.flush to flush the gzip buffer; without this the
      // SSE events are held until the response ends, defeating live streaming.
      (res as unknown as { flush?: () => void }).flush?.();
    };
    const compactToolText = (value: unknown, fallback: string) => {
      const text =
        typeof value === "string"
          ? value
          : value === undefined || value === null
            ? ""
            : JSON.stringify(value);
      return (text || fallback).replace(/\s+/g, " ").trim().slice(0, 320);
    };
    const summarizeToolArguments = (toolName: string, rawArguments: string) => {
      try {
        const args = JSON.parse(rawArguments || "{}");
        if (toolName === "web_search") {
          return compactToolText(args.query, "web_search requested");
        }
        if (toolName === "look_at_current_page") {
          return compactToolText(args.query, "current page inspection");
        }
        if (toolName === "update_graph") {
          return compactToolText(args.name, "learning graph update");
        }
        if (toolName === "generate_flashcards") {
          const cardCount = Array.isArray(args.cards) ? args.cards.length : 0;
          return `${cardCount} flashcard${cardCount === 1 ? "" : "s"} requested`;
        }
      } catch {
        return "Tool arguments could not be parsed.";
      }
      return compactToolText(rawArguments, `${toolName || "tool"} requested`);
    };
    const sendToolJobEvent = (data: {
      status: "running" | "completed" | "failed" | "blocked";
      toolName: string;
      inputSummary?: string;
      outputSummary?: string;
      error?: string;
      model?: string;
      durationMs?: number;
      metadata?: Record<string, unknown>;
    }) => {
      sendEvent("tool_job", {
        timestamp: Date.now(),
        source: "chat_stream",
        ...data,
        metadata: safeActivityMetadata(data.metadata || {}),
      });
    };
    const sendModelRunEvent = (data: {
      status: "started" | "completed" | "failed" | "blocked" | "fallback";
      requestedModel?: string;
      usedModel?: string;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      estimated?: boolean;
      durationMs?: number;
      memoryContextChars?: number;
      sourceMaterialRequest?: boolean;
      requestedWebSearch?: boolean;
      webSources?: number;
      graphUpdates?: number;
      flashcards?: number;
      evaluatedAnswers?: number;
      iterations?: number;
      error?: string;
      runtimeSettings?: Record<string, string | number>;
      metadata?: Record<string, unknown>;
    }) => {
      const modelIdPart = (value: unknown) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim()
          .replace(/[^a-zA-Z0-9_.-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 100);
      sendEvent("model_run", {
        id: [
          "model-run",
          "chat_stream",
          modelIdPart(requestId) || "local",
          data.status,
          modelIdPart(data.usedModel || data.requestedModel),
        ]
          .filter(Boolean)
          .join(":"),
        timestamp: Date.now(),
        provider: "openrouter",
        source: "chat_stream",
        ...data,
        metadata: safeActivityMetadata(data.metadata || {}),
      });
    };

    try {
      const apiKey = resolveOpenRouterApiKey(req.headers);
      const {
        messages,
        currentPageImage,
        memoryContext,
        brainContextMetadata: rawBrainContextMetadata,
        aiModel,
        customPrompt,
        runtimeSettings: rawRuntimeSettings,
        webSearchExplicit,
        serperApiKey: bodySerperKey,
        language,
        requestId: clientRequestId,
      } = req.body;
      requestId = normalizeClientRequestId(clientRequestId) || requestId;
      const runtimeSettings = normalizeBrainRuntimeSettings(rawRuntimeSettings);
      const runtimeSettingsSnapshot = compactRuntimeSettings(runtimeSettings);
      const brainContextMetadata = compactBrainContextMetadata(
        rawBrainContextMetadata,
      );
      runtimeSettingsForRun = runtimeSettingsSnapshot;
      const serperRuntimeKey =
        sanitizeApiKey(req.headers["x-serper-api-key"]) ||
        sanitizeApiKey(bodySerperKey) ||
        sanitizeApiKey(process.env.SERPER_API_KEY);
      const requestedModel =
        aiModel === "deepseek/deepseek-chat"
          ? DEFAULT_CHAT_MODEL
          : aiModel || DEFAULT_CHAT_MODEL;
      requestedModelForRun = requestedModel;
      usedModelForRun = requestedModel;

      if (!apiKey) {
        recordSystemActivity({
          kind: "model",
          status: "blocked",
          title: "Chat request blocked",
          detail:
            "OpenRouter API key is required before the tutor can call a model.",
          requestId,
          durationMs: Date.now() - activityStartedAt,
          metadata: {
            messageCount: Array.isArray(messages) ? messages.length : 0,
            aiModel: aiModel || DEFAULT_CHAT_MODEL,
            runtimeSettings: runtimeSettingsSnapshot,
          },
        });
        sendModelRunEvent({
          status: "blocked",
          requestedModel,
          usedModel: requestedModel,
          durationMs: Date.now() - activityStartedAt,
          error: openRouterRequiredMessage,
          runtimeSettings: runtimeSettingsSnapshot,
          metadata: {
            messageCount: Array.isArray(messages) ? messages.length : 0,
          },
        });
        sendEvent("error", {
          error: openRouterRequiredMessage,
        });
        return res.end();
      }

      const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
      });

      let usedModelForUsage = requestedModel;
      let inputTokens = 0;
      let outputTokens = 0;
      let usageEstimated = true;
      let webSources: NormalizedWebSource[] = [];
      const latestUserContent =
        [...(messages || [])].reverse().find((m: any) => m?.role === "user")
          ?.content || "";
      recordSystemActivity({
        kind: "model",
        status: "started",
        title: "Chat request started",
        detail: "Tutor is preparing local context and model streaming.",
        requestId,
        model: requestedModel,
        phase: "request",
        metadata: {
          messageCount: Array.isArray(messages) ? messages.length : 0,
          memoryContextChars:
            typeof memoryContext === "string" ? memoryContext.length : 0,
          hasCurrentPageImage: Boolean(currentPageImage),
          language: language || "en",
          runtimeSettings: runtimeSettingsSnapshot,
          brainContext: brainContextMetadata,
        },
      });
      const sourceMaterialRequest =
        /\b(current|this|the)\s+(page|screen|document|pdf|chapter|section|slide|image|diagram|chart|figure)\b/i.test(
          latestUserContent,
        ) ||
        /\b(what'?s|what is|explain|summari[sz]e|describe)\s+(this|the)\b/i.test(
          latestUserContent,
        ) ||
        /\b(on the screen|visible|shown|source material|uploaded document|reading)\b/i.test(
          latestUserContent,
        );
      const explicitWebSearch = Boolean(webSearchExplicit);
      const automaticFreshnessSearch =
        runtimeSettings.webSearchPolicy === "manual_only"
          ? null
          : detectFreshnessSearch(latestUserContent);
      const freshnessSearch = explicitWebSearch
        ? searchDetectionForExplicitRequest(latestUserContent)
        : automaticFreshnessSearch;
      const requestedWebSearch = Boolean(freshnessSearch);
      sendModelRunEvent({
        status: "started",
        requestedModel,
        usedModel: requestedModel,
        memoryContextChars:
          typeof memoryContext === "string" ? memoryContext.length : 0,
        sourceMaterialRequest,
        requestedWebSearch,
        runtimeSettings: runtimeSettingsSnapshot,
        metadata: {
          messageCount: Array.isArray(messages) ? messages.length : 0,
          hasCurrentPageImage: Boolean(currentPageImage),
          language: language || "en",
          brainContext: brainContextMetadata,
        },
      });
      if (memoryContext) {
        recordSystemActivity({
          kind: "retrieval",
          status: "completed",
          title: "Local memory context attached",
          detail:
            "Tutor request includes local book, selected text, document, or interaction context.",
          requestId,
          phase: "context",
          metadata: {
            memoryContextChars:
              typeof memoryContext === "string" ? memoryContext.length : 0,
            sourceMaterialRequest,
            explicitWebSearch,
            requestedWebSearch,
            runtimeSettings: runtimeSettingsSnapshot,
            brainContext: brainContextMetadata,
          },
        });
      }
      const mergeWebSources = (sources: NormalizedWebSource[]) => {
        const byUrl = new Map(webSources.map((source) => [source.url, source]));
        sources.forEach((source) => byUrl.set(source.url, source));
        webSources = [...byUrl.values()].slice(0, 10);
        return sources;
      };
      const runWebSearch = async (
        query: string,
        mode: WebSearchMode = "search",
        maxResults = 6,
      ) => {
        const searchStartedAt = Date.now();
        const searchId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        recordSystemActivity({
          kind: "web",
          status: "started",
          title: "Web search started",
          detail: query,
          requestId,
          toolName: "web_search",
          phase: "web_search",
          metadata: { searchId, mode, maxResults },
        });
        sendEvent("status", { phase: "web_search" });
        sendEvent("web_search_started", { searchId, query, mode });
        sendEvent("web_search_progress", {
          searchId,
          status: "Searching web...",
        });
        try {
          const sources = await searchSerper({
            query,
            mode,
            maxResults,
            apiKey: serperRuntimeKey || undefined,
          });
          sendEvent("web_search_progress", {
            searchId,
            status: sources.length
              ? "Reviewing sources..."
              : "No recent sources found.",
          });
          sources.forEach((source) =>
            sendEvent("web_result", { searchId, source }),
          );
          mergeWebSources(sources);
          recordSystemActivity({
            kind: "web",
            status: "completed",
            title: "Web search completed",
            detail: `${sources.length} source${sources.length === 1 ? "" : "s"} returned.`,
            requestId,
            toolName: "web_search",
            phase: "web_search",
            durationMs: Date.now() - searchStartedAt,
            metadata: {
              searchId,
              mode,
              sourceCount: sources.length,
              domains: sources.map((source) => source.domain).slice(0, 8),
            },
          });
          sendEvent("web_sources_complete", { searchId, sources });
          sendEvent("reasoning_summary", {
            content: sources.length
              ? `Reviewing ${sources.length} recent ${mode === "news" ? "news" : "web"} sources`
              : "No web sources were returned; continuing from internal context",
          });
          return sources;
        } catch (error) {
          console.warn(
            "[WEB_SEARCH] Search unavailable:",
            error instanceof Error ? error.message : error,
          );
          sendEvent("info", {
            message:
              "Search temporarily unavailable — continuing with internal knowledge.",
          });
          sendEvent("web_sources_complete", {
            searchId,
            sources: [],
            error: "Search temporarily unavailable",
          });
          recordSystemActivity({
            kind: "web",
            status: "failed",
            title: "Web search unavailable",
            detail:
              error instanceof Error
                ? error.message
                : "Search temporarily unavailable",
            requestId,
            toolName: "web_search",
            phase: "web_search",
            durationMs: Date.now() - searchStartedAt,
            metadata: { searchId, mode },
          });
          sendEvent("reasoning_summary", {
            content:
              "Web search was unavailable, so I am continuing with internal knowledge",
          });
          return [];
        }
      };

      let systemInstruction = `You are a high-level modern AI tutor specialized in computer science, programming, and textbook concepts. 
Your goal is to teach concepts precisely and accurately with proper explanations. 
When asked about concepts, act as a conversational pair programmer and educator.
Format your responses beautifully using markdown, bold emphasis for keywords, and clear, structured explanations. Avoid unnecessary prefixing or fluff, get straight to the point.
Break down complex subjects into mental models and use analogies where appropriate.
Keep the tone professional and do not use emojis unless the user explicitly asks for them.

IMPORTANT TOOL USAGE INSTRUCTIONS:
1. If the user asks questions about "the current page", "this chapter", "the document", "the screen", or asks you to explain something visible in what they are reading, use the provided screenshot context when present. If you need an additional page inspection and the \`look_at_current_page\` tool is available, call it. Do NOT claim you cannot see the screen when screenshot context is attached.
2. If the user requests flashcards, active recall questions, or revision cards, YOU MUST forcefully use the \`generate_flashcards\` tool to create them. NEVER simply write out the flashcards in text. ALWAYS use the tool. Start your message slightly confirming you generated them and suggest they navigate to the Revision tab.
3. Source-material questions come first. If the user asks "what is this about", "what's on the screen", "what is this page about", "explain this page", "summarize this document", or similar reading-context questions, answer from selected text, active library context, and the page image via \`look_at_current_page\` when available. Do not use \`web_search\` for these questions unless the user explicitly asks to search the web.
4. Use \`web_search\` only when the user explicitly asks for web/internet/online search, asks for an external image/diagram/flowchart example, or when the answer depends on fresh external facts such as latest/current/recent news, rankings, pricing, releases, trends, sports scores, elections, weather, laws, schedules, or named people/company roles. When using web sources, cite freshness-sensitive claims with compact references like [1] and [2]. Do not dump raw URLs in the answer body.
5. When a concept is clearer as a diagram, include a fenced \`\`\`mermaid code block. Use the right Mermaid family for the idea: \`flowchart TD\` or \`graph TD\` for process and system/API architecture diagrams, \`erDiagram\` for database/entity relationships, and \`stateDiagram-v2\` for state machines. Keep diagrams spacious, readable, and not over-dense. The chat UI renders Mermaid and automatically tours semantic diagram nodes, so label boxes clearly and explain them in the surrounding text.
6. If the user is answering a quiz, active-recall, or self-check question and you can identify a real local concept id from the supplied memory/book context, call \`evaluate_answer\` with the concept id, question, learner answer, and either score/maxScore or explicit correct/incorrect. If you cannot identify a real concept id, give normal feedback but do not fake mastery evidence.`;

      if (customPrompt) {
        systemInstruction = `${customPrompt}\n\n${systemInstruction}`;
      }

      systemInstruction += `\n\nADMIN RUNTIME TUNING:
- Web search policy: ${runtimeSettings.webSearchPolicy}
- Tool iteration budget: ${runtimeSettings.toolIterationLimit}
- Memory concept budget supplied by client: ${runtimeSettings.memoryConceptLimit}
- Mastery evidence policy: ${runtimeSettings.masteryEvidencePolicy}
- BKT priors for staged evidence review: transit ${runtimeSettings.bktTransitProbability}, slip ${runtimeSettings.bktSlipProbability}, guess ${runtimeSettings.bktGuessProbability}`;

      if (runtimeSettings.masteryEvidencePolicy === "review_required") {
        systemInstruction +=
          "\n- Evaluated-answer tool calls should be staged for human/Admin review unless the learner's answer has an explicit rubric score or clear correct/incorrect outcome tied to a real concept id.";
      } else {
        systemInstruction +=
          "\n- Evaluated-answer tool calls must stay validated-only: use them only for explicit quiz, active-recall, or self-check answers with a real concept id and clear scoring/correctness evidence.";
      }

      if (
        runtimeSettings.webSearchPolicy === "manual_only" &&
        !explicitWebSearch
      ) {
        systemInstruction +=
          "\n- Web search is manual-only for this turn. Do not call web_search unless the user explicitly selected the Web Search skill.";
      } else if (runtimeSettings.webSearchPolicy === "source_first") {
        systemInstruction +=
          "\n- Prefer local source material and memory context before any web retrieval. Source-material questions must stay local unless web search was explicitly selected.";
      }

      if (memoryContext) {
        systemInstruction += `\n\n${memoryContext}`;
      }

      if (currentPageImage && sourceMaterialRequest) {
        systemInstruction += `\n\nCURRENT PAGE IMAGE IS ATTACHED THROUGH THE look_at_current_page TOOL. For this source-material request, call look_at_current_page before answering and answer from the page image plus selected/library context. Do not use web_search unless the user explicitly asks for web search.`;
      }

      if (language === "ja") {
        systemInstruction += `\n\nCRITICAL LANGUAGE REQUIREMENT: You must think, reason, and respond natively in Japanese (日本語). Ensure all educational explanations, conceptual analogies, and technical feedback are phrased naturally in fluent Japanese. Keep the professional academic tone with no emojis.`;
      } else if (language === "ko") {
        systemInstruction += `\n\nCRITICAL LANGUAGE REQUIREMENT: You must think, reason, and respond natively in Korean (한국어). Ensure all educational explanations, conceptual analogies, and technical feedback are phrased naturally in fluent Korean. Keep the professional academic tone with no emojis.`;
      }

      // Eager vision prefetch removed. Vision tool look_at_current_page is registered if currentPageImage is present.

      if (freshnessSearch) {
        sendEvent("reasoning_summary", {
          content: "Detecting freshness requirement",
        });
        const sources = await runWebSearch(
          freshnessSearch.query,
          freshnessSearch.mode,
          6,
        );
        if (sources.length > 0) {
          systemInstruction += `\n\nLIVE WEB SOURCES:\n${formatSourcesForPrompt(sources)}\n\nUse these sources for current factual claims and cite them with bracketed source numbers.`;
        }
      }

      const formattedMessages = [
        { role: "system", content: systemInstruction },
        ...messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const tools: any = buildChatAgentToolDefinitions({
        includeCurrentPage: Boolean(currentPageImage),
      });

      // Eager vision pre-fetch removed to drastically improve latency.
      // The AI can still use the 'look_at_current_page' tool if it needs to see the document.

      let graphUpdates: any[] = [];
      let flashcardsUpdates: any[] = [];
      let evaluatedAnswers: any[] = [];

      let iterations = 0;
      const MAX_ITERATIONS = runtimeSettings.toolIterationLimit;
      let finalContent = "";

      // Model fallback chain: try primary, then fallbacks on failure
      const FALLBACK_MODELS = [
        "google/gemini-2.5-flash",
        "anthropic/claude-3.5-haiku",
        "openai/gpt-4o-mini",
        "meta-llama/llama-4-maverick",
      ];

      while (iterations < MAX_ITERATIONS) {
        if (iterations === 0) sendEvent("status", { phase: "thinking" });
        const primaryModel = requestedModel;
        const modelsToTry = [
          primaryModel,
          ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
        ];
        let stream: any = null;
        let usedModel = primaryModel;

        for (const model of modelsToTry) {
          try {
            recordSystemActivity({
              kind: "model",
              status: "progress",
              title: "Opening model stream",
              detail: model,
              requestId,
              model,
              phase: iterations === 0 ? "thinking" : "tool_followup",
              metadata: {
                attempt: modelsToTry.indexOf(model) + 1,
                iteration: iterations + 1,
                toolCount: tools.length,
              },
            });
            stream = await openai.chat.completions.create({
              model: model,
              messages: formattedMessages as any,
              tools: tools,
              stream: true,
              stream_options: { include_usage: true } as any,
            } as any);
            usedModel = model;
            usedModelForUsage = model;
            usedModelForRun = model;
            if (iterations === 0 && model !== primaryModel) {
              recordSystemActivity({
                kind: "model",
                status: "fallback",
                title: "Chat model fallback selected",
                detail: `${primaryModel} unavailable; streaming with ${model}.`,
                requestId,
                model,
                phase: "model_fallback",
                metadata: { requestedModel: primaryModel, usedModel: model },
              });
              console.log(
                `[CHAT] Primary model "${primaryModel}" unavailable, fell back to "${model}"`,
              );
              sendEvent("info", {
                message: `Model ${primaryModel} unavailable — using ${model}`,
              });
              sendModelRunEvent({
                status: "fallback",
                requestedModel: primaryModel,
                usedModel: model,
                durationMs: Date.now() - activityStartedAt,
                runtimeSettings: runtimeSettingsSnapshot,
                metadata: {
                  iteration: iterations + 1,
                  fallbackChain: modelsToTry,
                },
              });
            }
            break; // Success — use this stream
          } catch (modelErr: any) {
            const status = modelErr?.status || modelErr?.code;
            const isRetryable = [401, 402, 403, 429, 500, 502, 503].includes(
              status,
            );
            console.warn(
              `[CHAT] Model "${model}" failed (${status}): ${modelErr.message}`,
            );
            recordSystemActivity({
              kind: "model",
              status:
                isRetryable && model !== modelsToTry[modelsToTry.length - 1]
                  ? "fallback"
                  : "failed",
              title: "Model stream attempt failed",
              detail: modelErr.message || String(status || "unknown failure"),
              requestId,
              model,
              phase: "model_attempt",
              metadata: {
                status,
                retryable: isRetryable,
                attempt: modelsToTry.indexOf(model) + 1,
              },
            });
            if (!isRetryable || model === modelsToTry[modelsToTry.length - 1]) {
              // Not retryable OR last model — rethrow
              throw modelErr;
            }
            // Otherwise, try next model in fallback chain
          }
        }

        if (!stream)
          throw new Error(
            "All models failed. Please check your API key and try again.",
          );

        let isToolCall = false;
        let currentToolCalls: any[] = [];
        let assistantContent = "";

        for await (const chunk of stream) {
          const usage = (chunk as any).usage;
          if (usage) {
            inputTokens += Number(
              usage.prompt_tokens ?? usage.input_tokens ?? 0,
            );
            outputTokens += Number(
              usage.completion_tokens ?? usage.output_tokens ?? 0,
            );
            usageEstimated = false;
          }
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.tool_calls) {
            isToolCall = true;
            for (const tc of delta.tool_calls) {
              if (!currentToolCalls[tc.index]) {
                currentToolCalls[tc.index] = {
                  id: tc.id || `call_${Date.now()}_${tc.index}`,
                  type: "function",
                  function: { name: tc.function?.name || "", arguments: "" },
                };
              }
              if (
                tc.function?.name &&
                !currentToolCalls[tc.index].function.name
              ) {
                currentToolCalls[tc.index].function.name = tc.function.name;
              }
              if (tc.function?.arguments) {
                currentToolCalls[tc.index].function.arguments +=
                  tc.function.arguments;
              }
            }
          }

          if (delta?.content) {
            assistantContent += delta.content;
            finalContent += delta.content;
            sendEvent("chunk", { content: delta.content });
          }
        }

        if (!isToolCall) {
          break; // Done!
        }

        // We have tool calls
        sendEvent("status", { phase: "tool_execution" });
        const validToolCalls = currentToolCalls.filter(Boolean);
        recordSystemActivity({
          kind: "tool",
          status: "started",
          title: "Tool execution requested",
          detail: validToolCalls
            .map((tool) => tool.function.name)
            .filter(Boolean)
            .join(", "),
          requestId,
          phase: "tool_execution",
          metadata: {
            toolCount: validToolCalls.length,
            iteration: iterations + 1,
            toolNames: validToolCalls
              .map((tool) => tool.function.name)
              .filter(Boolean),
          },
        });
        validToolCalls.forEach((t) => {
          sendEvent("reasoning_summary", {
            content: `Using tool: ${t.function.name}`,
          });
        });

        formattedMessages.push({
          role: "assistant",
          content: assistantContent || null,
          tool_calls: validToolCalls,
        });

        for (const toolCall of validToolCalls) {
          const toolStartedAt = Date.now();
          const functionName = toolCall.function.name;
          const functionArguments = toolCall.function.arguments;
          const inputSummary = summarizeToolArguments(
            functionName,
            functionArguments,
          );
          sendToolJobEvent({
            status: "running",
            toolName: functionName,
            inputSummary,
            metadata: {
              toolCallId: toolCall.id,
              iteration: iterations + 1,
            },
          });

          if (functionName === "look_at_current_page" && currentPageImage) {
            try {
              sendEvent("reasoning_summary", {
                content: "Looking at current page",
              });
              const args = JSON.parse(functionArguments);
              const visionResponse = await openai.chat.completions.create({
                model: "openai/gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: args.query || "Describe this page.",
                      },
                      {
                        type: "image_url",
                        image_url: { url: currentPageImage },
                      },
                    ],
                  },
                ],
              });
              const visionText =
                visionResponse.choices[0]?.message?.content ||
                "Empty response from vision model.";
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: visionText,
              });
              recordSystemActivity({
                kind: "tool",
                status: "completed",
                title: "Current page vision completed",
                detail: "The tutor inspected the current PDF page image.",
                requestId,
                model: "openai/gpt-4o-mini",
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "completed",
                toolName: functionName,
                inputSummary,
                outputSummary:
                  "The tutor inspected the current PDF page image.",
                model: "openai/gpt-4o-mini",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            } catch (err: any) {
              console.error("Vision Error:", err);
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Error: Could not analyze the page image.",
              });
              recordSystemActivity({
                kind: "tool",
                status: "failed",
                title: "Current page vision failed",
                detail: err.message || "Could not analyze the page image.",
                requestId,
                model: "openai/gpt-4o-mini",
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "failed",
                toolName: functionName,
                inputSummary,
                error: err.message || "Could not analyze the page image.",
                model: "openai/gpt-4o-mini",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            }
          } else if (functionName === "web_search") {
            try {
              if (!requestedWebSearch) {
                const blockReason =
                  runtimeSettings.webSearchPolicy === "manual_only"
                    ? "Admin runtime tuning is set to manual web search only."
                    : "The turn looked source-local, so Tutor stayed with selected text, page, memory, and document context.";
                formattedMessages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content:
                    "Web search denied for this turn. Answer from the provided source material, selected text, memory context, and page image if available.",
                });
                recordSystemActivity({
                  kind: "tool",
                  status: "blocked",
                  title: "Web search denied",
                  detail: blockReason,
                  requestId,
                  toolName: functionName,
                  phase: "tool_execution",
                  durationMs: Date.now() - toolStartedAt,
                  metadata: {
                    runtimeSettings: runtimeSettingsSnapshot,
                    explicitWebSearch,
                  },
                });
                sendToolJobEvent({
                  status: "blocked",
                  toolName: functionName,
                  inputSummary,
                  outputSummary: blockReason,
                  durationMs: Date.now() - toolStartedAt,
                  metadata: {
                    toolCallId: toolCall.id,
                    runtimeSettings: runtimeSettingsSnapshot,
                  },
                });
                continue;
              }
              sendEvent("reasoning_summary", {
                content: "Searching live web sources",
              });
              const args = JSON.parse(functionArguments || "{}");
              const query = String(
                args.query || latestUserContent || "",
              ).trim();
              const requestedMode = args.mode === "news" ? "news" : "search";
              const maxResults = Number.isFinite(Number(args.maxResults))
                ? Number(args.maxResults)
                : 6;
              const sources = query
                ? await runWebSearch(query, requestedMode, maxResults)
                : [];
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formatSourcesForPrompt(sources),
              });
              recordSystemActivity({
                kind: "tool",
                status: "completed",
                title: "Web search tool completed",
                detail: `${sources.length} source${sources.length === 1 ? "" : "s"} supplied to the model.`,
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
                metadata: { query, sourceCount: sources.length },
              });
              sendToolJobEvent({
                status: "completed",
                toolName: functionName,
                inputSummary,
                outputSummary: `${sources.length} source${sources.length === 1 ? "" : "s"} supplied to the model.`,
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  toolCallId: toolCall.id,
                  sourceCount: sources.length,
                },
              });
            } catch (e) {
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Search temporarily unavailable.",
              });
              recordSystemActivity({
                kind: "tool",
                status: "failed",
                title: "Web search tool failed",
                detail:
                  e instanceof Error
                    ? e.message
                    : "Search temporarily unavailable.",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "failed",
                toolName: functionName,
                inputSummary,
                error:
                  e instanceof Error
                    ? e.message
                    : "Search temporarily unavailable.",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            }
          } else if (functionName === "update_graph") {
            try {
              sendEvent("reasoning_summary", {
                content: "Updating learning knowledge graph",
              });
              const args = JSON.parse(functionArguments);
              graphUpdates.push(args);
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Graph updated successfully.",
              });
              recordSystemActivity({
                kind: "memory",
                status: "completed",
                title: "Learning graph tool staged update",
                detail: args.name || "update_graph",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  understandingDelta: args.understandingDelta,
                  hasDescription: Boolean(args.description),
                },
              });
              sendToolJobEvent({
                status: "completed",
                toolName: functionName,
                inputSummary,
                outputSummary: args.name || "Learning graph update staged.",
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  toolCallId: toolCall.id,
                  understandingDelta: args.understandingDelta,
                  hasDescription: Boolean(args.description),
                },
              });
            } catch (e) {
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Error parsing arguments.",
              });
              recordSystemActivity({
                kind: "memory",
                status: "failed",
                title: "Learning graph tool parse failed",
                detail:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "failed",
                toolName: functionName,
                inputSummary,
                error:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            }
          } else if (functionName === "generate_flashcards") {
            try {
              sendEvent("reasoning_summary", {
                content: "Generating flashcards",
              });
              const args = JSON.parse(functionArguments);
              if (args && args.cards) flashcardsUpdates.push(...args.cards);
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Flashcards created successfully.",
              });
              recordSystemActivity({
                kind: "tool",
                status: "completed",
                title: "Flashcards tool staged cards",
                detail: `${Array.isArray(args?.cards) ? args.cards.length : 0} card${Array.isArray(args?.cards) && args.cards.length === 1 ? "" : "s"} prepared.`,
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "completed",
                toolName: functionName,
                inputSummary,
                outputSummary: `${Array.isArray(args?.cards) ? args.cards.length : 0} card${Array.isArray(args?.cards) && args.cards.length === 1 ? "" : "s"} prepared.`,
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  toolCallId: toolCall.id,
                  cardCount: Array.isArray(args?.cards) ? args.cards.length : 0,
                },
              });
            } catch (e) {
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Error parsing arguments.",
              });
              recordSystemActivity({
                kind: "tool",
                status: "failed",
                title: "Flashcards tool parse failed",
                detail:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "failed",
                toolName: functionName,
                inputSummary,
                error:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            }
          } else if (functionName === "evaluate_answer") {
            try {
              sendEvent("reasoning_summary", {
                content: "Evaluating learner answer",
              });
              const args = JSON.parse(functionArguments);
              const evaluation = {
                ...args,
                source: "chat_tool_evaluate_answer",
                sourceId: toolCall.id,
                evaluator: args?.evaluator || "model_rubric",
                metadata: {
                  toolCallId: toolCall.id,
                  agentLayer: "chat_stream",
                  mode: "chat",
                  runtimeSettings: runtimeSettingsSnapshot,
                },
              };
              evaluatedAnswers.push(evaluation);
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content:
                  "Answer evaluation staged. The browser will record local mastery evidence only if the concept id exists and the score is explicit.",
              });
              recordSystemActivity({
                kind: "memory",
                status: "completed",
                title: "Evaluated-answer evidence staged",
                detail: args?.conceptId || "evaluate_answer",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  toolCallId: toolCall.id,
                  conceptId: args?.conceptId,
                  evidenceType: args?.evidenceType || "generation",
                  runtimeSettings: runtimeSettingsSnapshot,
                  hasScore:
                    Number.isFinite(Number(args?.score)) &&
                    Number.isFinite(Number(args?.maxScore)),
                  hasCorrect: typeof args?.correct === "boolean",
                },
              });
              sendToolJobEvent({
                status: "completed",
                toolName: functionName,
                inputSummary,
                outputSummary: args?.conceptId
                  ? `Evaluation staged for ${args.conceptId}.`
                  : "Evaluation staged without concept id.",
                durationMs: Date.now() - toolStartedAt,
                metadata: {
                  toolCallId: toolCall.id,
                  conceptId: args?.conceptId,
                  evidenceContract: "evaluated_answer_v1",
                  runtimeSettings: runtimeSettingsSnapshot,
                  score: args?.score,
                  maxScore: args?.maxScore,
                  correct: args?.correct,
                  evidenceType: args?.evidenceType || "generation",
                },
              });
            } catch (e) {
              formattedMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Error parsing arguments.",
              });
              recordSystemActivity({
                kind: "memory",
                status: "failed",
                title: "Evaluated-answer tool parse failed",
                detail:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                requestId,
                toolName: functionName,
                phase: "tool_execution",
                durationMs: Date.now() - toolStartedAt,
              });
              sendToolJobEvent({
                status: "failed",
                toolName: functionName,
                inputSummary,
                error:
                  e instanceof Error ? e.message : "Error parsing arguments.",
                durationMs: Date.now() - toolStartedAt,
                metadata: { toolCallId: toolCall.id },
              });
            }
          } else {
            formattedMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: "Unsupported tool.",
            });
            recordSystemActivity({
              kind: "tool",
              status: "blocked",
              title: "Unsupported tool blocked",
              detail: functionName || "unknown tool",
              requestId,
              toolName: functionName,
              phase: "tool_execution",
              durationMs: Date.now() - toolStartedAt,
            });
            sendToolJobEvent({
              status: "blocked",
              toolName: functionName,
              inputSummary,
              error: "Unsupported tool.",
              durationMs: Date.now() - toolStartedAt,
              metadata: { toolCallId: toolCall.id },
            });
          }
        }
        iterations++;
        if (iterations < MAX_ITERATIONS && validToolCalls.length > 0) {
          sendEvent("status", { phase: "synthesizing" });
        }
      }

      if (inputTokens === 0 && outputTokens === 0) {
        inputTokens = estimateTokensFromText(formattedMessages);
        outputTokens = estimateTokensFromText(finalContent);
        usageEstimated = true;
      }
      const pricing = await fetchOpenRouterPricing();
      const cost = openRouterCost(
        pricing.models,
        usedModelForUsage,
        inputTokens,
        outputTokens,
      );

      sendEvent("status", { phase: "streaming" });
      sendModelRunEvent({
        status: "completed",
        requestedModel,
        usedModel: usedModelForUsage,
        inputTokens,
        outputTokens,
        cost,
        estimated: usageEstimated || cost === 0,
        durationMs: Date.now() - activityStartedAt,
        memoryContextChars:
          typeof memoryContext === "string" ? memoryContext.length : 0,
        sourceMaterialRequest,
        requestedWebSearch,
        webSources: webSources.length,
        graphUpdates: graphUpdates.length,
        flashcards: flashcardsUpdates.length,
        evaluatedAnswers: evaluatedAnswers.length,
        iterations: iterations + 1,
        runtimeSettings: runtimeSettingsSnapshot,
      });
      recordSystemActivity({
        kind: "model",
        status: "completed",
        title: "Chat request completed",
        detail: `${outputTokens} output token${outputTokens === 1 ? "" : "s"} from ${usedModelForUsage}.`,
        requestId,
        model: usedModelForUsage,
        phase: "complete",
        durationMs: Date.now() - activityStartedAt,
        metadata: {
          requestedModel,
          usedModel: usedModelForUsage,
          inputTokens,
          outputTokens,
          cost,
          estimated: usageEstimated || cost === 0,
          graphUpdates: graphUpdates.length,
          flashcards: flashcardsUpdates.length,
          evaluatedAnswers: evaluatedAnswers.length,
          webSources: webSources.length,
          iterations: iterations + 1,
          runtimeSettings: runtimeSettingsSnapshot,
        },
      });
      sendEvent("done", {
        content: finalContent,
        graphUpdates,
        flashcardsUpdates,
        evaluatedAnswers,
        sources: webSources,
        usage: {
          provider: "openrouter",
          requestedModel,
          usedModel: usedModelForUsage,
          inputTokens,
          outputTokens,
          estimated: usageEstimated || cost === 0,
          cost,
          pricingSource: pricing.stale
            ? "openrouter-cache-or-empty"
            : "openrouter-live",
        },
      });
      res.end();
    } catch (error: any) {
      sendModelRunEvent({
        status: "failed",
        requestedModel: requestedModelForRun,
        usedModel: usedModelForRun,
        durationMs: Date.now() - activityStartedAt,
        error: error.message || "Failed to generate response",
        runtimeSettings: runtimeSettingsForRun,
      });
      recordSystemActivity({
        kind: "error",
        status: "failed",
        title: "Chat request failed",
        detail: error.message || "Failed to generate response",
        requestId,
        phase: "error",
        durationMs: Date.now() - activityStartedAt,
      });
      console.error("Chat API Error:", error);
      res.write(
        `data: ${JSON.stringify({ type: "error", requestId, error: error.message || "Failed to generate response" })}\n\n`,
      );
      res.end();
    }
  });

  if (options.serveClient !== false) {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  const attachWebSockets = (server: HttpServer) => {
    console.log(`[SYS] WebSocket trace broadcaster active on /ws/debug`);

    // WebSocket Servers
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

    server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(
        request.url || "",
        `http://${request.headers.host}`,
      ).pathname;

      if (pathname === "/api/voice-broker") {
        if (!isAuthorizedLocalVoiceBrokerRequest(request)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      } else if (pathname === "/api/voice-agent") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      } else if (pathname === "/ws/debug") {
        if (!isAuthorizedDebugRequest(request)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wssDebug.handleUpgrade(request, socket, head, (ws) => {
          wssDebug.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on("connection", (ws, req) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      let language = normalizeVoiceLanguage(url.searchParams.get("language"));
      const isLocalVoiceBroker = url.pathname === "/api/voice-broker";

      if (isLocalVoiceBroker) {
        let isVoiceSessionStarted = false;
        let voiceRequestId = `voice_broker_${Date.now()}`;
        let voiceProofAttemptId = "";
        let voiceUserId = "local-default-user";
        let voiceInputSampleRate = 48000;
        let clientInputBytes = 0;
        let lastUsageAt = Date.now();
        let lastUsageClientInputBytes = 0;
        let hasRecordedClientAudioInput = false;
        const voiceStartedAt = Date.now();
        let usageInterval: ReturnType<typeof setInterval> | null = null;
        let compactStudyContext = "";
        let brokerOpenRouterApiKey = "";
        let brokerBackgroundApiKey = "";
        let brokerDeepgramApiKey = "";
        let brokerMisoTtsApiUrl = "";
        let brokerBrowserTtsEnabled = false;
        let deepgramListenWs: WSWebSocket | null = null;
        let deepgramSpeakWs: WSWebSocket | null = null;
        let deepgramSpeakReady = false;
        let deepgramOutputBytes = 0;
        let lastUsageDeepgramOutputBytes = 0;
        let pendingDeepgramSpeakFrames: string[] = [];
        let pendingDeepgramSpeakFlushTimer: ReturnType<
          typeof setTimeout
        > | null = null;
        let pendingDeepgramSpeakResolvers: Array<() => void> = [];
        let pendingDeepgramTtsDoneResolvers: Array<() => void> = [];
        let pendingDeepgramFinalTranscriptSegments: string[] = [];
        let brokerTtsProvider: "deepgram" | "browser" | "miso" = "deepgram";
        let assistantSpeechChain: Promise<void> = Promise.resolve();
        let foregroundTurnChain: Promise<void> = Promise.resolve();
        let backgroundJobChain: Promise<void> = Promise.resolve();
        let brokerClosed = false;
        const activeBrokerControllers = new Set<AbortController>();
        const foregroundModel = VOICE_FOREGROUND_MODEL;
        const backgroundModel = VOICE_BACKGROUND_MODEL;
        const ttsModel = VOICE_BROKER_TTS_MODEL;

        const brokerProofActivityMetadata = () => ({
          proofAttemptId: voiceProofAttemptId || undefined,
          mode: "voice",
          agentLayer: "voice_realtime",
          brokerMode: "custom_local_ready",
          foregroundModel,
          backgroundModel,
          ttsModel,
          ttsProvider: brokerTtsProvider,
          liveTtsModel:
            brokerTtsProvider === "browser"
              ? "browser-speech-synthesis"
              : brokerTtsProvider === "miso"
                ? MISO_TTS_8B_VOICE
                : ttsModel,
        });

        const sendBrokerJson = (payload: Record<string, unknown>) => {
          if (wsCanSend(ws)) {
            ws.send(JSON.stringify(payload));
          }
        };

        const registerBrokerController = () => {
          const controller = new AbortController();
          activeBrokerControllers.add(controller);
          return controller;
        };

        const releaseBrokerController = (controller: AbortController) => {
          activeBrokerControllers.delete(controller);
        };

        const sendBrokerUsage = (sessions = 0) => {
          const now = Date.now();
          const deltaSeconds = Math.max(0, (now - lastUsageAt) / 1000);
          const deltaInputBytes = Math.max(
            0,
            clientInputBytes - lastUsageClientInputBytes,
          );
          const deltaOutputBytes = Math.max(
            0,
            deepgramOutputBytes - lastUsageDeepgramOutputBytes,
          );
          lastUsageAt = now;
          lastUsageClientInputBytes = clientInputBytes;
          lastUsageDeepgramOutputBytes = deepgramOutputBytes;
          sendBrokerJson({
            type: "usage",
            usage: {
              provider: "local_voice_broker",
              voiceAgentModel: "Tutor Voice Broker (local ready)",
              listenModel: VOICE_BROKER_STT_MODEL,
              foregroundModel,
              backgroundModel,
              speakModel:
                brokerTtsProvider === "browser"
                  ? "browser-speech-synthesis"
                  : brokerTtsProvider === "miso"
                    ? MISO_TTS_8B_VOICE
                    : ttsModel,
              ttsModel,
              connectionSeconds: deltaSeconds,
              inputAudioSeconds:
                deltaInputBytes / Math.max(1, voiceInputSampleRate * 2),
              outputAudioSeconds:
                deltaOutputBytes /
                Math.max(1, VOICE_BROKER_TTS_SAMPLE_RATE * 2),
              cost: 0,
              estimated: true,
              sessions,
            },
          });
        };

        const parseVoiceAuth = (data: any, isBinary: boolean) => {
          if (isBinary) return null;
          const text = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
          try {
            const payload = JSON.parse(text);
            return payload?.type === "voice_auth" ? payload : null;
          } catch {
            return null;
          }
        };

        const authString = (
          payload: Record<string, unknown>,
          ...keys: string[]
        ) => {
          for (const key of keys) {
            const value = sanitizeApiKey(payload[key]);
            if (value) return value;
          }
          return "";
        };

        const stableVoiceSourceId = (value: string) => {
          let hash = 0;
          for (let i = 0; i < value.length; i += 1) {
            hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
          }
          return `voice_src_${Math.abs(hash).toString(36)}`;
        };

        const domainForVoiceSource = (url: string) => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return "source";
          }
        };

        const faviconForSourceDomain = (domain: string) =>
          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

        const extractOpenRouterWebSources = (
          message: Record<string, any> | null | undefined,
        ): NormalizedWebSource[] => {
          const annotations = Array.isArray(message?.annotations)
            ? message.annotations
            : [];
          const seen = new Set<string>();
          return annotations
            .map((annotation: any, index: number) => {
              const citation =
                annotation?.url_citation ||
                annotation?.urlCitation ||
                annotation?.citation ||
                annotation;
              const url = String(
                citation?.url ||
                  citation?.link ||
                  citation?.source_url ||
                  citation?.sourceUrl ||
                  "",
              ).trim();
              if (!url || seen.has(url)) return null;
              seen.add(url);
              const domain = domainForVoiceSource(url);
              const title = String(citation?.title || domain).trim();
              const snippet = compactActivityText(
                citation?.content ||
                  citation?.snippet ||
                  citation?.description ||
                  citation?.text ||
                  title,
                260,
              );
              return {
                id: stableVoiceSourceId(`openrouter:web:${url}`),
                type: "search" as const,
                sourceType: "web" as const,
                title,
                url,
                domain,
                faviconUrl: faviconForSourceDomain(domain),
                snippet,
                date: citation?.date || citation?.published_at || undefined,
                position: index + 1,
              };
            })
            .filter(Boolean) as NormalizedWebSource[];
        };

        const resolveDeepgramSpeakOpen = () => {
          const resolvers = pendingDeepgramSpeakResolvers.splice(0);
          resolvers.forEach((resolve) => resolve());
        };

        const resolveDeepgramTtsDone = () => {
          const resolvers = pendingDeepgramTtsDoneResolvers.splice(0);
          resolvers.forEach((resolve) => resolve());
        };

        const flushPendingDeepgramSpeakFrames = () => {
          if (pendingDeepgramSpeakFlushTimer) {
            clearTimeout(pendingDeepgramSpeakFlushTimer);
            pendingDeepgramSpeakFlushTimer = null;
          }
          if (deepgramSpeakWs?.readyState !== WSWebSocket.OPEN) return;
          while (
            pendingDeepgramSpeakFrames.length > 0 &&
            wsCanSend(deepgramSpeakWs)
          ) {
            const frame = pendingDeepgramSpeakFrames.shift();
            if (frame) deepgramSpeakWs.send(frame);
          }
          if (pendingDeepgramSpeakFrames.length > 0) {
            pendingDeepgramSpeakFlushTimer = setTimeout(
              flushPendingDeepgramSpeakFrames,
              25,
            );
          }
        };

        const queueDeepgramSpeakFrame = (frame: string) => {
          if (pendingDeepgramSpeakFrames.length >= 40) {
            pendingDeepgramSpeakFrames.shift();
          }
          pendingDeepgramSpeakFrames.push(frame);
          if (!pendingDeepgramSpeakFlushTimer) {
            pendingDeepgramSpeakFlushTimer = setTimeout(
              flushPendingDeepgramSpeakFrames,
              25,
            );
          }
        };

        const connectDeepgramSpeak = () => {
          if (
            !brokerDeepgramApiKey ||
            deepgramSpeakWs?.readyState === WSWebSocket.OPEN ||
            deepgramSpeakWs?.readyState === WSWebSocket.CONNECTING
          ) {
            return;
          }
          const params = new URLSearchParams({
            model: ttsModel,
            encoding: "linear16",
            sample_rate: String(VOICE_BROKER_TTS_SAMPLE_RATE),
          });
          const startedAt = Date.now();
          deepgramSpeakReady = false;
          try {
            deepgramSpeakWs = new WSWebSocket(
              `wss://api.deepgram.com/v1/speak?${params.toString()}`,
              {
                headers: {
                  Authorization: `Token ${brokerDeepgramApiKey}`,
                },
              },
            );
          } catch (error) {
            recordSystemActivity({
              kind: "voice",
              status: "failed",
              title: "Voice broker Deepgram TTS failed to start",
              detail:
                error instanceof Error
                  ? error.message
                  : "Could not open Deepgram Speak websocket.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_connect",
              metadata: brokerProofActivityMetadata(),
            });
            return;
          }

          deepgramSpeakWs.on("open", () => {
            deepgramSpeakReady = true;
            resolveDeepgramSpeakOpen();
            flushPendingDeepgramSpeakFrames();
            recordSystemActivity({
              kind: "voice",
              status: "started",
              title: "Voice broker Deepgram TTS connected",
              detail:
                "Deepgram Aura streaming TTS is connected for this voice conversation.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_connect",
              durationMs: Date.now() - startedAt,
              metadata: {
                sampleRate: VOICE_BROKER_TTS_SAMPLE_RATE,
                ...brokerProofActivityMetadata(),
              },
            });
          });

          deepgramSpeakWs.on("message", (raw, isBinary) => {
            if (isBinary) {
              const audioBuffer = Buffer.isBuffer(raw)
                ? raw
                : Array.isArray(raw)
                  ? Buffer.concat(raw)
                  : Buffer.from(raw as any);
              if (!wsCanSend(ws)) {
                recordSystemActivity({
                  kind: "voice",
                  status: "blocked",
                  title: "Voice broker dropped TTS audio under backpressure",
                  detail:
                    "The browser websocket buffer was full, so stale realtime audio was dropped.",
                  requestId: voiceRequestId,
                  model: ttsModel,
                  phase: "tts_backpressure",
                  metadata: brokerProofActivityMetadata(),
                });
                return;
              }
              deepgramOutputBytes += audioBuffer.length;
              if (ws.readyState === WSWebSocket.OPEN) {
                ws.send(audioBuffer);
              }
              return;
            }

            let payload: any = null;
            try {
              payload = JSON.parse(
                Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw),
              );
            } catch {
              return;
            }
            const payloadType = String(payload?.type || "");
            if (/^(Flushed|Cleared)$/i.test(payloadType)) {
              if (/^Flushed$/i.test(payloadType)) {
                sendBrokerJson({ type: "AgentAudioDone" });
              }
              resolveDeepgramTtsDone();
            } else if (/^(Warning|Error)$/i.test(payloadType)) {
              sendBrokerJson({
                type: payloadType,
                message: compactActivityText(
                  payload?.message || payload?.description || payloadType,
                ),
              });
            }
          });

          deepgramSpeakWs.on("close", (code, reason) => {
            deepgramSpeakReady = false;
            deepgramSpeakWs = null;
            resolveDeepgramSpeakOpen();
            resolveDeepgramTtsDone();
            recordSystemActivity({
              kind: "voice",
              status: code === 1000 ? "completed" : "blocked",
              title: "Voice broker Deepgram TTS closed",
              detail: compactActivityText(reason?.toString() || `code ${code}`),
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_close",
              metadata: {
                code,
                ...brokerProofActivityMetadata(),
              },
            });
          });

          deepgramSpeakWs.on("error", (error) => {
            deepgramSpeakReady = false;
            recordSystemActivity({
              kind: "voice",
              status: "failed",
              title: "Voice broker Deepgram TTS error",
              detail:
                error instanceof Error
                  ? error.message
                  : "Deepgram TTS websocket error.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_error",
              metadata: brokerProofActivityMetadata(),
            });
          });
        };

        const waitForDeepgramSpeakOpen = async () => {
          if (
            deepgramSpeakReady &&
            deepgramSpeakWs?.readyState === WSWebSocket.OPEN
          ) {
            return;
          }
          connectDeepgramSpeak();
          if (deepgramSpeakWs?.readyState === WSWebSocket.OPEN) return;
          await new Promise<void>((resolve) => {
            let resolver: (() => void) | null = null;
            const settle = () => {
              if (resolver) {
                pendingDeepgramSpeakResolvers =
                  pendingDeepgramSpeakResolvers.filter(
                    (entry) => entry !== resolver,
                  );
              }
              resolve();
            };
            const timeout = setTimeout(settle, VOICE_BROKER_TTS_DEADLINE_MS);
            resolver = () => {
              clearTimeout(timeout);
              resolve();
            };
            pendingDeepgramSpeakResolvers.push(resolver);
          });
        };

        const sendDeepgramSpeakControl = (payload: Record<string, unknown>) => {
          const frame = JSON.stringify(payload);
          if (deepgramSpeakWs?.readyState === WSWebSocket.OPEN) {
            if (wsCanSend(deepgramSpeakWs)) {
              deepgramSpeakWs.send(frame);
              return;
            }
            queueDeepgramSpeakFrame(frame);
            return;
          }
          queueDeepgramSpeakFrame(frame);
          connectDeepgramSpeak();
        };

        const connectDeepgramListen = () => {
          if (!brokerDeepgramApiKey || deepgramListenWs) return;
          const params = new URLSearchParams({
            model: VOICE_BROKER_STT_MODEL,
            encoding: "linear16",
            sample_rate: String(voiceInputSampleRate),
            channels: "1",
            interim_results: "true",
            endpointing: "120",
            vad_events: "true",
            smart_format: "true",
          });
          const startedAt = Date.now();
          try {
            deepgramListenWs = new WSWebSocket(
              `wss://api.deepgram.com/v1/listen?${params.toString()}`,
              {
                headers: {
                  Authorization: `Token ${brokerDeepgramApiKey}`,
                },
              },
            );
          } catch (error) {
            recordSystemActivity({
              kind: "voice",
              status: "failed",
              title: "Voice broker Deepgram STT failed to start",
              detail:
                error instanceof Error
                  ? error.message
                  : "Could not open Deepgram STT websocket.",
              requestId: voiceRequestId,
              phase: "stt_connect",
              metadata: brokerProofActivityMetadata(),
            });
            return;
          }

          deepgramListenWs.on("open", () => {
            recordSystemActivity({
              kind: "voice",
              status: "started",
              title: "Voice broker Deepgram STT connected",
              detail:
                "Browser PCM is now streaming to Deepgram listen for transcript turns.",
              requestId: voiceRequestId,
              model: `deepgram/${VOICE_BROKER_STT_MODEL}`,
              phase: "stt_connect",
              durationMs: Date.now() - startedAt,
              metadata: {
                inputSampleRate: voiceInputSampleRate,
                ...brokerProofActivityMetadata(),
              },
            });
          });

          deepgramListenWs.on("message", (raw) => {
            let payload: any = null;
            try {
              payload = JSON.parse(
                Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw),
              );
            } catch {
              return;
            }
            if (/speechstarted/i.test(String(payload?.type || ""))) {
              sendBrokerJson({ type: "UserStartedSpeaking" });
              if (brokerTtsProvider === "deepgram") {
                sendDeepgramSpeakControl({ type: "Clear" });
              }
              return;
            }
            const transcript = compactActivityText(
              payload?.channel?.alternatives?.[0]?.transcript,
              1200,
            );
            if (!transcript) return;
            const isFinalSegment = Boolean(payload?.is_final);
            const isSpeechFinal = Boolean(payload?.speech_final);
            sendBrokerJson({
              type: isFinalSegment ? "FinalTranscript" : "InterimTranscript",
              role: "user",
              transcript,
              content: transcript,
            });
            if (isFinalSegment) {
              pendingDeepgramFinalTranscriptSegments.push(transcript);
            }
            if (isSpeechFinal) {
              const completeTranscript =
                pendingDeepgramFinalTranscriptSegments.join(" ").trim() ||
                transcript;
              pendingDeepgramFinalTranscriptSegments = [];
              foregroundTurnChain = foregroundTurnChain.then(() =>
                handleUserTurnText(completeTranscript, "microphone"),
              );
              foregroundTurnChain = foregroundTurnChain.catch((error) => {
                recordSystemActivity({
                  kind: "error",
                  status: "failed",
                  title: "Voice broker user turn failed",
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Foreground turn failed.",
                  requestId: voiceRequestId,
                  phase: "user_turn",
                  metadata: brokerProofActivityMetadata(),
                });
              });
            }
          });

          deepgramListenWs.on("close", (code, reason) => {
            recordSystemActivity({
              kind: "voice",
              status: code === 1000 ? "completed" : "blocked",
              title: "Voice broker Deepgram STT closed",
              detail: compactActivityText(reason?.toString() || `code ${code}`),
              requestId: voiceRequestId,
              phase: "stt_close",
              metadata: {
                code,
                ...brokerProofActivityMetadata(),
              },
            });
            deepgramListenWs = null;
          });

          deepgramListenWs.on("error", (error) => {
            recordSystemActivity({
              kind: "voice",
              status: "failed",
              title: "Voice broker Deepgram STT error",
              detail:
                error instanceof Error
                  ? error.message
                  : "Deepgram STT websocket error.",
              requestId: voiceRequestId,
              phase: "stt_error",
              metadata: brokerProofActivityMetadata(),
            });
          });
        };

        const sendMisoSpeechAudio = async (
          text: string,
          options: {
            phase: string;
            maxAudioLengthMs: number;
            timeoutMs?: number;
          },
        ) => {
          const spokenText = compactActivityText(text, 1200);
          if (!spokenText) return;
          const controller = registerBrokerController();
          const timeout = setTimeout(
            () => controller.abort(),
            options.timeoutMs || 60_000,
          );
          const startedAt = Date.now();
          try {
            const baseUrl = misoTtsApiBaseUrl(brokerMisoTtsApiUrl);
            const response = await fetch(`${baseUrl}/v1/audio/speech`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                text: spokenText,
                speaker: 0,
                max_audio_length_ms: options.maxAudioLengthMs,
              }),
            });
            if (!response.ok) {
              const errorBody = await response.text().catch(() => "");
              throw new Error(
                `MisoTTS error ${response.status}: ${compactActivityText(errorBody, 180)}`,
              );
            }
            const audioBuffer = Buffer.from(await response.arrayBuffer());
            const cacheStatus = response.headers.get("X-MisoTTS-Cache") || "";
            if (wsCanSend(ws)) {
              ws.send(audioBuffer);
            }
            recordSystemActivity({
              kind: "voice",
              status: "completed",
              title: "Voice broker MisoTTS audio emitted",
              detail: `${audioBuffer.length} audio bytes sent to browser playback${cacheStatus ? ` (${cacheStatus})` : ""}.`,
              requestId: voiceRequestId,
              model: ttsModel,
              phase: options.phase,
              durationMs: Date.now() - startedAt,
              metadata: {
                audioBytes: audioBuffer.length,
                cacheStatus: cacheStatus || undefined,
                maxAudioLengthMs: options.maxAudioLengthMs,
                ...brokerProofActivityMetadata(),
              },
            });
          } catch (error) {
            const isAbortError =
              error instanceof Error && error.name === "AbortError";
            recordSystemActivity({
              kind: "voice",
              status: "blocked",
              title: isAbortError
                ? "Voice broker MisoTTS unavailable before deadline"
                : "Voice broker MisoTTS unavailable",
              detail:
                error instanceof Error
                  ? error.message
                  : "MisoTTS speech synthesis failed.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: options.phase,
              durationMs: Date.now() - startedAt,
              metadata: brokerProofActivityMetadata(),
            });
            if (isAbortError) throw error;
          } finally {
            clearTimeout(timeout);
            releaseBrokerController(controller);
          }
        };

        const sendLocalFastAckAudio = () => {
          const ackPath = VOICE_BROKER_FAST_ACK_FILE.trim();
          if (!ackPath) return false;
          const startedAt = Date.now();
          try {
            const audioBuffer = fs.readFileSync(ackPath);
            if (ws.readyState === WSWebSocket.OPEN) {
              ws.send(audioBuffer);
            }
            recordSystemActivity({
              kind: "voice",
              status: "completed",
              title: "Voice broker local fast-ack audio emitted",
              detail: `${audioBuffer.length} cached Miso audio bytes sent from local disk.`,
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_fast_ack",
              durationMs: Date.now() - startedAt,
              metadata: {
                audioBytes: audioBuffer.length,
                cacheStatus: "local_file",
                ackPath,
                ...brokerProofActivityMetadata(),
              },
            });
            return true;
          } catch (error) {
            recordSystemActivity({
              kind: "voice",
              status: "blocked",
              title: "Voice broker local fast-ack unavailable",
              detail:
                error instanceof Error
                  ? error.message
                  : "Could not read local fast-ack audio.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_fast_ack",
              durationMs: Date.now() - startedAt,
              metadata: brokerProofActivityMetadata(),
            });
            return false;
          }
        };

        const synthesizeBrokerSpeech = async (text: string) => {
          const spokenText = compactActivityText(text, 1200);
          if (!spokenText) return;
          const startedAt = Date.now();
          if (brokerTtsProvider === "deepgram") {
            await waitForDeepgramSpeakOpen();
            if (deepgramSpeakWs?.readyState !== WSWebSocket.OPEN) {
              recordSystemActivity({
                kind: "voice",
                status: "blocked",
                title: "Voice broker Deepgram TTS waiting for connection",
                detail:
                  "Deepgram Aura TTS did not open before the live deadline; the text turn still reached the browser.",
                requestId: voiceRequestId,
                model: ttsModel,
                phase: "tts_audio",
                durationMs: Date.now() - startedAt,
                metadata: {
                  liveDeadlineMs: VOICE_BROKER_TTS_DEADLINE_MS,
                  ...brokerProofActivityMetadata(),
                },
              });
              return;
            }
            let done = false;
            const ttsDone = new Promise<void>((resolve) => {
              let resolver: (() => void) | null = null;
              const settle = () => {
                if (resolver) {
                  pendingDeepgramTtsDoneResolvers =
                    pendingDeepgramTtsDoneResolvers.filter(
                      (entry) => entry !== resolver,
                    );
                }
                resolve();
              };
              const timeout = setTimeout(settle, 10_000);
              resolver = () => {
                clearTimeout(timeout);
                done = true;
                resolve();
              };
              pendingDeepgramTtsDoneResolvers.push(resolver);
            });
            sendDeepgramSpeakControl({ type: "Speak", text: spokenText });
            sendDeepgramSpeakControl({ type: "Flush" });
            await ttsDone;
            recordSystemActivity({
              kind: "voice",
              status: done ? "completed" : "blocked",
              title: done
                ? "Voice broker Deepgram TTS audio emitted"
                : "Voice broker Deepgram TTS completion timed out",
              detail: done
                ? `${deepgramOutputBytes} total Aura audio bytes streamed to browser playback.`
                : "Aura audio may still be streaming, but no Flushed confirmation arrived before the safety timeout.",
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_audio",
              durationMs: Date.now() - startedAt,
              metadata: {
                outputBytes: deepgramOutputBytes,
                sampleRate: VOICE_BROKER_TTS_SAMPLE_RATE,
                ...brokerProofActivityMetadata(),
              },
            });
            return;
          }
          if (brokerTtsProvider === "browser") {
            recordSystemActivity({
              kind: "voice",
              status: "completed",
              title: "Voice broker browser TTS delegated",
              detail:
                "ConversationText was sent for local browser speech synthesis, keeping live first audio under the realtime deadline.",
              requestId: voiceRequestId,
              model: "browser-speech-synthesis",
              phase: "tts_browser",
              durationMs: Date.now() - startedAt,
              metadata: {
                liveDeadlineMs: VOICE_BROKER_TTS_DEADLINE_MS,
                ...brokerProofActivityMetadata(),
              },
            });
            return;
          }
          if (VOICE_BROKER_FAST_ACK) {
            const localAckSent = sendLocalFastAckAudio();
            if (!localAckSent) {
              void sendMisoSpeechAudio(VOICE_BROKER_FAST_ACK_TEXT, {
                phase: "tts_fast_ack",
                maxAudioLengthMs: 500,
                timeoutMs: VOICE_BROKER_TTS_DEADLINE_MS,
              });
            }
          }
          try {
            await sendMisoSpeechAudio(spokenText, {
              phase: "tts_audio",
              maxAudioLengthMs: Math.min(
                30_000,
                Math.max(500, spokenText.length * 70),
              ),
              timeoutMs: VOICE_BROKER_TTS_DEADLINE_MS,
            });
          } catch {
            recordSystemActivity({
              kind: "voice",
              status: "blocked",
              title: "Voice broker MisoTTS missed live deadline",
              detail: `MisoTTS did not return audio within ${VOICE_BROKER_TTS_DEADLINE_MS}ms, so synthesis was aborted instead of continuing in the background.`,
              requestId: voiceRequestId,
              model: ttsModel,
              phase: "tts_deadline",
              durationMs: Date.now() - startedAt,
              metadata: {
                liveDeadlineMs: VOICE_BROKER_TTS_DEADLINE_MS,
                ...brokerProofActivityMetadata(),
              },
            });
          }
        };

        const enqueueAssistantSpeechTurn = (options: {
          content: string;
          source: "foreground" | "background";
          phase: string;
          title: string;
          model?: string;
          jobId?: string;
          metadata?: Record<string, unknown>;
        }) => {
          const spokenText = compactActivityText(options.content, 1600);
          const speechSafeText = compactActivityText(
            normalizeSpokenMarkdown(spokenText),
            1600,
          );
          if (!speechSafeText) return assistantSpeechChain;
          const runTurn = assistantSpeechChain.then(async () => {
            const turnId =
              options.jobId ||
              `voice_${options.source}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            sendBrokerJson({
              type: "AgentStartedSpeaking",
              source: options.source,
              jobId: options.jobId,
              turnId,
            });
            sendBrokerJson({
              type: "ConversationText",
              role: "assistant",
              content: speechSafeText,
              source: options.source,
              jobId: options.jobId,
              turnId,
              displayMode: "paced",
              estimatedSpeechMs: estimateSpokenTextMs(speechSafeText),
            });
            await synthesizeBrokerSpeech(speechSafeText);
            sendBrokerJson({
              type: "AgentFinishedSpeaking",
              source: options.source,
              jobId: options.jobId,
              turnId,
            });
            recordSystemActivity({
              kind: options.source === "background" ? "tool" : "voice",
              status: "completed",
              title: options.title,
              detail: speechSafeText,
              requestId: voiceRequestId,
              model: options.model,
              phase: options.phase,
              metadata: {
                jobId: options.jobId,
                ...(options.metadata || {}),
                ...brokerProofActivityMetadata(),
              },
            });
          });
          assistantSpeechChain = runTurn.catch((error) => {
            recordSystemActivity({
              kind: "error",
              status: "failed",
              title: "Voice broker assistant speech turn failed",
              detail:
                error instanceof Error
                  ? error.message
                  : "Assistant speech turn failed.",
              requestId: voiceRequestId,
              phase: options.phase,
              metadata: {
                jobId: options.jobId,
                source: options.source,
                ...brokerProofActivityMetadata(),
              },
            });
          });
          return runTurn;
        };

        const generateForegroundReply = async (
          userText: string,
          backgroundQueued: boolean,
        ) => {
          if (!brokerOpenRouterApiKey) {
            return "I have the local learning book, previous context, and document memory loaded. I can answer the live part now, and any web, PDF, code, or pricing work is staged for the GPT-5.5 background layer once the provider key is connected.";
          }
          const startedAt = Date.now();
          const openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: brokerOpenRouterApiKey,
          });
          const response = await openai.chat.completions.create({
            model: foregroundModel,
            temperature: 0.35,
            max_tokens: 180,
            messages: [
              {
                role: "system",
                content:
                  "You are Tutor's low-latency foreground voice teacher. Reply naturally in one or two short spoken paragraphs. Use the learner's active book, prior conversation, and document context when provided. If the user also asks for fresh web/tool work, acknowledge it warmly with a short phrase like 'Okay, I'll search that and let you know' or 'Okay, I'll check that in the background', then continue teaching the main topic. Never say 'let's focus on Python first', never imply the background request is a distraction, and do not use markdown formatting.",
              },
              {
                role: "system",
                content: compactStudyContext
                  ? `Learner/context packet:\n${compactStudyContext.slice(0, 6000)}`
                  : "No learner context packet was attached.",
              },
              {
                role: "user",
                content: backgroundQueued
                  ? `${userText}\n\nA background tool job has been queued for any fresh/current/tool work in this request. In your spoken reply, acknowledge that delegated work first, then continue the teaching part naturally while the background result is pending.`
                  : userText,
              },
            ],
          });
          const reply = compactActivityText(
            response.choices[0]?.message?.content || "",
            1600,
          );
          recordSystemActivity({
            kind: "model",
            status: "completed",
            title: "Voice broker foreground model completed",
            detail: reply || "Foreground model returned no text.",
            requestId: voiceRequestId,
            model: foregroundModel,
            phase: "foreground_model",
            durationMs: Date.now() - startedAt,
            metadata: brokerProofActivityMetadata(),
          });
          return (
            reply ||
            "I am with you. The foreground tutor is connected, but it returned an empty response for that turn."
          );
        };

        const runBackgroundJob = async (jobId: string, text: string) => {
          const startedAt = Date.now();
          let sources: NormalizedWebSource[] = [];
          const delegatedTools = [
            {
              name: "openrouter:web_search",
              status: "delegated",
              summary:
                "GPT-5.5 background model received OpenRouter's hosted web search server tool.",
            },
          ];
          try {
            learnerStore.recordBackgroundTask({
              userId: voiceUserId,
              taskId: jobId,
              requestId: voiceRequestId,
              source: "voice_broker",
              taskType: "async_tool_or_research",
              status: "running",
              inputSummary: text,
              metadata: {
                model: backgroundModel,
                proofAttemptId: voiceProofAttemptId || undefined,
              },
            });
            if (!brokerBackgroundApiKey) {
              throw new Error(
                "Background GPT-5.5 provider key is missing; OpenRouter web search cannot run.",
              );
            }

            const openai = new OpenAI({
              baseURL: "https://openrouter.ai/api/v1",
              apiKey: brokerBackgroundApiKey,
            });
            const modelResponse = await openai.chat.completions.create({
              model: backgroundModel,
              temperature: 0.18,
              max_tokens: 420,
              messages: [
                {
                  role: "system",
                  content:
                    "You are Tutor's asynchronous GPT-5.5 background layer. You handle every slow, current, search, stock-price, code, file, PDF, and analysis task that the low-latency foreground teacher delegates. Use OpenRouter web search when the answer needs current public information. Return only a concise spoken follow-up that can be stitched naturally into the same live lesson after the foreground reply. Start as a smooth aside, such as 'Also,', 'By the way,', 'Quick update:', 'One more thing:', or 'I found it:'. Include concrete facts, timestamps or caveats for prices/current data, and source names when available. Do not return JSON, tool-call syntax, markdown tables, code fences, bullet lists, raw citations, bold or italic markdown, or labels like 'summary:'.",
                },
                {
                  role: "user",
                  content: [
                    `User request: ${text}`,
                    `Delegated background capabilities: ${VOICE_BACKGROUND_TOOL_DEFINITIONS.map((tool) => tool.name).join(", ")}`,
                    compactStudyContext
                      ? `Learner context:\n${compactStudyContext.slice(0, 4000)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                },
              ],
              tools: [
                {
                  type: "openrouter:web_search",
                },
              ],
            } as any);
            const responseMessage =
              (modelResponse.choices[0]?.message as Record<string, any>) ||
              null;
            const rawSummary = compactActivityText(
              responseMessage?.content || "",
              1800,
            );
            const summary =
              normalizeBackgroundSpokenInsertion(rawSummary) ||
              "By the way, the GPT-5.5 background layer finished, but it did not return a spoken summary.";
            sources = extractOpenRouterWebSources(responseMessage).slice(0, 8);
            learnerStore.recordBackgroundTask({
              userId: voiceUserId,
              taskId: jobId,
              requestId: voiceRequestId,
              source: "voice_broker",
              taskType: "async_tool_or_research",
              status: "completed",
              inputSummary: text,
              outputSummary: summary,
              metadata: {
                model: backgroundModel,
                sourceCount: sources.length,
                proofAttemptId: voiceProofAttemptId || undefined,
              },
            });

            recordSystemActivity({
              kind: sources.length ? "web" : "tool",
              status: "completed",
              title: "Voice broker background job completed",
              detail: summary,
              requestId: voiceRequestId,
              model: backgroundModel,
              phase: "background_job",
              durationMs: Date.now() - startedAt,
              metadata: {
                jobId,
                sourceCount: sources.length,
                domains: sources.map((source) => source.domain).slice(0, 6),
                delegatedTools: delegatedTools.map((tool) => tool.name),
                ...brokerProofActivityMetadata(),
              },
            });
            sendBrokerJson({
              type: "BackgroundJobResult",
              jobId,
              status: "completed",
              summary,
              sources,
              tools: delegatedTools,
            });
            await enqueueAssistantSpeechTurn({
              content: summary,
              source: "background",
              phase: "background_insertion",
              title: "Voice broker background result inserted",
              model: backgroundModel,
              jobId,
              metadata: {
                sourceCount: sources.length,
                tools: delegatedTools.map((tool) => tool.name),
              },
            });
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : "Background job failed.";
            learnerStore.recordBackgroundTask({
              userId: voiceUserId,
              taskId: jobId,
              requestId: voiceRequestId,
              source: "voice_broker",
              taskType: "async_tool_or_research",
              status: "failed",
              inputSummary: text,
              error: detail,
              metadata: {
                model: brokerBackgroundApiKey ? backgroundModel : undefined,
                proofAttemptId: voiceProofAttemptId || undefined,
              },
            });
            recordSystemActivity({
              kind: "tool",
              status: "failed",
              title: "Voice broker background job failed",
              detail,
              requestId: voiceRequestId,
              model: brokerBackgroundApiKey ? backgroundModel : undefined,
              phase: "background_job",
              durationMs: Date.now() - startedAt,
              metadata: {
                jobId,
                delegatedTools: delegatedTools.map((tool) => tool.name),
                ...brokerProofActivityMetadata(),
              },
            });
            sendBrokerJson({
              type: "BackgroundJobResult",
              jobId,
              status: "failed",
              summary: detail,
              tools: delegatedTools.map((tool) => ({
                ...tool,
                status: "failed",
              })),
            });
          }
        };

        const authDeadline = setTimeout(() => {
          if (!isVoiceSessionStarted && ws.readyState === WSWebSocket.OPEN) {
            ws.close(1008, "Voice authentication timed out");
          }
        }, 5000);

        const startBrokerSession = (authPayload: any) => {
          if (isVoiceSessionStarted) return;
          const clientRequestId = normalizeClientRequestId(
            authPayload.voiceSessionId || authPayload.requestId,
          );
          if (clientRequestId) voiceRequestId = clientRequestId;

          const studyContextMetadata = objectMetadata(
            authPayload.studyContextMetadata,
          );
          voiceUserId = normalizeLearnerUserId(
            authPayload.userId || studyContextMetadata.userId,
          );
          learnerStore.ensureProfile(voiceUserId);
          const proofAttemptId =
            normalizeClientRequestId(authPayload.proofAttemptId) ||
            normalizeClientRequestId(studyContextMetadata.proofAttemptId);
          if (proofAttemptId) voiceProofAttemptId = proofAttemptId;

          language = normalizeVoiceLanguage(authPayload.language || language);
          voiceInputSampleRate = normalizeVoiceInputSampleRate(
            authPayload.inputSampleRate,
          );
          compactStudyContext = compactVoiceStudyContext(
            authPayload.studyContext,
          );
          brokerOpenRouterApiKey =
            authString(
              authPayload,
              "openRouterKey",
              "foregroundApiKey",
              "apiKey",
            ) || getOpenRouterServerFallbackKey();
          brokerBackgroundApiKey =
            authString(
              authPayload,
              "backgroundApiKey",
              "gpt55ApiKey",
              "openRouterKey",
              "apiKey",
            ) ||
            sanitizeApiKey(process.env.GPT55_API_KEY) ||
            getOpenRouterServerFallbackKey();
          brokerDeepgramApiKey =
            authString(authPayload, "deepgramKey", "sttApiKey") ||
            getDeepgramServerFallbackKey();
          brokerMisoTtsApiUrl = authString(authPayload, "misoTtsApiUrl");
          brokerBrowserTtsEnabled = Boolean(authPayload.browserTts);
          brokerTtsProvider = brokerDeepgramApiKey
            ? "deepgram"
            : brokerBrowserTtsEnabled
              ? "browser"
              : "miso";
          const contextMetadata = {
            userId: voiceUserId,
            activeBookId:
              typeof authPayload.activeBookId === "string"
                ? authPayload.activeBookId
                : "",
            activeBookTitle:
              typeof authPayload.activeBookTitle === "string"
                ? authPayload.activeBookTitle
                : "",
            activeDocumentId:
              typeof authPayload.activeDocumentId === "string"
                ? authPayload.activeDocumentId
                : "",
            proofAttemptId: proofAttemptId || undefined,
            mode: "voice",
            agentLayer: "voice_realtime",
            documentIds: compactStringList(authPayload.documentIds),
            documentCount: nonNegativeInteger(authPayload.documentCount),
            readyDocumentIds: compactStringList(
              authPayload.readyDocumentIds ||
                studyContextMetadata.readyDocumentIds,
            ),
            readyDocumentCount: nonNegativeInteger(
              authPayload.readyDocumentCount ??
                studyContextMetadata.readyDocumentCount,
            ),
            contextDocumentIds: compactStringList(
              authPayload.contextDocumentIds ||
                studyContextMetadata.contextDocumentIds,
            ),
            unreadyDocumentCount: nonNegativeInteger(
              authPayload.unreadyDocumentCount ??
                studyContextMetadata.unreadyDocumentCount,
            ),
            omittedReadyDocumentCount: nonNegativeInteger(
              authPayload.omittedReadyDocumentCount ??
                studyContextMetadata.omittedReadyDocumentCount,
            ),
            clientStudyContextChars: nonNegativeInteger(
              authPayload.studyContextChars,
            ),
            rawContextChars: nonNegativeInteger(
              studyContextMetadata.rawContextChars,
            ),
            memoryContextChars: nonNegativeInteger(
              studyContextMetadata.memoryContextChars,
            ),
            activeBookContextChars: nonNegativeInteger(
              studyContextMetadata.activeBookContextChars,
            ),
            documentContextChars: nonNegativeInteger(
              studyContextMetadata.documentContextChars,
            ),
            contextCompacted: Boolean(studyContextMetadata.contextCompacted),
            inputSampleRate: voiceInputSampleRate,
          };

          isVoiceSessionStarted = true;
          usageInterval = setInterval(() => sendBrokerUsage(0), 1000);
          recordSystemActivity({
            kind: "voice",
            status: "started",
            title: "Local voice broker accepted",
            detail:
              "Custom voice broker accepted local auth and is ready for Deepgram STT/TTS, GPT-4o-mini, and GPT-5.5 adapters.",
            requestId: voiceRequestId,
            phase: "broker_auth",
            metadata: {
              language,
              studyContextChars: compactStudyContext.length,
              ...contextMetadata,
              ...brokerProofActivityMetadata(),
            },
          });

          if (compactStudyContext) {
            recordSystemActivity({
              kind: "retrieval",
              status: "completed",
              title: "Voice broker brain context attached",
              detail:
                "Local learner memory, active book, prior conversation, and document context reached the custom broker.",
              requestId: voiceRequestId,
              phase: "voice_context",
              metadata: {
                studyContextChars: compactStudyContext.length,
                ...contextMetadata,
                ...brokerProofActivityMetadata(),
              },
            });
          }

          recordSystemActivity({
            kind: "model",
            status: brokerOpenRouterApiKey ? "started" : "blocked",
            title: "Voice broker foreground model staged",
            detail: brokerOpenRouterApiKey
              ? "Foreground learner stream is ready to call OpenRouter GPT-4o-mini."
              : "Foreground learner stream is staged; provider traffic is deferred until a key is supplied.",
            requestId: voiceRequestId,
            model: foregroundModel,
            phase: "foreground_ready",
            metadata: brokerProofActivityMetadata(),
          });

          recordSystemActivity({
            kind: "tool",
            status: brokerBackgroundApiKey ? "started" : "blocked",
            title: "Voice broker background queue staged",
            detail: brokerBackgroundApiKey
              ? "Background GPT-5.5 queue is ready to use OpenRouter hosted web search plus delegated background analysis."
              : "Background GPT-5.5 queue is staged for web/search/PDF/code tasks and waiting for the OpenRouter provider key.",
            requestId: voiceRequestId,
            model: backgroundModel,
            phase: "background_ready",
            metadata: brokerProofActivityMetadata(),
          });
          if (brokerDeepgramApiKey) {
            connectDeepgramListen();
            connectDeepgramSpeak();
          } else {
            recordSystemActivity({
              kind: "voice",
              status: "blocked",
              title: "Voice broker Deepgram STT waiting for key",
              detail:
                "Typed voice-proof turns still work; microphone transcription starts when Deepgram is configured.",
              requestId: voiceRequestId,
              model: `deepgram/${VOICE_BROKER_STT_MODEL}`,
              phase: "stt_ready",
              metadata: brokerProofActivityMetadata(),
            });
          }

          sendBrokerJson({ type: "SettingsApplied" });
          sendBrokerJson({
            type: "VoiceBrokerReady",
            provider: "local_voice_broker",
            foregroundModel,
            backgroundModel,
            ttsModel,
            ttsProvider: brokerTtsProvider,
            sttModel: VOICE_BROKER_STT_MODEL,
            backgroundTools: VOICE_BACKGROUND_TOOL_DEFINITIONS.map(
              (tool) => tool.name,
            ),
            contextChars: compactStudyContext.length,
            language,
          });
        };

        const emitPendingBackgroundProviderKey = (jobId: string) => {
          setTimeout(() => {
            if (brokerClosed) return;
            recordSystemActivity({
              kind: "tool",
              status: "blocked",
              title: "Voice broker background job waiting for provider key",
              detail:
                "GPT-5.5 background execution is staged locally and will run after the OpenRouter provider key is supplied.",
              requestId: voiceRequestId,
              model: backgroundModel,
              phase: "background_job",
              metadata: {
                jobId,
                reason: "provider_key_pending",
                ...brokerProofActivityMetadata(),
              },
            });
            sendBrokerJson({
              type: "BackgroundJobResult",
              jobId,
              status: "pending_provider_key",
              summary:
                "Background GPT-5.5 execution is staged locally and waiting for the OpenRouter provider key.",
            });
          }, 25);
        };

        const maybeQueueBackgroundJob = (text: string) => {
          const needsFreshExternalWork =
            /\b(web|search|look up|lookup|browse|find|check|research|source|sources|latest|current|recent|today|news|price|prices|stock|share|ticker|market|nvidia|nvda|pdf|file|document|create|generate|download|code|repo|repository|debug|bug|error|crash|fix|review|inspect|implement|build|test|run|compare|summari[sz]e|analy[sz]e|analysis|tool|background)\b/i.test(
              text,
            ) ||
            /\b(can you|could you|also|at the same time)\b.*\b(search|look|find|check|create|fix|debug|review|analy[sz]e|compare)\b/i.test(
              text,
            );
          if (!needsFreshExternalWork) return "";

          const jobId = `voice_bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          learnerStore.recordBackgroundTask({
            userId: voiceUserId,
            taskId: jobId,
            requestId: voiceRequestId,
            source: "voice_broker",
            taskType: "async_tool_or_research",
            status: "queued",
            inputSummary: text,
            metadata: {
              proofAttemptId: voiceProofAttemptId || undefined,
              intent: "async_tool_or_research",
            },
          });
          recordSystemActivity({
            kind: "tool",
            status: "started",
            title: "Voice broker background job queued",
            detail: compactActivityText(text, 220),
            requestId: voiceRequestId,
            model: backgroundModel,
            phase: "background_job",
            metadata: {
              jobId,
              intent: "async_tool_or_research",
              ...brokerProofActivityMetadata(),
            },
          });
          sendBrokerJson({
            type: "BackgroundJobStarted",
            jobId,
            model: backgroundModel,
            intent: "async_tool_or_research",
            query: text.slice(0, 240),
            tools: VOICE_BACKGROUND_TOOL_DEFINITIONS.map((tool) => tool.name),
          });
          return jobId;
        };

        const handleUserTurnText = async (
          contentInput: unknown,
          source: "typed" | "microphone" = "typed",
        ) => {
          const content = compactActivityText(contentInput, 800);
          if (!content) return;
          recordSystemActivity({
            kind: "voice",
            status: "progress",
            title: "Voice broker user turn received",
            detail: content,
            requestId: voiceRequestId,
            phase: "user_turn",
            metadata: { source, ...brokerProofActivityMetadata() },
          });
          const backgroundJobId = maybeQueueBackgroundJob(content);
          const backgroundQueued = Boolean(backgroundJobId);
          let reply = "";
          try {
            reply = await generateForegroundReply(content, backgroundQueued);
          } catch (error) {
            reply =
              "I am with you, but the foreground voice model could not complete that turn. I will keep the session open while you check the provider key.";
            recordSystemActivity({
              kind: "model",
              status: "failed",
              title: "Voice broker foreground model failed",
              detail:
                error instanceof Error
                  ? error.message
                  : "Foreground model failed.",
              requestId: voiceRequestId,
              model: foregroundModel,
              phase: "foreground_model",
              metadata: brokerProofActivityMetadata(),
            });
          }
          await enqueueAssistantSpeechTurn({
            content: reply,
            source: "foreground",
            phase: "foreground_reply",
            title: "Voice broker foreground reply emitted",
            model: foregroundModel,
            metadata: { backgroundQueued },
          });
          if (backgroundJobId) {
            backgroundJobChain = backgroundJobChain.then(async () => {
              if (brokerClosed) return;
              if (brokerBackgroundApiKey) {
                await runBackgroundJob(backgroundJobId, content);
                return;
              }
              emitPendingBackgroundProviderKey(backgroundJobId);
            });
            backgroundJobChain = backgroundJobChain.catch((error) => {
              recordSystemActivity({
                kind: "error",
                status: "failed",
                title: "Voice broker background queue failed",
                detail:
                  error instanceof Error
                    ? error.message
                    : "Background queue failed.",
                requestId: voiceRequestId,
                phase: "background_queue",
                metadata: {
                  jobId: backgroundJobId,
                  ...brokerProofActivityMetadata(),
                },
              });
            });
          }
        };

        const handleInjectedUserMessage = (
          payload: Record<string, unknown>,
        ) => {
          foregroundTurnChain = foregroundTurnChain.then(() =>
            handleUserTurnText(payload.content, "typed"),
          );
          foregroundTurnChain = foregroundTurnChain.catch((error) => {
            recordSystemActivity({
              kind: "error",
              status: "failed",
              title: "Voice broker foreground queue failed",
              detail:
                error instanceof Error
                  ? error.message
                  : "Foreground queue failed.",
              requestId: voiceRequestId,
              phase: "foreground_queue",
              metadata: brokerProofActivityMetadata(),
            });
          });
        };

        ws.on("message", (data, isBinary) => {
          if (!isVoiceSessionStarted) {
            const authPayload = parseVoiceAuth(data, isBinary);
            if (authPayload) {
              clearTimeout(authDeadline);
              startBrokerSession(authPayload);
              return;
            }
            clearTimeout(authDeadline);
            ws.close(1008, "Voice authentication must be the first message");
            return;
          }

          if (isBinary) {
            clientInputBytes += rawByteLength(data);
            if (
              deepgramListenWs?.readyState === WSWebSocket.OPEN &&
              wsCanSend(deepgramListenWs)
            ) {
              deepgramListenWs.send(data as any);
            } else if (deepgramListenWs?.readyState === WSWebSocket.OPEN) {
              recordSystemActivity({
                kind: "voice",
                status: "blocked",
                title:
                  "Voice broker dropped microphone frame under backpressure",
                detail:
                  "Deepgram STT websocket buffering crossed the realtime safety limit.",
                requestId: voiceRequestId,
                phase: "client_audio_backpressure",
                metadata: brokerProofActivityMetadata(),
              });
            }
            if (!hasRecordedClientAudioInput) {
              hasRecordedClientAudioInput = true;
              recordSystemActivity({
                kind: "voice",
                status: "progress",
                title: "Voice broker input audio received",
                detail: brokerDeepgramApiKey
                  ? "Browser microphone PCM frames reached the custom voice broker and are being forwarded to Deepgram STT."
                  : "Browser microphone PCM frames reached the custom voice broker.",
                requestId: voiceRequestId,
                phase: "client_audio",
                metadata: {
                  inputBytes: clientInputBytes,
                  inputSampleRate: voiceInputSampleRate,
                  ...brokerProofActivityMetadata(),
                },
              });
            }
            return;
          }

          const text = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
          try {
            const payload = JSON.parse(text);
            if (payload?.type === "InjectUserMessage") {
              handleInjectedUserMessage(payload);
            }
          } catch {
            recordSystemActivity({
              kind: "voice",
              status: "blocked",
              title: "Voice broker ignored malformed control frame",
              detail: compactActivityText(text),
              requestId: voiceRequestId,
              phase: "control_frame",
              metadata: brokerProofActivityMetadata(),
            });
          }
        });

        ws.on("close", () => {
          brokerClosed = true;
          clearTimeout(authDeadline);
          if (usageInterval) clearInterval(usageInterval);
          if (pendingDeepgramSpeakFlushTimer) {
            clearTimeout(pendingDeepgramSpeakFlushTimer);
            pendingDeepgramSpeakFlushTimer = null;
          }
          activeBrokerControllers.forEach((controller) => controller.abort());
          activeBrokerControllers.clear();
          pendingDeepgramSpeakFrames = [];
          const speakResolvers = pendingDeepgramSpeakResolvers.splice(0);
          speakResolvers.forEach((resolve) => resolve());
          const ttsResolvers = pendingDeepgramTtsDoneResolvers.splice(0);
          ttsResolvers.forEach((resolve) => resolve());
          pendingDeepgramFinalTranscriptSegments = [];
          if (deepgramListenWs) {
            try {
              deepgramListenWs.close(1000, "Tutor voice broker closed");
            } catch {}
            deepgramListenWs = null;
          }
          if (deepgramSpeakWs) {
            try {
              if (deepgramSpeakWs.readyState === WSWebSocket.OPEN) {
                deepgramSpeakWs.send(JSON.stringify({ type: "Close" }));
              }
              deepgramSpeakWs.close(1000, "Tutor voice broker closed");
            } catch {}
            deepgramSpeakWs = null;
          }
          sendBrokerUsage(1);
          recordSystemActivity({
            kind: "voice",
            status: "completed",
            title: "Voice broker client closed",
            detail: "Custom voice broker session cleanup ran locally.",
            requestId: voiceRequestId,
            phase: "client_close",
            durationMs: Date.now() - voiceStartedAt,
            metadata: {
              inputBytes: clientInputBytes,
              ...brokerProofActivityMetadata(),
            },
          });
        });
        return;
      }

      let dgWs: WSWebSocket | null = null;
      let isDeepgramReady = false;
      let messageBuffer: Array<{ data: any; isBinary: boolean }> = [];
      let isVoiceSessionStarted = false;
      let usageInterval: ReturnType<typeof setInterval> | null = null;
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
      const voiceStartedAt = Date.now();
      let lastUsageAt = voiceStartedAt;
      let clientInputBytes = 0;
      let deepgramOutputBytes = 0;
      let lastUsageClientInputBytes = 0;
      let lastUsageDeepgramOutputBytes = 0;
      let hasRecordedClientAudioInput = false;
      const voiceAgentSpeakModel = "aura-asteria-en";
      let voiceRequestId = `voice_${voiceStartedAt}`;
      let voiceProofAttemptId = "";
      let voiceInputSampleRate = 48000;
      const authDeadline = setTimeout(() => {
        if (!isVoiceSessionStarted && ws.readyState === ws.OPEN) {
          ws.close(1008, "Voice authentication timed out");
        }
      }, 5000);

      const voiceProofActivityMetadata = () => ({
        proofAttemptId: voiceProofAttemptId || undefined,
        mode: "voice",
        agentLayer: "voice_realtime",
      });

      const queueVoiceAgentFrame = (data: any, isBinary: boolean) => {
        if (messageBuffer.length >= VOICE_AGENT_MESSAGE_BUFFER_LIMIT) {
          messageBuffer.shift();
          recordSystemActivity({
            kind: "voice",
            status: "blocked",
            title: "Voice agent dropped buffered client frame",
            detail:
              "Deepgram was not ready fast enough, so the oldest realtime frame was dropped to keep memory bounded.",
            requestId: voiceRequestId,
            phase: "client_buffer",
            metadata: {
              bufferLimit: VOICE_AGENT_MESSAGE_BUFFER_LIMIT,
              ...voiceProofActivityMetadata(),
            },
          });
        }
        messageBuffer.push({ data, isBinary });
      };

      const sendVoiceUsage = (sessions = 0) => {
        if (ws.readyState !== ws.OPEN) return;
        const now = Date.now();
        const deltaSeconds = Math.max(0, (now - lastUsageAt) / 1000);
        const deltaInputBytes = Math.max(
          0,
          clientInputBytes - lastUsageClientInputBytes,
        );
        const deltaOutputBytes = Math.max(
          0,
          deepgramOutputBytes - lastUsageDeepgramOutputBytes,
        );
        lastUsageAt = now;
        lastUsageClientInputBytes = clientInputBytes;
        lastUsageDeepgramOutputBytes = deepgramOutputBytes;
        ws.send(
          JSON.stringify({
            type: "usage",
            usage: {
              provider: "deepgram",
              voiceAgentModel: "Deepgram Voice Agent Standard",
              listenModel:
                language === "ja" || language === "ko"
                  ? "flux-general-multi"
                  : "flux-general-en",
              speakModel: voiceAgentSpeakModel,
              ttsModel: voiceAgentSpeakModel,
              connectionSeconds: deltaSeconds,
              inputAudioSeconds:
                deltaInputBytes / Math.max(1, voiceInputSampleRate * 2),
              outputAudioSeconds:
                deltaOutputBytes / PCM16_MONO_48K_BYTES_PER_SECOND,
              cost: voiceAgentCostForSeconds(deltaSeconds),
              estimated: false,
              sessions,
            },
          }),
        );
      };

      const parseVoiceAuth = (data: any, isBinary: boolean) => {
        if (isBinary) return null;
        const text = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : String(data);
        try {
          const payload = JSON.parse(text);
          return payload?.type === "voice_auth" ? payload : null;
        } catch {
          return null;
        }
      };

      const recordVoiceToolRequest = (functions: any[]) => {
        recordSystemActivity({
          kind: "tool",
          status: "started",
          title: "Voice tool call requested",
          detail:
            functions
              .map((fn: any) => fn?.name)
              .filter(Boolean)
              .join(", ") || "voice tool",
          requestId: voiceRequestId,
          phase: "voice_tool_request",
          metadata: {
            toolCount: functions.length,
            toolNames: functions.map((fn: any) => fn?.name).filter(Boolean),
            clientSideCount: functions.filter(
              (fn: any) => fn?.client_side !== false,
            ).length,
            ...voiceProofActivityMetadata(),
          },
        });
      };

      const recordVoiceToolResponse = (payload: any, title: string) => {
        recordSystemActivity({
          kind: "tool",
          status: "completed",
          title,
          detail:
            typeof payload.name === "string" ? payload.name : "voice tool",
          requestId: voiceRequestId,
          toolName: typeof payload.name === "string" ? payload.name : undefined,
          phase: "voice_tool_response",
          metadata: {
            toolCallId: payload.id,
            contentChars:
              typeof payload.content === "string" ? payload.content.length : 0,
            ...voiceProofActivityMetadata(),
          },
        });
      };

      const startMockVoiceProvider = () => {
        isDeepgramReady = true;
        recordSystemActivity({
          kind: "voice",
          status: "completed",
          title: "Mock voice provider ready",
          detail:
            "Local mock voice provider is simulating a Deepgram tool-call loop.",
          requestId: voiceRequestId,
          phase: "settings",
          metadata: voiceProofActivityMetadata(),
        });
        ws.send(JSON.stringify({ type: "SettingsApplied" }));
        const mockToolArguments: Record<string, Record<string, unknown>> = {
          look_at_study_context: {
            question: "What local study context is active?",
          },
          update_graph: {
            name: "Voice Tool Loop",
            description:
              "A local voice-agent function call executed by the browser client.",
            understandingDelta: 0.05,
          },
          generate_flashcards: {
            cards: [
              {
                front: "What does the voice tool loop verify?",
                back: "It verifies local FunctionCallRequest and FunctionCallResponse handling without Deepgram.",
              },
            ],
          },
          evaluate_answer: {
            conceptId: "general",
            question: "What does the voice tool loop verify?",
            learnerAnswer:
              "It verifies local FunctionCallRequest and FunctionCallResponse handling.",
            correct: true,
            evidenceType: "generation",
            rubric: ["Names local function-call handling"],
          },
          look_at_current_page: {
            query: "What is visible on the current study page?",
          },
          web_search: {
            query: "latest local voice tool loop testing patterns",
            mode: "search",
            maxResults: 2,
          },
        };
        const functions = VOICE_AGENT_TOOL_DEFINITIONS.map((tool) => ({
          id: `mock_${tool.name}`,
          name: tool.name,
          arguments: JSON.stringify(mockToolArguments[tool.name] || {}),
          client_side: true,
          thought_signature: `mock_${tool.name}_signature`,
        }));
        recordVoiceToolRequest(functions);
        ws.send(JSON.stringify({ type: "FunctionCallRequest", functions }));
      };

      const startVoiceSession = (
        selectedLanguage: string,
        providedDeepgramKey = "",
        studyContext = "",
        studyContextMetadata: Record<string, unknown> = {},
        providedInputSampleRate: unknown = 48000,
      ) => {
        if (isVoiceSessionStarted) return true;
        const useMockVoiceProvider = options.voiceProvider === "mock";
        const inputSampleRate = normalizeVoiceInputSampleRate(
          providedInputSampleRate,
        );

        const deepgramKey =
          sanitizeApiKey(providedDeepgramKey) || getDeepgramServerFallbackKey();
        if (!deepgramKey && !useMockVoiceProvider) {
          recordSystemActivity({
            kind: "voice",
            status: "blocked",
            title: "Voice auth blocked",
            detail: "Deepgram API Key is missing",
            requestId: voiceRequestId,
            phase: "auth",
          });
          ws.close(1011, "Deepgram API Key is missing");
          return false;
        }

        language = normalizeVoiceLanguage(selectedLanguage);
        voiceInputSampleRate = inputSampleRate;
        const compactStudyContext = compactVoiceStudyContext(studyContext);
        voiceProofAttemptId =
          normalizeClientRequestId(studyContextMetadata.proofAttemptId) ||
          voiceProofAttemptId;
        isVoiceSessionStarted = true;
        usageInterval = setInterval(() => sendVoiceUsage(0), 1000);
        recordSystemActivity({
          kind: "voice",
          status: "started",
          title: "Voice session accepted",
          detail: useMockVoiceProvider
            ? "Voice websocket auth accepted; using local mock voice provider."
            : "Voice websocket auth accepted; connecting to Deepgram.",
          requestId: voiceRequestId,
          phase: "auth",
          metadata: {
            language,
            listenModel:
              language === "ja" || language === "ko"
                ? "flux-general-multi"
                : "flux-general-en",
            speakModel: voiceAgentSpeakModel,
            inputSampleRate,
            studyContextChars: compactStudyContext.length,
            ...studyContextMetadata,
            ...voiceProofActivityMetadata(),
          },
        });
        if (compactStudyContext) {
          recordSystemActivity({
            kind: "retrieval",
            status: "completed",
            title: "Voice study context attached",
            detail:
              "Local learner memory, active book, and document context were injected into the live voice prompt.",
            requestId: voiceRequestId,
            phase: "voice_context",
            metadata: {
              studyContextChars: compactStudyContext.length,
              ...studyContextMetadata,
              ...voiceProofActivityMetadata(),
            },
          });
        }

        if (useMockVoiceProvider) {
          startMockVoiceProvider();
          return true;
        }

        try {
          const dgUrl = "wss://agent.deepgram.com/v1/agent/converse";
          console.log(`Connecting to Deepgram at: ${dgUrl}`);
          recordSystemActivity({
            kind: "voice",
            status: "progress",
            title: "Connecting voice provider",
            detail: "Opening Deepgram Voice Agent websocket.",
            requestId: voiceRequestId,
            phase: "provider_connect",
            metadata: {
              provider: "deepgram",
            },
          });
          dgWs = new WSWebSocket(dgUrl, {
            headers: {
              Authorization: `Token ${deepgramKey}`,
            },
          });

          dgWs.on("open", () => {
            // Send initial configuration
            const listenModel =
              language === "ja" || language === "ko"
                ? "flux-general-multi"
                : "flux-general-en";
            const listenProvider: any = {
              type: "deepgram",
              model: listenModel,
              version: "v2",
              eot_threshold: 0.8,
              eot_timeout_ms: 8000,
            };
            if (language === "ja" || language === "ko") {
              listenProvider.language_hints = ["en", "ja", "ko"];
            }

            let thinkPrompt =
              "You are an expert Computer Science and Programming tutor named Aria. You are currently helping a student who is studying technical material. Explain concepts like a senior engineer mentoring a junior developer. Use real-world analogies. Keep responses to 3-5 sentences. Never use bullet points, markdown, or code blocks — you are speaking out loud. Spell symbols verbally. End each reply with a follow-up question or offer to elaborate.";
            let greeting =
              "Hello! I am Aria, your CS tutor. What are you studying today?";

            if (language === "ja") {
              thinkPrompt =
                "あなたはAriaという名前の優秀なコンピュータサイエンスおよびプログラミングのチューターです。現在、技術的な内容を学習している学生をサポートしています。シニアエンジニアがジュニアデベロッパーを指導するように概念を説明してください。現実世界の例え話を使用してください。回答は3〜5文に抑えてください。音声での対話であるため、箇条書き、マークダウン、コードブロックは絶対に使用しないでください。記号は言葉で説明してください。最後は必ず次の質問をするか、詳しく説明することを提案して終えてください。必ず日本語で自然に会話してください。";
              greeting =
                "こんにちは！CSチューターのAriaです。今日は何を勉強しますか？";
            } else if (language === "ko") {
              thinkPrompt =
                "당신은 Aria라는 이름의 우수한 컴퓨터 과학 및 프로그래밍 튜터입니다. 현재 기술적인 내용을 학습하고 있는 학생을 돕고 있습니다. 시니어 엔지니어가 주니어 개발자를 멘토링하듯이 개념을 설명해 주세요. 현실 세계의 비유를 사용해 주세요. 답변은 3~5문장으로 제한해 주세요. 음성으로 대화 중이므로 글머리 기호, 마크다운, 코드 블록은 절대 사용하지 마세요. 기호는 말로 설명해 주세요. 각 답변의 끝에는 후속 질문을 하거나 더 자세히 설명하겠다고 제안해 주세요. 반드시 한국어로 자연스럽게 대화해 주세요.";
              greeting =
                "안녕하세요! CS 튜터 Aria입니다. 오늘 어떤 내용을 공부하시겠어요?";
            }

            if (compactStudyContext) {
              thinkPrompt += `\n\nLOCAL STUDY CONTEXT FOR THIS VOICE SESSION:\n${compactStudyContext}\n\nUse this local learner memory, active book, and document context before general knowledge. If the student asks about the current material, answer from this context and say when a detail is not available locally. Keep the spoken answer concise.`;
            }
            thinkPrompt +=
              "\n\nVOICE TOOL POLICY: You may call local client-side tools during this voice session. Use look_at_study_context before answering about the active book, document, selected text, learner memory, or current study material when the prompt context is not enough. Use look_at_current_page when the student asks about the current page, screen, visible diagram, flowchart, chart, or what they are reading; the client will visibly focus the current PDF page/diagram surface for the learner. Use render_diagram when the spoken answer would be clearer with a local Mermaid diagram. Choose flowchart TD or graph TD for processes and system/API architecture diagrams, erDiagram for database/entity relationships, and stateDiagram-v2 for state machines. Keep diagrams spacious, readable, and not over-dense; the voice UI moves the blob to the top-left, centers the diagram, and tours semantic boxes slowly while you explain. Use web_search only for explicit web, online, latest, current, recent, news-style external facts, or when the student explicitly asks for an external image, diagram, or flowchart example; returned image/source cards are rendered in the chat tool surface. Do not use web_search for current-page or document questions. If the student asks for flashcards, revision cards, quiz questions, or active recall, call generate_flashcards with concise cards before saying they were created. If the student answers a quiz or active-recall question and you can identify a real local concept id from the study context, call evaluate_answer with the concept id plus a clear score or correct/incorrect outcome; do not invent concept ids. When a new important concept should be added to the learner graph, call update_graph with one exact atomic concept. Keep spoken responses short after tool results.";

            const config = {
              type: "Settings",
              audio: {
                input: {
                  encoding: "linear16",
                  sample_rate: inputSampleRate,
                },
                output: {
                  encoding: "linear16",
                  sample_rate: 48000,
                  container: "none",
                },
              },
              agent: {
                listen: {
                  provider: listenProvider,
                },
                think: {
                  provider: {
                    type: "open_ai",
                    model: "gpt-4o-mini",
                  },
                  prompt: thinkPrompt,
                  functions: VOICE_AGENT_TOOL_DEFINITIONS,
                },
                speak: {
                  provider: {
                    type: "deepgram",
                    model: voiceAgentSpeakModel,
                  },
                },
                greeting: greeting,
              },
            };
            console.log(
              "Sending Deepgram settings config:",
              JSON.stringify(config, null, 2),
            );
            if (dgWs && wsCanSend(dgWs)) {
              dgWs.send(JSON.stringify(config));
            }
            recordSystemActivity({
              kind: "voice",
              status: "progress",
              title: "Voice settings sent",
              detail:
                "Deepgram Voice Agent settings were sent; waiting for SettingsApplied.",
              requestId: voiceRequestId,
              phase: "settings",
              metadata: {
                listenModel,
                speakModel: voiceAgentSpeakModel,
                language,
                inputSampleRate,
              },
            });

            if (keepAliveInterval) clearInterval(keepAliveInterval);
            keepAliveInterval = setInterval(() => {
              if (
                dgWs &&
                dgWs.readyState === WSWebSocket.OPEN &&
                wsCanSend(dgWs)
              ) {
                dgWs.send(JSON.stringify({ type: "KeepAlive" }));
              }
            }, 7000);
          });

          dgWs.on("unexpected-response", (req, res) => {
            console.error(
              `Deepgram WS Unexpected Response: ${res.statusCode} ${res.statusMessage}`,
            );
            recordSystemActivity({
              kind: "voice",
              status: "failed",
              title: "Voice provider rejected connection",
              detail:
                `Deepgram returned ${res.statusCode} ${res.statusMessage || ""}`.trim(),
              requestId: voiceRequestId,
              phase: "provider_connect",
              metadata: {
                statusCode: res.statusCode,
              },
            });
            console.error(
              "Deepgram Headers:",
              JSON.stringify(res.headers, null, 2),
            );
            if (res.statusCode === 404) {
              console.error(
                "This usually means the Deepgram API key does not have access to the Voice Agent API, or the endpoint is incorrect.",
              );
            }

            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              if (body) console.error("Deepgram Error Body:", body);
              if (ws.readyState === ws.OPEN) {
                ws.close(1011, `Deepgram returned ${res.statusCode}`);
              }
            });
          });

          dgWs.on("message", (data, isBinary) => {
            if (ws.readyState === ws.OPEN) {
              if (isBinary) {
                deepgramOutputBytes += rawByteLength(data);
                if (wsCanSend(ws)) {
                  ws.send(data);
                } else {
                  recordSystemActivity({
                    kind: "voice",
                    status: "blocked",
                    title: "Voice provider audio dropped under backpressure",
                    detail:
                      "The browser websocket buffer was full, so stale realtime audio was dropped.",
                    requestId: voiceRequestId,
                    phase: "provider_backpressure",
                    metadata: voiceProofActivityMetadata(),
                  });
                }
              } else {
                const messageStr = data.toString();
                try {
                  const parsed = JSON.parse(messageStr);
                  if (parsed.type === "Welcome") {
                    recordSystemActivity({
                      kind: "voice",
                      status: "progress",
                      title: "Voice provider connected",
                      detail:
                        "Deepgram Welcome received; waiting for SettingsApplied before releasing buffered audio.",
                      requestId: voiceRequestId,
                      phase: "provider_connect",
                      metadata: {
                        bufferedFrames: messageBuffer.length,
                        ...voiceProofActivityMetadata(),
                      },
                    });
                  } else if (parsed.type === "SettingsApplied") {
                    isDeepgramReady = true;
                    recordSystemActivity({
                      kind: "voice",
                      status: "completed",
                      title: "Voice provider ready",
                      detail:
                        "SettingsApplied received; buffered audio/control frames released.",
                      requestId: voiceRequestId,
                      phase: "settings",
                      metadata: {
                        bufferedFrames: messageBuffer.length,
                        ...voiceProofActivityMetadata(),
                      },
                    });
                    const bufferedFrames = messageBuffer.splice(0);
                    bufferedFrames.forEach((msg) => {
                      if (
                        dgWs?.readyState === WSWebSocket.OPEN &&
                        wsCanSend(dgWs)
                      ) {
                        dgWs.send(
                          msg.isBinary ? msg.data : msg.data.toString(),
                          {
                            binary: msg.isBinary,
                          },
                        );
                      } else {
                        queueVoiceAgentFrame(msg.data, msg.isBinary);
                      }
                    });
                  } else if (parsed.type === "FunctionCallRequest") {
                    const functions = Array.isArray(parsed.functions)
                      ? parsed.functions
                      : [];
                    recordVoiceToolRequest(functions);
                  } else if (parsed.type === "FunctionCallResponse") {
                    recordVoiceToolResponse(
                      parsed,
                      "Voice tool response received",
                    );
                  } else if (parsed.type === "ConversationText") {
                    const role =
                      typeof parsed.role === "string" ? parsed.role : "";
                    const content = compactActivityText(parsed.content);
                    recordSystemActivity({
                      kind: "voice",
                      status: "completed",
                      title: "Voice provider transcript",
                      detail: content
                        ? `${role || "speaker"}: ${content}`
                        : "ConversationText received without content.",
                      requestId: voiceRequestId,
                      phase: "transcript",
                      metadata: {
                        providerEvent: parsed.type,
                        role: role || undefined,
                        characterCount:
                          typeof parsed.content === "string"
                            ? parsed.content.length
                            : 0,
                        ...voiceProofActivityMetadata(),
                      },
                    });
                  } else if (
                    typeof parsed.type === "string" &&
                    /^(Warning|UserStartedSpeaking|AgentStartedSpeaking|AgentAudioDone|AgentFinishedSpeaking|Error)$/i.test(
                      parsed.type,
                    )
                  ) {
                    const warningMessage = compactActivityText(
                      parsed.message || parsed.error || parsed.description,
                    );
                    recordSystemActivity({
                      kind: "voice",
                      status:
                        parsed.type === "Error" || parsed.type === "Warning"
                          ? "failed"
                          : "progress",
                      title: `Voice provider event: ${parsed.type}`,
                      detail:
                        warningMessage ||
                        "Deepgram voice-agent status event received.",
                      requestId: voiceRequestId,
                      phase:
                        parsed.type === "Error" || parsed.type === "Warning"
                          ? "provider_error"
                          : "provider_event",
                      metadata: {
                        providerEvent: parsed.type,
                        ...voiceProofActivityMetadata(),
                      },
                    });
                  }
                } catch (e) {}
                if (wsCanSend(ws)) {
                  ws.send(messageStr);
                }
              }
            }
          });

          dgWs.on("close", () => {
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
            if (ws.readyState === ws.OPEN) {
              sendVoiceUsage(1);
              recordSystemActivity({
                kind: "voice",
                status: "completed",
                title: "Voice provider closed",
                detail: "Deepgram closed the voice session.",
                requestId: voiceRequestId,
                phase: "closed",
                metadata: {
                  inputBytes: clientInputBytes,
                  outputBytes: deepgramOutputBytes,
                  ...voiceProofActivityMetadata(),
                },
              });
              ws.close();
            }
          });

          dgWs.on("error", (error) => {
            console.error("Deepgram WS Error:", error);
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
            if (ws.readyState === ws.OPEN) {
              const reason = "Deepgram voice agent error";
              recordSystemActivity({
                kind: "voice",
                status: "failed",
                title: "Voice provider error",
                detail: reason,
                requestId: voiceRequestId,
                phase: "provider_error",
                metadata: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              });
              ws.close(1011, reason);
            }
          });
        } catch (e) {
          if (usageInterval) {
            clearInterval(usageInterval);
            usageInterval = null;
          }
          console.error("Failed to connect to Deepgram", e);
          recordSystemActivity({
            kind: "voice",
            status: "failed",
            title: "Voice provider connection failed",
            detail: "Failed to connect to Deepgram.",
            requestId: voiceRequestId,
            phase: "provider_connect",
            metadata: {
              message: e instanceof Error ? e.message : String(e),
            },
          });
          ws.close(1011, "Failed to connect to Deepgram");
        }

        return true;
      };

      const forwardClientMessage = (data: any, isBinary: boolean) => {
        if (isBinary) {
          clientInputBytes += rawByteLength(data);
          if (!hasRecordedClientAudioInput && isVoiceSessionStarted) {
            hasRecordedClientAudioInput = true;
            recordSystemActivity({
              kind: "voice",
              status: "progress",
              title: "Voice input audio received",
              detail:
                "Browser microphone PCM frames reached the voice websocket.",
              requestId: voiceRequestId,
              phase: "client_audio",
              metadata: {
                inputBytes: clientInputBytes,
                inputSampleRate: voiceInputSampleRate,
                ...voiceProofActivityMetadata(),
              },
            });
          }
        } else {
          const text = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : String(data);
          try {
            const payload = JSON.parse(text);
            if (payload?.type === "FunctionCallResponse") {
              recordVoiceToolResponse(payload, "Voice client tool completed");
            }
          } catch {}
        }
        // Proxy messages to Deepgram once ready
        if (
          isDeepgramReady &&
          dgWs &&
          dgWs.readyState === dgWs.OPEN &&
          wsCanSend(dgWs)
        ) {
          dgWs.send(isBinary ? data : data.toString(), { binary: isBinary });
        } else {
          queueVoiceAgentFrame(data, isBinary);
        }
      };

      ws.on("message", (data, isBinary) => {
        if (!isVoiceSessionStarted) {
          const authPayload = parseVoiceAuth(data, isBinary);
          if (authPayload) {
            clearTimeout(authDeadline);
            const clientRequestId = normalizeClientRequestId(
              authPayload.voiceSessionId || authPayload.requestId,
            );
            if (clientRequestId) {
              voiceRequestId = clientRequestId;
            }
            const studyContextMetadata = objectMetadata(
              authPayload.studyContextMetadata,
            );
            const proofAttemptId =
              normalizeClientRequestId(authPayload.proofAttemptId) ||
              normalizeClientRequestId(studyContextMetadata.proofAttemptId);
            if (proofAttemptId) {
              voiceProofAttemptId = proofAttemptId;
            }
            startVoiceSession(
              authPayload.language || language,
              sanitizeApiKey(authPayload.deepgramKey),
              compactVoiceStudyContext(authPayload.studyContext),
              {
                activeBookId:
                  typeof authPayload.activeBookId === "string"
                    ? authPayload.activeBookId
                    : "",
                activeBookTitle:
                  typeof authPayload.activeBookTitle === "string"
                    ? authPayload.activeBookTitle
                    : "",
                activeDocumentId:
                  typeof authPayload.activeDocumentId === "string"
                    ? authPayload.activeDocumentId
                    : "",
                proofAttemptId: proofAttemptId || undefined,
                mode: "voice",
                agentLayer: "voice_realtime",
                documentIds: Array.isArray(authPayload.documentIds)
                  ? authPayload.documentIds
                      .filter(
                        (documentId: unknown) =>
                          typeof documentId === "string" && documentId.trim(),
                      )
                      .slice(0, 12)
                  : [],
                documentCount: Number(authPayload.documentCount || 0),
                readyDocumentIds: compactStringList(
                  authPayload.readyDocumentIds ||
                    studyContextMetadata.readyDocumentIds,
                ),
                readyDocumentCount: nonNegativeInteger(
                  authPayload.readyDocumentCount ??
                    studyContextMetadata.readyDocumentCount,
                ),
                contextDocumentIds: compactStringList(
                  authPayload.contextDocumentIds ||
                    studyContextMetadata.contextDocumentIds,
                ),
                unreadyDocumentCount: nonNegativeInteger(
                  authPayload.unreadyDocumentCount ??
                    studyContextMetadata.unreadyDocumentCount,
                ),
                omittedReadyDocumentCount: nonNegativeInteger(
                  authPayload.omittedReadyDocumentCount ??
                    studyContextMetadata.omittedReadyDocumentCount,
                ),
                clientStudyContextChars: Number(
                  authPayload.studyContextChars || 0,
                ),
                rawContextChars: nonNegativeInteger(
                  studyContextMetadata.rawContextChars,
                ),
                memoryContextChars: nonNegativeInteger(
                  studyContextMetadata.memoryContextChars,
                ),
                activeBookContextChars: nonNegativeInteger(
                  studyContextMetadata.activeBookContextChars,
                ),
                documentContextChars: nonNegativeInteger(
                  studyContextMetadata.documentContextChars,
                ),
                contextCompacted: Boolean(
                  studyContextMetadata.contextCompacted,
                ),
                inputSampleRate: normalizeVoiceInputSampleRate(
                  authPayload.inputSampleRate,
                ),
                clientRequestId: clientRequestId || undefined,
              },
              authPayload.inputSampleRate,
            );
            return;
          }

          clearTimeout(authDeadline);
          ws.close(1008, "Voice authentication must be the first message");
          return;
        }

        forwardClientMessage(data, isBinary);
      });

      ws.on("close", () => {
        clearTimeout(authDeadline);
        if (usageInterval) clearInterval(usageInterval);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        recordSystemActivity({
          kind: "voice",
          status: "completed",
          title: "Voice client closed",
          detail: "Browser voice websocket closed; Deepgram proxy cleanup ran.",
          requestId: voiceRequestId,
          phase: "client_close",
          metadata: {
            inputBytes: clientInputBytes,
            outputBytes: deepgramOutputBytes,
            ready: isDeepgramReady,
            ...voiceProofActivityMetadata(),
          },
        });
        if (dgWs && dgWs.readyState === dgWs.OPEN) {
          dgWs.close();
        }
      });
    });
  };

  return { app, attachWebSockets };
}

const parseServerStartOptions = (
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ServerStartOptions => {
  let portValue = env.PORT || "3000";
  let host = env.HOST || "0.0.0.0";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port" || arg === "-p") {
      portValue = argv[index + 1] || portValue;
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      portValue = arg.slice("--port=".length) || portValue;
      continue;
    }
    if (arg === "--host" || arg === "-H") {
      host = argv[index + 1] || host;
      index += 1;
      continue;
    }
    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length) || host;
    }
  }

  const parsedPort = Number(portValue);
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : 3000;

  return {
    host: host.trim() || "0.0.0.0",
    port,
  };
};

export { parseServerStartOptions };

async function startServer() {
  const { host, port } = parseServerStartOptions();
  const { app, attachWebSockets } = await createTutorServerApp({
    serveClient: true,
  });

  const server = app.listen(port, host, () => {
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`[SYS] Server running on http://${displayHost}:${port}`);
  });
  attachWebSockets(server);
}

const isDirectRun =
  !process.env.VERCEL &&
  /(?:^|[/\\])server\.(?:ts|js|mjs|cjs)$/.test(process.argv[1] || "");

if (isDirectRun) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
