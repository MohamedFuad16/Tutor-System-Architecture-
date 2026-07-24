import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Message } from "../types";
import type { AccessMode, PlanTier } from "../lib/accessPlans";
import {
  DEFAULT_BRAIN_RUNTIME_SETTINGS,
  normalizeBrainRuntimeSettings,
  type BrainRuntimeSettings,
} from "../lib/brainRuntimeSettings";
import {
  getOrCreateLocalLearnerUserId,
  persistLocalLearnerUserId,
} from "../lib/localLearnerProfile";

export type ViewState = "study" | "analytics" | "revision" | "admin";

const ACTIVE_BETA_PROOF_ATTEMPT_STORAGE_KEY = "active_beta_proof_attempt_id";
const BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY = "beta_proof_traffic_approval";

export type BetaProofTrafficApproval = {
  attemptId: string;
  approvedAt: number;
};

export interface Concept {
  id: string;
  name: string;
  confidence: number;
  description: string;
  related: string[];
  project: string;
}

export interface Annotation {
  id: string;
  bookId?: string;
  documentId?: string;
  pageNumber: number;
  rects: {
    x: number;
    y: number;
    width: number;
    height: number;
    pageIndex: number;
  }[];
  text: string;
  color: string;
  note?: string;
  type?: "highlight" | "underline" | "strikethrough" | "sticky";
}

export interface ChatUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  estimated: boolean;
  requests: number;
}

export interface WebUsage {
  provider: string;
  requests: number;
  searchRequests: number;
  newsRequests: number;
  sourcesReviewed: number;
  failures: number;
  cost: number;
  estimated: boolean;
}

export interface VoiceUsage {
  provider: string;
  voiceAgentModel: string;
  ttsModel: string;
  listenModel: string;
  speakModel: string;
  connectionSeconds: number;
  inputAudioSeconds: number;
  outputAudioSeconds: number;
  ttsCharacters: number;
  cost: number;
  estimated: boolean;
  sessions: number;
}

export interface PricingState {
  openRouterModels: Record<
    string,
    { prompt: number; completion: number; name?: string }
  >;
  deepgram: {
    voiceAgentPerMinute: number;
    aura1Per1kCharacters: number;
    aura2Per1kCharacters: number;
    fluxEnglishPerHour?: number;
  };
  fetchedAt: string | null;
  source: string;
  stale: boolean;
}

export type WebSearchMode = "search" | "news";

export interface NormalizedWebSource {
  id: string;
  type: WebSearchMode;
  sourceType?: "web" | "image";
  title: string;
  url: string;
  domain: string;
  faviconUrl: string;
  snippet: string;
  date?: string;
  position: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSource?: string;
}

export interface WebSearchEvent {
  id: string;
  type: "started" | "progress" | "result" | "complete" | "error";
  searchId: string;
  query?: string;
  mode?: WebSearchMode;
  status?: string;
  source?: NormalizedWebSource;
  sources?: NormalizedWebSource[];
  timestamp: number;
}

export type VoiceAgentEventType =
  | "session_started"
  | "context_attached"
  | "settings_applied"
  | "broker_ready"
  | "tool_call"
  | "background_job"
  | "mic_signal"
  | "user_turn"
  | "assistant_turn"
  | "agent_started_speaking"
  | "agent_finished_speaking"
  | "barge_in"
  | "session_ended"
  | "error";

export interface VoiceAgentEvent {
  id: string;
  type: VoiceAgentEventType;
  status: "started" | "running" | "completed" | "failed";
  sessionId?: string;
  summary: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const emptyChatUsage: ChatUsage = {
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  estimated: false,
  requests: 0,
};

const DEFAULT_AI_MODEL = "deepseek/deepseek-v4-flash";
const BRAIN_RUNTIME_SETTINGS_STORAGE_KEY = "brain_runtime_settings";
const VOICE_MODE_STORAGE_KEY = "voice_mode";

// Runtime voice mode (chosen in Settings, no rebuild needed):
// - deepgram-duplex: the default two-model "interaction" mimic — a fast
//   foreground model keeps the conversation moving via Deepgram STT/TTS while an
//   async background model does the heavy lifting. Runs on the voice server.
// - openai-realtime: a test/comparison-only speech-to-speech path (WebRTC,
//   BYOK OpenAI key). Expensive; never the default.
export type VoiceMode = "deepgram-duplex" | "openai-realtime";
const VOICE_MODES: VoiceMode[] = ["deepgram-duplex", "openai-realtime"];
const normalizeVoiceMode = (value: string | null | undefined): VoiceMode => {
  if (value && (VOICE_MODES as string[]).includes(value)) {
    return value as VoiceMode;
  }
  return "deepgram-duplex";
};

// One OpenRouter key powers several models. Defaults: a cheap/fast model for the
// chat and voice foreground ("interaction tutor"), and a stronger model shared
// as the background/smart worker for both chat delegation and voice.
const VOICE_FOREGROUND_MODEL_STORAGE_KEY = "voice_foreground_model";
const BACKGROUND_MODEL_STORAGE_KEY = "background_model";
const DEFAULT_VOICE_FOREGROUND_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_BACKGROUND_MODEL = "openai/gpt-5.5";

const normalizeAiModel = (model: string | null) =>
  model === "deepseek/deepseek-chat"
    ? DEFAULT_AI_MODEL
    : model || DEFAULT_AI_MODEL;

const emptyWebUsage: WebUsage = {
  provider: "serper",
  requests: 0,
  searchRequests: 0,
  newsRequests: 0,
  sourcesReviewed: 0,
  failures: 0,
  cost: 0,
  estimated: true,
};

const emptyVoiceUsage: VoiceUsage = {
  provider: "deepgram",
  voiceAgentModel: "Deepgram Voice Agent",
  ttsModel: "aura-asteria-en",
  listenModel: "flux-general-en",
  speakModel: "aura-asteria-en",
  connectionSeconds: 0,
  inputAudioSeconds: 0,
  outputAudioSeconds: 0,
  ttsCharacters: 0,
  cost: 0,
  estimated: false,
  sessions: 0,
};

const readBrainRuntimeSettings = (): BrainRuntimeSettings => {
  try {
    const raw = localStorage.getItem(BRAIN_RUNTIME_SETTINGS_STORAGE_KEY);
    return normalizeBrainRuntimeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_BRAIN_RUNTIME_SETTINGS;
  }
};

const persistBrainRuntimeSettings = (settings: BrainRuntimeSettings) => {
  localStorage.setItem(
    BRAIN_RUNTIME_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  );
};

const emptyPricing: PricingState = {
  openRouterModels: {},
  deepgram: {
    voiceAgentPerMinute: 0.075,
    aura1Per1kCharacters: 0.015,
    aura2Per1kCharacters: 0.03,
    fluxEnglishPerHour: 4.5,
  },
  fetchedAt: null,
  source: "fallback",
  stale: true,
};

const usageStorageKey = "usage_analytics_v1";

const readStoredUsage = () => {
  try {
    const raw = localStorage.getItem(usageStorageKey);
    if (!raw)
      return {
        chatUsage: emptyChatUsage,
        voiceUsage: emptyVoiceUsage,
        webUsage: emptyWebUsage,
        pricing: emptyPricing,
      };
    const parsed = JSON.parse(raw);
    return {
      chatUsage: { ...emptyChatUsage, ...(parsed.chatUsage || {}) },
      voiceUsage: { ...emptyVoiceUsage, ...(parsed.voiceUsage || {}) },
      webUsage: { ...emptyWebUsage, ...(parsed.webUsage || {}) },
      pricing: {
        ...emptyPricing,
        ...(parsed.pricing || {}),
        deepgram: {
          ...emptyPricing.deepgram,
          ...(parsed.pricing?.deepgram || {}),
        },
        openRouterModels: parsed.pricing?.openRouterModels || {},
      },
    };
  } catch {
    return {
      chatUsage: emptyChatUsage,
      voiceUsage: emptyVoiceUsage,
      webUsage: emptyWebUsage,
      pricing: emptyPricing,
    };
  }
};

const persistUsage = (
  chatUsage: ChatUsage,
  voiceUsage: VoiceUsage,
  webUsage: WebUsage,
  pricing: PricingState,
) => {
  localStorage.setItem(
    usageStorageKey,
    JSON.stringify({ chatUsage, voiceUsage, webUsage, pricing }),
  );
};

const readBetaProofTrafficApproval = (): BetaProofTrafficApproval | null => {
  try {
    const raw = localStorage.getItem(BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BetaProofTrafficApproval>;
    if (
      typeof parsed.attemptId !== "string" ||
      !parsed.attemptId.trim() ||
      typeof parsed.approvedAt !== "number" ||
      !Number.isFinite(parsed.approvedAt)
    ) {
      return null;
    }
    return {
      attemptId: parsed.attemptId.trim(),
      approvedAt: parsed.approvedAt,
    };
  } catch {
    return null;
  }
};

interface AppState {
  accessMode: AccessMode;
  setAccessMode: (mode: AccessMode) => void;
  planTier: PlanTier;
  setPlanTier: (tier: PlanTier) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  serperApiKey: string;
  setSerperApiKey: (key: string) => void;
  deepgramApiKey: string;
  setDeepgramApiKey: (key: string) => void;
  learnerName: string;
  setLearnerName: (name: string) => void;
  activeUserId: string;
  setActiveUserId: (userId: string) => void;
  activeView: ViewState;
  setActiveView: (view: ViewState) => void;

  pdfUrl: string | null;
  setPdfUrl: (url: string | null) => void;
  pdfScale: number;
  setPdfScale: (scale: number) => void;
  pdfPage: number;
  setPdfPage: (page: number) => void;
  pdfTotalPages: number;
  setPdfTotalPages: (total: number) => void;
  activeDocumentId: string | null;
  setActiveDocumentId: (documentId: string | null) => void;

  annotations: Annotation[];
  addAnnotation: (ann: Annotation) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  removeAnnotationsForDocument: (documentId: string) => void;

  concepts: Concept[];
  setConcepts: (concepts: Concept[]) => void;
  addConcept: (concept: Concept) => void;

  askTutorQuery: string;
  setAskTutorQuery: (query: string) => void;

  ttsVoice: string;
  setTtsVoice: (voice: string) => void;
  voiceMode: VoiceMode;
  setVoiceMode: (mode: VoiceMode) => void;

  aiModel: string;
  setAiModel: (model: string) => void;
  voiceForegroundModel: string;
  setVoiceForegroundModel: (model: string) => void;
  backgroundModel: string;
  setBackgroundModel: (model: string) => void;

  animationsEnabled: boolean;
  setAnimationsEnabled: (enabled: boolean) => void;

  activeProject: string;
  setActiveProject: (project: string) => void;
  activeLearningBookId: string | null;
  setActiveLearningBookId: (bookId: string | null) => void;

  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;

  brainRuntimeSettings: BrainRuntimeSettings;
  setBrainRuntimeSettings: (settings: Partial<BrainRuntimeSettings>) => void;
  resetBrainRuntimeSettings: () => void;
  activeBetaProofAttemptId: string | null;
  setActiveBetaProofAttemptId: (attemptId: string | null) => void;
  clearActiveBetaProofAttempt: () => void;
  betaProofTrafficApproval: BetaProofTrafficApproval | null;
  approveBetaProofProviderTraffic: (attemptId: string) => void;
  clearBetaProofProviderTrafficApproval: () => void;

  totalTokens: number;
  estimatedCost: number;
  addTokens: (tokens: number, cost: number) => void;
  resetAnalytics: () => void;
  chatUsage: ChatUsage;
  voiceUsage: VoiceUsage;
  webUsage: WebUsage;
  pricing: PricingState;
  setPricing: (pricing: PricingState) => void;
  recordChatUsage: (usage: Partial<ChatUsage>) => void;
  recordVoiceUsage: (usage: Partial<VoiceUsage>) => void;
  recordWebUsage: (usage: Partial<WebUsage>) => void;
  resetUsageAnalytics: () => void;
  webSourceCache: Record<string, NormalizedWebSource>;
  webSearchEvents: WebSearchEvent[];
  recordWebSearchEvent: (
    event: Omit<WebSearchEvent, "id" | "timestamp">,
  ) => void;
  cacheWebSources: (sources: NormalizedWebSource[]) => void;
  voiceAgentEvents: VoiceAgentEvent[];
  recordVoiceAgentEvent: (
    event: Omit<VoiceAgentEvent, "id" | "timestamp">,
  ) => void;
  clearVoiceAgentEvents: () => void;
  selectedTextContext: string;
  setSelectedTextContext: (text: string) => void;
  messages: Message[];
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  /** True while voice agent is connected or TTS is playing */
  isVoiceActive: boolean;
  setIsVoiceActive: (active: boolean) => void;
  language: string;
  setLanguage: (lang: string) => void;
}

const storedUsage = readStoredUsage();
const readAccessMode = (): AccessMode =>
  localStorage.getItem("access_mode") === "admin" ? "admin" : "user";
const readPlanTier = (): PlanTier => {
  const stored = localStorage.getItem("plan_tier");
  return stored === "plus" || stored === "pro" ? stored : "free";
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      accessMode: readAccessMode(),
      setAccessMode: (mode) => {
        localStorage.setItem("access_mode", mode);
        set({ accessMode: mode });
      },
      planTier: readPlanTier(),
      setPlanTier: (tier) => {
        localStorage.setItem("plan_tier", tier);
        set({ planTier: tier });
      },
      activeView: "study",
      setActiveView: (view) => set({ activeView: view }),
      language: localStorage.getItem("learning_ai_language") || "en",
      setLanguage: (lang) => {
        localStorage.setItem("learning_ai_language", lang);
        set({ language: lang });
      },
      apiKey: localStorage.getItem("openrouter_api_key") || "",
      setApiKey: (key) => {
        localStorage.setItem("openrouter_api_key", key);
        set({ apiKey: key });
      },
      serperApiKey: localStorage.getItem("serper_api_key") || "",
      setSerperApiKey: (key: string) => {
        localStorage.setItem("serper_api_key", key);
        set({ serperApiKey: key });
      },
      deepgramApiKey: localStorage.getItem("deepgram_api_key") || "",
      setDeepgramApiKey: (key: string) => {
        localStorage.setItem("deepgram_api_key", key);
        set({ deepgramApiKey: key });
      },
      learnerName: localStorage.getItem("learner_name") || "Learner",
      setLearnerName: (name: string) => {
        const cleanName = name.trim() || "Learner";
        localStorage.setItem("learner_name", cleanName);
        set({ learnerName: cleanName });
      },
      activeUserId: getOrCreateLocalLearnerUserId(),
      setActiveUserId: (userId: string) => {
        set({ activeUserId: persistLocalLearnerUserId(userId) });
      },
      pdfUrl: null as string | null,
      setPdfUrl: (url) => set({ pdfUrl: url }),
      pdfScale: 1,
      setPdfScale: (scale) => set({ pdfScale: scale }),
      pdfPage: 1,
      setPdfPage: (page) => set({ pdfPage: page }),
      pdfTotalPages: 0,
      setPdfTotalPages: (total) => set({ pdfTotalPages: total }),
      activeDocumentId: localStorage.getItem("active_document_id") || null,
      setActiveDocumentId: (documentId) => {
        if (documentId) {
          localStorage.setItem("active_document_id", documentId);
        } else {
          localStorage.removeItem("active_document_id");
        }
        set({ activeDocumentId: documentId });
      },

      annotations: [] as Annotation[],
      addAnnotation: (ann) =>
        set((state) => ({ annotations: [...state.annotations, ann] })),
      setAnnotations: (annotations) => set({ annotations }),
      removeAnnotationsForDocument: (documentId) =>
        set((state) => ({
          annotations: state.annotations.filter(
            (annotation) => annotation.documentId !== documentId,
          ),
        })),

      concepts: [] as Concept[],
      setConcepts: (concepts) => set({ concepts }),
      addConcept: (concept) =>
        set((state) => ({ concepts: [...state.concepts, concept] })),

      askTutorQuery: "",
      setAskTutorQuery: (query) => set({ askTutorQuery: query }),

      ttsVoice: localStorage.getItem("tts_voice") || "aura-asteria-en",
      setTtsVoice: (voice) => {
        localStorage.setItem("tts_voice", voice);
        set({ ttsVoice: voice });
      },
      voiceMode: normalizeVoiceMode(
        localStorage.getItem(VOICE_MODE_STORAGE_KEY),
      ),
      setVoiceMode: (mode) => {
        const normalized = normalizeVoiceMode(mode);
        localStorage.setItem(VOICE_MODE_STORAGE_KEY, normalized);
        set({ voiceMode: normalized });
      },

      aiModel: normalizeAiModel(localStorage.getItem("ai_model")),
      setAiModel: (model) => {
        const normalizedModel = normalizeAiModel(model);
        localStorage.setItem("ai_model", normalizedModel);
        set({ aiModel: normalizedModel });
      },
      voiceForegroundModel:
        localStorage.getItem(VOICE_FOREGROUND_MODEL_STORAGE_KEY) ||
        DEFAULT_VOICE_FOREGROUND_MODEL,
      setVoiceForegroundModel: (model) => {
        const clean = model.trim() || DEFAULT_VOICE_FOREGROUND_MODEL;
        localStorage.setItem(VOICE_FOREGROUND_MODEL_STORAGE_KEY, clean);
        set({ voiceForegroundModel: clean });
      },
      backgroundModel:
        localStorage.getItem(BACKGROUND_MODEL_STORAGE_KEY) ||
        DEFAULT_BACKGROUND_MODEL,
      setBackgroundModel: (model) => {
        const clean = model.trim() || DEFAULT_BACKGROUND_MODEL;
        localStorage.setItem(BACKGROUND_MODEL_STORAGE_KEY, clean);
        set({ backgroundModel: clean });
      },

      animationsEnabled: localStorage.getItem("animations_enabled") !== "false",
      setAnimationsEnabled: (enabled) => {
        localStorage.setItem("animations_enabled", String(enabled));
        set({ animationsEnabled: enabled });
      },

      activeProject: localStorage.getItem("active_project") || "General Study",
      setActiveProject: (project) => {
        const cleanProject = project.trim() || "General Study";
        localStorage.setItem("active_project", cleanProject);
        set({ activeProject: cleanProject });
      },
      activeLearningBookId:
        localStorage.getItem("active_learning_book_id") || null,
      setActiveLearningBookId: (bookId) => {
        if (bookId) {
          localStorage.setItem("active_learning_book_id", bookId);
        } else {
          localStorage.removeItem("active_learning_book_id");
        }
        set({ activeLearningBookId: bookId });
      },

      systemPrompt: localStorage.getItem("system_prompt") || "",
      setSystemPrompt: (prompt) => {
        localStorage.setItem("system_prompt", prompt);
        set({ systemPrompt: prompt });
      },

      brainRuntimeSettings: readBrainRuntimeSettings(),
      setBrainRuntimeSettings: (settings) =>
        set((state) => {
          const next = normalizeBrainRuntimeSettings({
            ...state.brainRuntimeSettings,
            ...settings,
          });
          persistBrainRuntimeSettings(next);
          return { brainRuntimeSettings: next };
        }),
      resetBrainRuntimeSettings: () => {
        persistBrainRuntimeSettings(DEFAULT_BRAIN_RUNTIME_SETTINGS);
        set({ brainRuntimeSettings: DEFAULT_BRAIN_RUNTIME_SETTINGS });
      },
      activeBetaProofAttemptId:
        localStorage.getItem(ACTIVE_BETA_PROOF_ATTEMPT_STORAGE_KEY) || null,
      betaProofTrafficApproval: readBetaProofTrafficApproval(),
      setActiveBetaProofAttemptId: (attemptId) => {
        const cleanAttemptId = attemptId?.trim() || null;
        if (cleanAttemptId) {
          localStorage.setItem(
            ACTIVE_BETA_PROOF_ATTEMPT_STORAGE_KEY,
            cleanAttemptId,
          );
        } else {
          localStorage.removeItem(ACTIVE_BETA_PROOF_ATTEMPT_STORAGE_KEY);
        }
        const currentApproval = get().betaProofTrafficApproval;
        const approvalStillMatches =
          cleanAttemptId && currentApproval?.attemptId === cleanAttemptId;
        if (!approvalStillMatches) {
          localStorage.removeItem(BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY);
        }
        set({
          activeBetaProofAttemptId: cleanAttemptId,
          betaProofTrafficApproval: approvalStillMatches
            ? currentApproval
            : null,
        });
      },
      clearActiveBetaProofAttempt: () => {
        localStorage.removeItem(ACTIVE_BETA_PROOF_ATTEMPT_STORAGE_KEY);
        localStorage.removeItem(BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY);
        set({
          activeBetaProofAttemptId: null,
          betaProofTrafficApproval: null,
        });
      },
      approveBetaProofProviderTraffic: (attemptId) => {
        const cleanAttemptId = attemptId.trim();
        if (!cleanAttemptId) return;
        const approval = {
          attemptId: cleanAttemptId,
          approvedAt: Date.now(),
        };
        localStorage.setItem(
          BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY,
          JSON.stringify(approval),
        );
        set({ betaProofTrafficApproval: approval });
      },
      clearBetaProofProviderTrafficApproval: () => {
        localStorage.removeItem(BETA_PROOF_TRAFFIC_APPROVAL_STORAGE_KEY);
        set({ betaProofTrafficApproval: null });
      },

      totalTokens:
        storedUsage.chatUsage.inputTokens + storedUsage.chatUsage.outputTokens,
      estimatedCost:
        storedUsage.chatUsage.cost +
        storedUsage.voiceUsage.cost +
        storedUsage.webUsage.cost,
      addTokens: (tokens, cost) =>
        set((state) => {
          const chatUsage = {
            ...state.chatUsage,
            outputTokens: state.chatUsage.outputTokens + tokens,
            cost: state.chatUsage.cost + cost,
            estimated: true,
          };
          const totalTokens = chatUsage.inputTokens + chatUsage.outputTokens;
          const estimatedCost =
            chatUsage.cost + state.voiceUsage.cost + state.webUsage.cost;
          persistUsage(
            chatUsage,
            state.voiceUsage,
            state.webUsage,
            state.pricing,
          );
          return { chatUsage, totalTokens, estimatedCost };
        }),
      resetAnalytics: () => get().resetUsageAnalytics(),

      chatUsage: storedUsage.chatUsage,
      voiceUsage: storedUsage.voiceUsage,
      webUsage: storedUsage.webUsage,
      pricing: storedUsage.pricing,
      setPricing: (pricing) =>
        set((state) => {
          persistUsage(
            state.chatUsage,
            state.voiceUsage,
            state.webUsage,
            pricing,
          );
          return { pricing };
        }),
      recordChatUsage: (usage) =>
        set((state) => {
          const chatUsage = {
            ...state.chatUsage,
            provider: usage.provider || state.chatUsage.provider,
            model: usage.model || state.chatUsage.model,
            inputTokens: state.chatUsage.inputTokens + (usage.inputTokens || 0),
            outputTokens:
              state.chatUsage.outputTokens + (usage.outputTokens || 0),
            cost: state.chatUsage.cost + (usage.cost || 0),
            estimated: Boolean(usage.estimated ?? state.chatUsage.estimated),
            requests: state.chatUsage.requests + (usage.requests ?? 1),
          };
          const totalTokens = chatUsage.inputTokens + chatUsage.outputTokens;
          const estimatedCost =
            chatUsage.cost + state.voiceUsage.cost + state.webUsage.cost;
          persistUsage(
            chatUsage,
            state.voiceUsage,
            state.webUsage,
            state.pricing,
          );
          return { chatUsage, totalTokens, estimatedCost };
        }),
      recordVoiceUsage: (usage) =>
        set((state) => {
          const voiceUsage = {
            ...state.voiceUsage,
            provider: usage.provider || state.voiceUsage.provider,
            voiceAgentModel:
              usage.voiceAgentModel || state.voiceUsage.voiceAgentModel,
            ttsModel: usage.ttsModel || state.voiceUsage.ttsModel,
            listenModel: usage.listenModel || state.voiceUsage.listenModel,
            speakModel: usage.speakModel || state.voiceUsage.speakModel,
            connectionSeconds: Math.max(
              0,
              state.voiceUsage.connectionSeconds +
                (usage.connectionSeconds || 0),
            ),
            inputAudioSeconds: Math.max(
              0,
              state.voiceUsage.inputAudioSeconds +
                (usage.inputAudioSeconds || 0),
            ),
            outputAudioSeconds: Math.max(
              0,
              state.voiceUsage.outputAudioSeconds +
                (usage.outputAudioSeconds || 0),
            ),
            ttsCharacters:
              state.voiceUsage.ttsCharacters + (usage.ttsCharacters || 0),
            cost: state.voiceUsage.cost + (usage.cost || 0),
            estimated: Boolean(usage.estimated ?? state.voiceUsage.estimated),
            sessions: state.voiceUsage.sessions + (usage.sessions || 0),
          };
          const estimatedCost =
            state.chatUsage.cost + voiceUsage.cost + state.webUsage.cost;
          persistUsage(
            state.chatUsage,
            voiceUsage,
            state.webUsage,
            state.pricing,
          );
          return { voiceUsage, estimatedCost };
        }),
      recordWebUsage: (usage) =>
        set((state) => {
          const webUsage = {
            ...state.webUsage,
            provider: usage.provider || state.webUsage.provider,
            requests: state.webUsage.requests + (usage.requests || 0),
            searchRequests:
              state.webUsage.searchRequests + (usage.searchRequests || 0),
            newsRequests:
              state.webUsage.newsRequests + (usage.newsRequests || 0),
            sourcesReviewed:
              state.webUsage.sourcesReviewed + (usage.sourcesReviewed || 0),
            failures: state.webUsage.failures + (usage.failures || 0),
            cost: state.webUsage.cost + (usage.cost || 0),
            estimated: Boolean(usage.estimated ?? state.webUsage.estimated),
          };
          const estimatedCost =
            state.chatUsage.cost + state.voiceUsage.cost + webUsage.cost;
          persistUsage(
            state.chatUsage,
            state.voiceUsage,
            webUsage,
            state.pricing,
          );
          return { webUsage, estimatedCost };
        }),
      resetUsageAnalytics: () =>
        set((state) => {
          persistUsage(
            emptyChatUsage,
            emptyVoiceUsage,
            emptyWebUsage,
            state.pricing,
          );
          return {
            chatUsage: emptyChatUsage,
            voiceUsage: emptyVoiceUsage,
            webUsage: emptyWebUsage,
            totalTokens: 0,
            estimatedCost: 0,
          };
        }),
      webSourceCache: {},
      webSearchEvents: [] as WebSearchEvent[],
      recordWebSearchEvent: (event) =>
        set((state) => ({
          webSearchEvents: [
            {
              ...event,
              id: `${event.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              timestamp: Date.now(),
            },
            ...state.webSearchEvents,
          ].slice(0, 100),
        })),
      cacheWebSources: (sources) =>
        set((state) => {
          const webSourceCache = { ...state.webSourceCache };
          sources.forEach((source) => {
            webSourceCache[source.id || source.url] = source;
          });
          return { webSourceCache };
        }),
      voiceAgentEvents: [] as VoiceAgentEvent[],
      recordVoiceAgentEvent: (event) =>
        set((state) => ({
          voiceAgentEvents: [
            {
              ...event,
              id: `${event.type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              timestamp: Date.now(),
            },
            ...state.voiceAgentEvents,
          ].slice(0, 100),
        })),
      clearVoiceAgentEvents: () => set({ voiceAgentEvents: [] }),

      selectedTextContext: "",
      setSelectedTextContext: (text) => set({ selectedTextContext: text }),
      messages: [
        {
          id: "1",
          role: "assistant",
          content: `**Hello. I'm your AI Tutor.**

I'm ready to help you explore concepts, discuss code, and break down complex subjects. Here are a few things we can do:
- **Analyze Documents:** Upload a PDF and ask me questions about specific pages.
- **Discuss Code:** Paste code snippets and we can debug or refactor them.
- **Learn Concepts:** Ask me general programming and computer science questions.

What would you like to learn today?`,
        },
      ],
      setMessages: (updater) =>
        set((state) => ({
          messages:
            typeof updater === "function" ? updater(state.messages) : updater,
        })),
      isVoiceActive: false,
      setIsVoiceActive: (active) => set({ isVoiceActive: active }),
    }),
    {
      name: "learning-ai-store",
      merge: (persisted, current) => {
        const persistedState = (persisted || {}) as Partial<AppState>;
        const { messages: _messages, ...safePersistedState } = persistedState;
        return {
          ...current,
          ...safePersistedState,
          messages: current.messages,
        };
      },
      partialize: (state) => ({
        activeProject: state.activeProject,
        activeLearningBookId: state.activeLearningBookId,
        activeDocumentId: state.activeDocumentId,
        activeUserId: state.activeUserId,
        activeBetaProofAttemptId: state.activeBetaProofAttemptId,
        activeView: state.activeView,
        language: state.language,
      }),
    },
  ),
);
