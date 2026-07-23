import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  type ArtifactRecord,
  type BackgroundJob,
  type BookChatThread,
  type CitationState,
  type CorrectionEvent,
  type EvidenceEvent,
  type MasteryDelta,
  type MemoryEvent,
  type Misconception,
  type ModelRun,
  type RetrievalEvent,
  type ToolJob,
} from "../memory/longterm.memory";
import { recordMemoryEvent } from "../memory/memory.events";
import {
  Terminal,
  Activity,
  Clock,
  ChevronRight,
  Menu,
  BookOpen,
  Network,
  Sparkles,
  BrainCircuit,
  Wrench,
  Gauge,
  AlertTriangle,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Cpu,
  Flag,
  Trash2,
} from "lucide-react";
import { gsap } from "gsap";
import { useStore } from "../store";
import { useMotionPreference } from "../hooks/useMotionPreference";
import {
  buildBrainFlowCoverageFromLedgers,
  buildBetaDiagnosticsExport,
  buildBetaDiagnosticsSnapshot,
  buildCoherentLiveProofFromLedgers,
  buildLiveBetaProofPreflight,
  buildMasteryLedgerIntegrity,
  buildProviderKeyProofChecklist,
} from "../memory/beta.diagnostics";
import {
  runLocalBrainWiringRehearsal,
  summarizeBrainWiringRehearsalGap,
  type BrainWiringRehearsalResult,
} from "../memory/brain.rehearsal";
import {
  applyCorrectionPropagation,
  recordAndApplyCorrectionEvent,
  updateCorrectionEventReviewStatus,
} from "../memory/correction.events";
import {
  recordStoredAudioOverviewArtifacts,
  supportsLocalCitationIntegrityArtifact,
  verifyArtifactCitationIntegrity,
  verifyCitationStateIntegrity,
} from "../memory/artifact.records";
import {
  BRAIN_RUNTIME_SETTING_LIMITS,
  DEFAULT_BRAIN_RUNTIME_SETTINGS,
  MASTERY_EVIDENCE_POLICIES,
  type BrainRuntimeSettings,
  type MasteryEvidencePolicy,
  type BrainWebSearchPolicy,
} from "../lib/brainRuntimeSettings";
import { builtInBookAudioOverviewEntries } from "../lib/chapterAudioOverviews";
import { summarizeChatThreadPersistence } from "../lib/chatThreadUtils";
import type { LearnerAlgorithmId } from "../memory/learner.algorithm";

type ServerConsoleStatus = "idle" | "connecting" | "connected" | "unavailable";
type AdminTab =
  | "learners"
  | "brain"
  | "activity"
  | "models"
  | "memory"
  | "corrections"
  | "artifacts"
  | "diagnostics"
  | "retrieval"
  | "evidence"
  | "tuning"
  | "traces"
  | "console";
type ActivityStatus = "idle" | "loading" | "ready" | "error";
const TRACE_PAGE_SIZE = 100;
const MAIN_ACTIVITY_EVENT_LIMIT = 12;
const MAIN_REQUEST_TIMELINE_LIMIT = 5;

type SystemActivityEvent = {
  id: string;
  timestamp: number;
  kind: string;
  status: string;
  title: string;
  detail?: string;
  requestId?: string;
  model?: string;
  toolName?: string;
  phase?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

type AdminRequestTimeline = {
  requestId: string;
  startedAt: number;
  latestAt: number;
  status: string;
  title: string;
  model?: string;
  durationMs?: number;
  events: SystemActivityEvent[];
  memoryEvents: MemoryEvent[];
  retrievalEvents: RetrievalEvent[];
  modelRuns: ModelRun[];
  toolJobs: ToolJob[];
  backgroundJobs: BackgroundJob[];
};

type SystemActivityPayload = {
  generatedAt: string;
  localOnly: boolean;
  retention: { limit: number; strategy: string };
  summary: {
    total: number;
    byKind: Record<string, number>;
    byStatus: Record<string, number>;
    latestError: SystemActivityEvent | null;
    latestEventAt: number | null;
    retentionLimit: number;
  };
  meters: {
    providers: Record<string, boolean>;
    providerDetails?: {
      misoTts?: {
        configured: boolean;
        reachable: boolean;
        status: number;
        error?: string;
      };
    };
    graph: Record<string, string>;
    tuning: Record<string, string | number>;
  };
  events: SystemActivityEvent[];
};

const serverBaseUrl = () => {
  const httpProtocol =
    window.location.protocol === "https:" ? "https:" : "http:";
  const hostPort =
    import.meta.env.DEV && /^517\d$/.test(window.location.port)
      ? `${window.location.hostname}:3000`
      : window.location.host;
  return `${httpProtocol}//${hostPort}`;
};

const serverWsUrl = () => {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostPort =
    import.meta.env.DEV && /^517\d$/.test(window.location.port)
      ? `${window.location.hostname}:3000`
      : window.location.host;
  return `${wsProtocol}//${hostPort}`;
};

const serverApiUrl = (path: string) =>
  import.meta.env.DEV ? `${serverBaseUrl()}${path}` : path;

const readDebugToken = () => {
  try {
    return window.localStorage?.getItem("tutor_debug_token") || "";
  } catch {
    return "";
  }
};

const webSearchPolicyOptions: {
  id: BrainWebSearchPolicy;
  label: string;
  description: string;
}[] = [
  {
    id: "source_first",
    label: "Source First",
    description: "Use local page, book, and memory context before web search.",
  },
  {
    id: "manual_only",
    label: "Manual Only",
    description: "Block automatic web search unless the Search skill is used.",
  },
  {
    id: "auto_freshness",
    label: "Auto Freshness",
    description: "Allow freshness-sensitive web retrieval when detected.",
  },
];

const masteryEvidencePolicyDetails: Record<
  MasteryEvidencePolicy,
  { label: string; description: string }
> = {
  validated_only: {
    label: "Validated Only",
    description:
      "Only explicit scored recall or quiz evidence can stage mastery updates.",
  },
  review_required: {
    label: "Review Required",
    description:
      "Allow staged evaluated-answer rows, but keep Admin review visible before trust increases.",
  },
};

const masteryEvidencePolicyOptions = MASTERY_EVIDENCE_POLICIES.map((id) => ({
  id,
  ...masteryEvidencePolicyDetails[id],
}));

const artifactTypeBuckets: ArtifactRecord["artifactType"][] = [
  "source_card",
  "chart",
  "code",
  "image",
  "website",
  "flashcards",
  "notes",
  "audio_overview",
  "preview",
  "other",
];

const isLocallyVerifiableArtifactType = (
  artifactType: ArtifactRecord["artifactType"],
) => supportsLocalCitationIntegrityArtifact({ artifactType });

const formatTime = (timestamp?: number | null) =>
  timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "waiting";

const formatDurationMinutes = (durationMs?: number) =>
  typeof durationMs === "number" && Number.isFinite(durationMs)
    ? `${Math.max(0, Math.round(durationMs / 60000))}m`
    : "waiting";

const statusTone = (status: string) => {
  if (
    status === "completed" ||
    status === "applied" ||
    status === "ready" ||
    status === "verified"
  )
    return "border-green-200 bg-green-50 text-green-700";
  if (
    status === "failed" ||
    status === "blocked" ||
    status === "dead_letter" ||
    status === "conflicting"
  )
    return "border-red-200 bg-red-50 text-red-700";
  if (
    status === "fallback" ||
    status === "retry_scheduled" ||
    status === "watch" ||
    status === "needs_review" ||
    status === "unavailable" ||
    status === "unsupported" ||
    status === "stale"
  )
    return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "deferred")
    return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "dismissed")
    return "border-white/15 bg-white/[0.06] text-zinc-400";
  return "border-blue-200 bg-blue-50 text-blue-700";
};

const statusWeight = (status: string) => {
  if (status === "blocked" || status === "failed" || status === "dead_letter")
    return 6;
  if (status === "fallback") return 5;
  if (
    status === "running" ||
    status === "started" ||
    status === "pending" ||
    status === "retry_scheduled"
  )
    return 4;
  if (status === "completed" || status === "applied" || status === "ready")
    return 3;
  return 1;
};

const objectRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringMetadataValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
};

const numberMetadataValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = metadata?.[key];
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
};

const booleanMetadataValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
};

const stringListMetadataValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
) =>
  Array.isArray(metadata?.[key])
    ? (metadata?.[key] as unknown[])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

const learnerAlgorithmIds: LearnerAlgorithmId[] = [
  "conservative_threshold",
  "bayesian_knowledge_tracing",
  "decay_sensitive_bkt",
];

const learnerAlgorithmLabels: Record<LearnerAlgorithmId, string> = {
  conservative_threshold: "Conservative evidence threshold",
  bayesian_knowledge_tracing: "Bayesian Knowledge Tracing",
  decay_sensitive_bkt: "Decay-sensitive BKT",
};

const learnerAlgorithmShortLabels: Record<LearnerAlgorithmId, string> = {
  conservative_threshold: "Conservative",
  bayesian_knowledge_tracing: "BKT",
  decay_sensitive_bkt: "Decay BKT",
};

const isLearnerAlgorithmId = (value: unknown): value is LearnerAlgorithmId =>
  value === "conservative_threshold" ||
  value === "bayesian_knowledge_tracing" ||
  value === "decay_sensitive_bkt";

const learnerAlgorithmDetailsFromMetadata = (
  metadata: Record<string, unknown> | undefined,
) => {
  const selection = objectRecord(metadata?.learningAlgorithmSelection);
  const directAlgorithm = metadata?.learningAlgorithm;
  const selectedAlgorithm = selection?.selectedAlgorithm;
  const algorithm = isLearnerAlgorithmId(directAlgorithm)
    ? directAlgorithm
    : isLearnerAlgorithmId(selectedAlgorithm)
      ? selectedAlgorithm
      : null;
  if (!algorithm) return null;

  const metadataLabel = stringMetadataValue(metadata, "learningAlgorithmLabel");
  const selectedLabel =
    typeof selection?.selectedLabel === "string"
      ? selection.selectedLabel.trim()
      : "";
  const metadataReason = stringMetadataValue(
    metadata,
    "learningAlgorithmReason",
  );
  const selectedReason =
    typeof selection?.selectionReason === "string"
      ? selection.selectionReason.trim()
      : "";
  const confidence = Number(selection?.selectionConfidence);

  return {
    algorithm,
    label: metadataLabel || selectedLabel || learnerAlgorithmLabels[algorithm],
    reason: metadataReason || selectedReason,
    confidence:
      Number.isFinite(confidence) && confidence > 0
        ? Math.round(confidence * 100)
        : null,
  };
};

const generatedNoteClaimSpanCoverageFor = (record: ArtifactRecord) => {
  if (record.artifactType !== "notes") return null;
  const localCitationIntegrity = objectRecord(
    record.metadata?.localCitationIntegrity,
  );
  const coverage =
    objectRecord(localCitationIntegrity?.generatedNoteClaimSpanCoverage) ||
    objectRecord(record.metadata?.claimSpanCoverage);
  if (!coverage || typeof coverage.state !== "string") return null;

  return {
    state: coverage.state,
    coveragePercent: Number(coverage.coveragePercent) || 0,
    matchedClaimCount: Number(coverage.matchedClaimCount) || 0,
    claimCount: Number(coverage.claimCount) || 0,
  };
};

const requestIdForRetrievalEvent = (event: RetrievalEvent) =>
  event.requestId || stringMetadataValue(event.metadata, "requestId");

const correctionPropagationFor = (event: CorrectionEvent) => {
  const metadata = objectRecord(event.metadata);
  return objectRecord(metadata?.propagation);
};

const correctionImpactedRows = (event: CorrectionEvent) => {
  const propagation = correctionPropagationFor(event);
  const impactedRows = propagation?.impactedRows;
  return typeof impactedRows === "number" && Number.isFinite(impactedRows)
    ? Math.max(0, Math.round(impactedRows))
    : 0;
};

const kindIcon = (kind: string) => {
  if (kind === "model") return BrainCircuit;
  if (kind === "tool") return Wrench;
  if (kind === "memory" || kind === "retrieval") return Network;
  if (kind === "error") return AlertTriangle;
  return Activity;
};

const createBetaProofAttemptId = () => {
  const randomPart =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `beta-${Date.now().toString(36)}-${randomPart}`;
};

export function AdminView() {
  const {
    setActiveView,
    activeUserId,
    learnerName,
    chatUsage,
    voiceUsage,
    webUsage,
    aiModel,
    systemPrompt,
    apiKey,
    deepgramApiKey,
    ttsVoice,
    misoTtsApiUrl,
    activeLearningBookId,
    activeProject,
    pricing,
    webSearchEvents,
    voiceAgentEvents,
    clearVoiceAgentEvents,
    brainRuntimeSettings,
    setBrainRuntimeSettings,
    resetBrainRuntimeSettings,
    activeBetaProofAttemptId,
    setActiveBetaProofAttemptId,
    clearActiveBetaProofAttempt,
    betaProofTrafficApproval,
    approveBetaProofProviderTraffic,
    clearBetaProofProviderTrafficApproval,
    setAskTutorQuery,
  } = useStore();
  const motionEnabled = useMotionPreference();
  const [traceLimit, setTraceLimit] = useState(TRACE_PAGE_SIZE);
  const logs = useLiveQuery(
    () =>
      db.traceLogs.orderBy("timestamp").reverse().limit(traceLimit).toArray(),
    [traceLimit],
  );
  const totalTraceCount = useLiveQuery(() => db.traceLogs.count(), []) || 0;
  const learningBooks =
    useLiveQuery(
      () =>
        db.learningBooks.orderBy("updatedAt").reverse().limit(500).toArray(),
      [],
    ) || [];
  const learningDocuments =
    useLiveQuery(
      () =>
        db.learningDocuments
          .orderBy("updatedAt")
          .reverse()
          .limit(500)
          .toArray(),
      [],
    ) || [];
  const learningBookConcepts =
    useLiveQuery(
      () =>
        db.learningBookConcepts
          .orderBy("updatedAt")
          .reverse()
          .limit(500)
          .toArray(),
      [],
    ) || [];
  const persistentConcepts =
    useLiveQuery(
      () =>
        db.concepts.orderBy("lastReviewedAt").reverse().limit(500).toArray(),
      [],
    ) || [];
  const learningEntries =
    useLiveQuery(
      () =>
        db.learningEntries.orderBy("timestamp").reverse().limit(500).toArray(),
      [],
    ) || [];
  const evidenceEvents =
    useLiveQuery(
      () =>
        db.evidenceEvents.orderBy("timestamp").reverse().limit(500).toArray(),
      [],
    ) || [];
  const misconceptions =
    useLiveQuery(() => db.misconceptions.toArray(), []) || [];
  const masteryDeltas =
    useLiveQuery(
      () => db.masteryDeltas.orderBy("timestamp").reverse().limit(30).toArray(),
      [],
    ) || [];
  const masteryIntegrityEvidenceEvents =
    useLiveQuery(() => db.evidenceEvents.toArray(), []) || [];
  const masteryIntegrityDeltas =
    useLiveQuery(() => db.masteryDeltas.toArray(), []) || [];
  const toolJobs =
    useLiveQuery(
      () => db.toolJobs.orderBy("timestamp").reverse().limit(20).toArray(),
      [],
    ) || [];
  const backgroundJobs =
    useLiveQuery(
      () =>
        db.backgroundJobs.orderBy("timestamp").reverse().limit(30).toArray(),
      [],
    ) || [];
  const modelRuns =
    useLiveQuery(
      () => db.modelRuns.orderBy("timestamp").reverse().limit(30).toArray(),
      [],
    ) || [];
  const memoryEvents =
    useLiveQuery(
      () => db.memoryEvents.orderBy("timestamp").reverse().limit(50).toArray(),
      [],
    ) || [];
  const bookChatThreads =
    useLiveQuery(
      () =>
        db.bookChatThreads.orderBy("updatedAt").reverse().limit(30).toArray(),
      [],
    ) || [];
  const retrievalEvents =
    useLiveQuery(
      () =>
        db.retrievalEvents.orderBy("timestamp").reverse().limit(50).toArray(),
      [],
    ) || [];
  const correctionEvents =
    useLiveQuery(
      () =>
        db.correctionEvents.orderBy("timestamp").reverse().limit(50).toArray(),
      [],
    ) || [];
  const artifactRecords =
    useLiveQuery(
      () =>
        db.artifactRecords.orderBy("timestamp").reverse().limit(50).toArray(),
      [],
    ) || [];
  const artifactTypeCounts =
    useLiveQuery(async () => {
      const entries = await Promise.all(
        artifactTypeBuckets.map(async (artifactType) => {
          const count = await db.artifactRecords
            .where("artifactType")
            .equals(artifactType)
            .count();
          return [artifactType, count] as const;
        }),
      );
      return Object.fromEntries(
        entries.filter(([, count]) => count > 0),
      ) as Partial<Record<ArtifactRecord["artifactType"], number>>;
    }, []) || {};
  const readyArtifactRecordCount =
    useLiveQuery(
      () => db.artifactRecords.where("status").equals("ready").count(),
      [],
    ) || 0;
  const citationStates =
    useLiveQuery(
      () =>
        db.citationStates.orderBy("timestamp").reverse().limit(50).toArray(),
      [],
    ) || [];
  const citationArtifactTypeById =
    useLiveQuery(async () => {
      const artifactIds = Array.from(
        new Set(
          citationStates
            .map((state) => state.artifactId)
            .filter((artifactId): artifactId is string => Boolean(artifactId)),
        ),
      );
      if (artifactIds.length === 0) return {};

      const records = await db.artifactRecords.bulkGet(artifactIds);
      return records.reduce<
        Partial<Record<string, ArtifactRecord["artifactType"]>>
      >((acc, record) => {
        if (record) acc[record.id] = record.artifactType;
        return acc;
      }, {});
    }, [citationStates.map((state) => state.artifactId || "").join("|")]) || {};
  const evidenceEventCount =
    useLiveQuery(() => db.evidenceEvents.count(), []) || 0;
  const verifiedEvidenceCount =
    useLiveQuery(
      () => db.evidenceEvents.filter((event) => event.verified).count(),
      [],
    ) || 0;
  const modelSummaryEvidenceCount =
    useLiveQuery(
      () =>
        db.evidenceEvents.where("evidenceType").equals("model_summary").count(),
      [],
    ) || 0;
  const masteryDeltaCount =
    useLiveQuery(() => db.masteryDeltas.count(), []) || 0;
  const toolJobCount = useLiveQuery(() => db.toolJobs.count(), []) || 0;
  const backgroundJobCount =
    useLiveQuery(() => db.backgroundJobs.count(), []) || 0;
  const modelRunCount = useLiveQuery(() => db.modelRuns.count(), []) || 0;
  const memoryEventCount = useLiveQuery(() => db.memoryEvents.count(), []) || 0;
  const bookChatThreadCount =
    useLiveQuery(() => db.bookChatThreads.count(), []) || 0;
  const retrievalEventCount =
    useLiveQuery(() => db.retrievalEvents.count(), []) || 0;
  const correctionEventCount =
    useLiveQuery(() => db.correctionEvents.count(), []) || 0;
  const artifactRecordCount =
    useLiveQuery(() => db.artifactRecords.count(), []) || 0;
  const citationStateCount =
    useLiveQuery(() => db.citationStates.count(), []) || 0;
  const checkingCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("checking").count(),
      [],
    ) || 0;
  const unavailableCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("unavailable").count(),
      [],
    ) || 0;
  const verifiedCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("verified").count(),
      [],
    ) || 0;
  const conflictingCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("conflicting").count(),
      [],
    ) || 0;
  const unsupportedCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("unsupported").count(),
      [],
    ) || 0;
  const notCheckedCitationStateCount =
    useLiveQuery(
      () => db.citationStates.where("state").equals("not_checked").count(),
      [],
    ) || 0;
  const [serverLogs, setServerLogs] = useState<
    { type: string; msg: string; time: number }[]
  >([]);
  const [serverConsoleStatus, setServerConsoleStatus] =
    useState<ServerConsoleStatus>("idle");
  const [activityPayload, setActivityPayload] =
    useState<SystemActivityPayload | null>(null);
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("idle");
  const [activityError, setActivityError] = useState("");
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const consoleRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("learners");
  const [selectedLearnerName, setSelectedLearnerName] = useState(
    learnerName || "Learner",
  );
  const shouldLoadActivityPayload =
    activeTab === "learners" ||
    activeTab === "brain" ||
    activeTab === "activity" ||
    activeTab === "diagnostics";
  const [correctionAction, setCorrectionAction] =
    useState<CorrectionEvent["action"]>("mark_wrong");
  const [correctionTargetType, setCorrectionTargetType] =
    useState<CorrectionEvent["targetType"]>("memory_event");
  const [correctionTargetId, setCorrectionTargetId] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionFeedback, setCorrectionFeedback] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [citationVerifierFeedback, setCitationVerifierFeedback] = useState("");
  const [citationVerifierError, setCitationVerifierError] = useState("");
  const [citationVerifierBusyId, setCitationVerifierBusyId] = useState("");
  const [diagnosticsExportFeedback, setDiagnosticsExportFeedback] =
    useState("");
  const [brainWiringRehearsal, setBrainWiringRehearsal] =
    useState<BrainWiringRehearsalResult | null>(null);
  const storedAudioOverviewInputs = useMemo(
    () =>
      builtInBookAudioOverviewEntries.map((overview) => ({
        overviewId: `${overview.bookId}:chapter-${overview.chapterIndex}:stored-audio-overview`,
        bookId: overview.bookId,
        bookTitle: overview.bookTitle,
        chapterIndex: overview.chapterIndex,
        chapterTitle: overview.chapterTitle,
        title: overview.title,
        summary: overview.summary,
        transcript: overview.transcript,
        audioSrc: overview.audioSrc,
        durationLabel: overview.durationLabel,
        durationSeconds: overview.durationSeconds,
        generatedBy: overview.generatedBy,
        voice: overview.voice,
        storedAt: overview.storedAt,
        metadata: {
          assetKind: "built_in_book_chapter_audio",
          displaySurface: "RevisionView",
        },
      })),
    [],
  );

  // Auto-scroll console
  useEffect(() => {
    void recordStoredAudioOverviewArtifacts(storedAudioOverviewInputs);
  }, [storedAudioOverviewInputs]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [serverLogs]);

  useEffect(() => {
    if (!shouldLoadActivityPayload) return;

    let cancelled = false;
    let inFlight = false;
    const loadActivity = async (showLoading: boolean): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      if (showLoading) setActivityStatus("loading");
      setActivityError("");
      try {
        const debugToken = readDebugToken();
        const response = await fetch(
          serverApiUrl("/api/debug/system-activity"),
          {
            cache: "no-store",
            headers: {
              ...(debugToken ? { "X-Debug-Token": debugToken } : {}),
              ...(misoTtsApiUrl.trim()
                ? { "x-miso-tts-api-url": misoTtsApiUrl.trim() }
                : {}),
            },
          },
        );
        if (!response.ok) {
          throw new Error(`System activity unavailable (${response.status})`);
        }
        const payload = (await response.json()) as SystemActivityPayload;
        if (!cancelled) {
          setActivityPayload(payload);
          setActivityStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setActivityStatus("error");
          setActivityError(
            error instanceof Error
              ? error.message
              : "System activity unavailable",
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void loadActivity(true);
    const interval = window.setInterval(
      (): void => void loadActivity(false),
      brainRuntimeSettings.activityRefreshMs,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    shouldLoadActivityPayload,
    activityRefreshKey,
    misoTtsApiUrl,
    brainRuntimeSettings.activityRefreshMs,
  ]);

  useEffect(() => {
    if (activeTab !== "console") {
      setServerConsoleStatus("idle");
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    const appendLog = (entry: { type: string; msg: string; time: number }) => {
      setServerLogs((prev) => [...prev.slice(-99), entry]);
    };

    const connect = async () => {
      setServerConsoleStatus("connecting");

      try {
        const response = await fetch(`${serverBaseUrl()}/api/health`, {
          cache: "no-store",
          mode: import.meta.env.DEV ? "no-cors" : "same-origin",
        });
        if (!response.ok && response.type !== "opaque") {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch {
        if (!cancelled) {
          setServerConsoleStatus("unavailable");
          appendLog({
            type: "warn",
            msg: "Server console is offline. Start the Tutor backend to stream live logs.",
            time: Date.now(),
          });
        }
        return;
      }

      if (cancelled) return;

      ws = new WebSocket(`${serverWsUrl()}/ws/debug`);

      ws.onopen = () => {
        if (!cancelled) {
          setServerConsoleStatus("connected");
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          appendLog({
            type: data.type || "log",
            msg: data.msg || "",
            time: data.timestamp || Date.now(),
          });
        } catch (e) {
          appendLog({
            type: "log",
            msg: event.data,
            time: Date.now(),
          });
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onclose = () => {
        if (!cancelled) {
          setServerConsoleStatus("unavailable");
        }
      };
    };

    void connect();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [activeTab]);

  const conceptsByBook = learningBookConcepts.reduce<
    Record<string, typeof learningBookConcepts>
  >((acc, concept) => {
    acc[concept.bookId] = acc[concept.bookId] || [];
    acc[concept.bookId].push(concept);
    return acc;
  }, {});
  const learnerNames = useMemo(
    () =>
      Array.from(
        new Set(
          [learnerName, ...learningBooks.map((book) => book.userName)]
            .map((name) => String(name || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [learnerName, learningBooks],
  );
  useEffect(() => {
    if (learnerNames.length === 0) return;
    if (!learnerNames.includes(selectedLearnerName)) {
      setSelectedLearnerName(learnerNames[0]);
    }
  }, [learnerNames, selectedLearnerName]);
  const selectedLearnerBooks = learningBooks.filter(
    (book) => book.userName === selectedLearnerName,
  );
  const selectedLearnerBookIds = new Set(
    selectedLearnerBooks.map((book) => book.id),
  );
  const selectedLearnerConcepts = learningBookConcepts.filter((concept) =>
    selectedLearnerBookIds.has(concept.bookId),
  );
  const selectedLearnerEvidence = evidenceEvents.filter(
    (event) => event.bookId && selectedLearnerBookIds.has(event.bookId),
  );
  const selectedLearnerEntries = learningEntries.filter((entry) =>
    selectedLearnerBookIds.has(entry.bookId),
  );
  const learnerGraphNodes = selectedLearnerConcepts
    .slice(0, 12)
    .map((concept, index) => ({
      concept,
      x: 110 + (index % 4) * 210,
      y: 90 + Math.floor(index / 4) * 125,
    }));
  const learnerGraphNodeByName = new Map(
    learnerGraphNodes.map((node) => [node.concept.name.toLowerCase(), node]),
  );
  const learnerGraphEdges = learnerGraphNodes.flatMap((node) =>
    [...node.concept.parentConcepts, ...node.concept.childConcepts].flatMap(
      (relatedName) => {
        const related = learnerGraphNodeByName.get(relatedName.toLowerCase());
        if (!related || related.concept.id === node.concept.id) return [];
        return [
          {
            id: [node.concept.id, related.concept.id].sort().join(":"),
            from: node,
            to: related,
          },
        ];
      },
    ),
  );
  const uniqueLearnerGraphEdges = Array.from(
    new Map(learnerGraphEdges.map((edge) => [edge.id, edge])).values(),
  );
  const strongestLearnerConcepts = [...selectedLearnerConcepts]
    .sort((a, b) => b.mastery + b.confidence - (a.mastery + a.confidence))
    .slice(0, 3);
  const learnerConceptsToReview = [...selectedLearnerConcepts]
    .sort((a, b) => a.mastery + a.confidence - (b.mastery + b.confidence))
    .slice(0, 3);
  const latestEntryByBook = learningEntries.reduce<
    Record<string, (typeof learningEntries)[number]>
  >((acc, entry) => {
    if (!acc[entry.bookId]) acc[entry.bookId] = entry;
    return acc;
  }, {});
  const traceCount = totalTraceCount || logs?.length || 0;
  const latestTrace = logs?.[0];
  const latestEvidence = evidenceEvents[0] as EvidenceEvent | undefined;
  const sortedMisconceptions = useMemo(
    () =>
      [...misconceptions].sort(
        (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
      ),
    [misconceptions],
  );
  const activeMisconceptions = sortedMisconceptions.filter(
    (misconception) => !misconception.resolved,
  );
  const latestMisconception = sortedMisconceptions[0] as
    | Misconception
    | undefined;
  const latestMasteryDelta = masteryDeltas[0] as MasteryDelta | undefined;
  const latestToolJob = toolJobs[0] as ToolJob | undefined;
  const latestBackgroundJob = backgroundJobs[0] as BackgroundJob | undefined;
  const latestModelRun = modelRuns[0] as ModelRun | undefined;
  const latestMemoryEvent = memoryEvents[0] as MemoryEvent | undefined;
  const latestBookChatThread = bookChatThreads[0] as BookChatThread | undefined;
  const latestRetrievalEvent = retrievalEvents[0] as RetrievalEvent | undefined;
  const latestCorrectionEvent = correctionEvents[0] as
    | CorrectionEvent
    | undefined;
  const latestArtifactRecord = artifactRecords[0] as ArtifactRecord | undefined;
  const latestCitationState = citationStates[0] as CitationState | undefined;
  const completedModelRuns = modelRuns.filter(
    (run) => run.status === "completed",
  ).length;
  const blockedOrFailedModelRuns = modelRuns.filter(
    (run) => run.status === "blocked" || run.status === "failed",
  ).length;
  const fallbackModelRuns = modelRuns.filter(
    (run) => run.status === "fallback",
  ).length;
  const runningBackgroundJobs = backgroundJobs.filter(
    (job) => job.status === "running" || job.status === "queued",
  ).length;
  const retryScheduledBackgroundJobs = backgroundJobs.filter(
    (job) => job.status === "retry_scheduled",
  ).length;
  const deadLetterBackgroundJobs = backgroundJobs.filter(
    (job) => job.status === "dead_letter",
  ).length;
  const backgroundJobsByName = backgroundJobs.reduce<Record<string, number>>(
    (acc, job) => {
      acc[job.jobName] = (acc[job.jobName] || 0) + 1;
      return acc;
    },
    {},
  );
  const completedMemoryEvents = memoryEvents.filter(
    (event) => event.status === "completed",
  ).length;
  const failedMemoryEvents = memoryEvents.filter(
    (event) => event.status === "failed",
  ).length;
  const learningBookMemoryEvents = memoryEvents.filter(
    (event) => event.eventType === "learning_book_updated",
  ).length;
  const conceptMemoryEvents = memoryEvents.filter(
    (event) =>
      event.eventType === "learning_concept_updated" ||
      event.eventType === "graph_concept_updated",
  ).length;
  const memoryEventsByType = memoryEvents.reduce<Record<string, number>>(
    (acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    },
    {},
  );
  const bookChatThreadSummaries = bookChatThreads.map((thread) => ({
    thread,
    summary: summarizeChatThreadPersistence(thread.messages),
  }));
  const savedTypedChatThreads = bookChatThreadSummaries.filter(
    ({ summary }) => summary.mode === "chat" || summary.mode === "mixed",
  ).length;
  const savedVoiceThreads = bookChatThreadSummaries.filter(
    ({ summary }) => summary.mode === "voice" || summary.mode === "mixed",
  ).length;
  const completedRetrievalEvents = retrievalEvents.filter(
    (event) => event.status === "completed",
  ).length;
  const failedRetrievalEvents = retrievalEvents.filter(
    (event) => event.status === "failed",
  ).length;
  const retrievalContextChars = retrievalEvents.reduce(
    (sum, event) => sum + (event.contextChars || 0),
    0,
  );
  const retrievalSelectedConcepts = retrievalEvents.reduce(
    (sum, event) => sum + event.selectedConceptIds.length,
    0,
  );
  const openCorrectionEvents = correctionEvents.filter(
    (event) => event.status === "open",
  ).length;
  const appliedCorrectionEvents = correctionEvents.filter(
    (event) => event.status === "applied",
  ).length;
  const blockedCorrectionEvents = correctionEvents.filter(
    (event) => event.status === "blocked",
  ).length;
  const deleteRequestCorrectionEvents = correctionEvents.filter(
    (event) => event.action === "delete_request",
  ).length;
  const markWrongCorrectionEvents = correctionEvents.filter(
    (event) => event.action === "mark_wrong",
  ).length;
  const propagatedCorrectionRows = correctionEvents.reduce(
    (sum, event) => sum + correctionImpactedRows(event),
    0,
  );
  const correctionEventsByTarget = correctionEvents.reduce<
    Record<string, number>
  >((acc, event) => {
    acc[event.targetType] = (acc[event.targetType] || 0) + 1;
    return acc;
  }, {});
  const sourceCardArtifacts = artifactTypeCounts.source_card || 0;
  const flashcardArtifacts = artifactTypeCounts.flashcards || 0;
  const noteArtifacts = artifactTypeCounts.notes || 0;
  const audioOverviewArtifacts = artifactTypeCounts.audio_overview || 0;
  const readyArtifactRecords = readyArtifactRecordCount;
  const locallyVerifiableArtifactRecords = artifactTypeBuckets.reduce(
    (sum, artifactType) =>
      isLocallyVerifiableArtifactType(artifactType)
        ? sum + (artifactTypeCounts[artifactType] || 0)
        : sum,
    0,
  );
  const locallyUnsupportedArtifactRecords = Math.max(
    0,
    artifactRecordCount - locallyVerifiableArtifactRecords,
  );
  const localVerifierCoveragePercent =
    artifactRecordCount > 0
      ? Math.round(
          (locallyVerifiableArtifactRecords / artifactRecordCount) * 100,
        )
      : 0;
  const unsupportedVerifierArtifactTypes = artifactTypeBuckets.filter(
    (artifactType) =>
      !isLocallyVerifiableArtifactType(artifactType) &&
      (artifactTypeCounts[artifactType] || 0) > 0,
  );
  const checkingCitationStates = checkingCitationStateCount;
  const unavailableCitationStates = unavailableCitationStateCount;
  const verifiedCitationStates = verifiedCitationStateCount;
  const conflictingCitationStates = conflictingCitationStateCount;
  const unsupportedCitationStates = unsupportedCitationStateCount;
  const notCheckedCitationStates = notCheckedCitationStateCount;
  const artifactRecordsByType = artifactTypeCounts;
  const artifactRecordsById = new Map(
    artifactRecords.map((record) => [record.id, record]),
  );
  const citationStatesByState = citationStates.reduce<Record<string, number>>(
    (acc, state) => {
      acc[state.state] = (acc[state.state] || 0) + 1;
      return acc;
    },
    {},
  );
  const brainFlowCoverage = buildBrainFlowCoverageFromLedgers({
    memoryEvents,
    retrievalEvents,
    modelRuns,
    toolJobs,
    evidenceEvents,
  });
  const masteryIntegrity = useMemo(
    () =>
      buildMasteryLedgerIntegrity({
        concepts: persistentConcepts,
        evidenceEvents: masteryIntegrityEvidenceEvents,
        masteryDeltas: masteryIntegrityDeltas,
      }),
    [
      masteryIntegrityDeltas,
      masteryIntegrityEvidenceEvents,
      persistentConcepts,
    ],
  );
  const diagnosticGeneratedAtMs = (() => {
    const parsed = activityPayload?.generatedAt
      ? Date.parse(activityPayload.generatedAt)
      : NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const coherentLiveProof = buildCoherentLiveProofFromLedgers(
    {
      memoryEvents,
      retrievalEvents,
      modelRuns,
      toolJobs,
      evidenceEvents,
      systemActivityEvents: activityPayload?.events || [],
    },
    {
      nowMs: diagnosticGeneratedAtMs,
    },
  );
  const betaDiagnosticsSnapshot = buildBetaDiagnosticsSnapshot({
    generatedAt: activityPayload?.generatedAt,
    learningBooks: learningBooks.length,
    mappedConcepts: learningBookConcepts.length,
    bookChatThreads: bookChatThreadCount,
    memoryEvents: memoryEventCount,
    retrievalEvents: retrievalEventCount,
    failedRetrievalEvents,
    modelRuns: modelRunCount,
    blockedOrFailedModelRuns,
    fallbackModelRuns,
    toolJobs: toolJobCount,
    backgroundJobs: backgroundJobCount,
    runningBackgroundJobs,
    retryScheduledBackgroundJobs,
    deadLetterBackgroundJobs,
    artifactRecords: artifactRecordCount,
    citationStates: citationStateCount,
    checkingCitationStates,
    unavailableCitationStates,
    verifiedCitationStates,
    conflictingCitationStates,
    unsupportedCitationStates,
    notCheckedCitationStates,
    correctionEvents: correctionEventCount,
    openCorrectionEvents,
    appliedCorrectionEvents,
    propagatedCorrectionRows,
    evidenceEvents: evidenceEventCount,
    masteryDeltas: masteryDeltaCount,
    masteryIntegrity,
    traceEvents: traceCount,
    webSearches: webUsage.requests,
    brainFlow: brainFlowCoverage,
    coherentLiveProof,
    runtimeSettings: {
      ...brainRuntimeSettings,
      ttsVoice,
      providerMeters: activityPayload?.meters.providers || {},
      providerDetails: activityPayload?.meters.providerDetails || {},
    },
  });
  const providerKeyProofChecklist = useMemo(
    () =>
      buildProviderKeyProofChecklist({
        brainFlow: betaDiagnosticsSnapshot.brainFlow,
        coherentLiveProof: betaDiagnosticsSnapshot.coherentLiveProof,
        providerKeys: {
          chatModelKeyConfigured:
            Boolean(apiKey.trim()) ||
            Boolean(activityPayload?.meters.providers.openRouter),
          voiceRealtimeKeyConfigured:
            Boolean(deepgramApiKey.trim()) ||
            Boolean(activityPayload?.meters.providers.deepgram),
        },
      }),
    [
      activityPayload?.meters.providers.deepgram,
      activityPayload?.meters.providers.openRouter,
      apiKey,
      betaDiagnosticsSnapshot.brainFlow,
      betaDiagnosticsSnapshot.coherentLiveProof,
      deepgramApiKey,
    ],
  );
  const activeProviderTrafficApproval =
    activeBetaProofAttemptId &&
    betaProofTrafficApproval?.attemptId === activeBetaProofAttemptId
      ? betaProofTrafficApproval
      : null;
  const providerTrafficApprovedForActiveAttempt = Boolean(
    activeProviderTrafficApproval,
  );
  const liveProofPreflight = useMemo(
    () =>
      buildLiveBetaProofPreflight({
        providerKeyProof: providerKeyProofChecklist,
        activeLearningBookId,
        activeBetaProofAttemptId,
        providerTrafficApproved: providerTrafficApprovedForActiveAttempt,
        memoryEvents,
        documents: learningDocuments,
      }),
    [
      activeBetaProofAttemptId,
      activeLearningBookId,
      learningDocuments,
      memoryEvents,
      providerTrafficApprovedForActiveAttempt,
      providerKeyProofChecklist,
    ],
  );
  const liveProofRunbook = providerKeyProofChecklist.liveProofRunbook;
  const liveProofDrillPacket = providerKeyProofChecklist.liveProofDrillPacket;
  const liveProofReceipt = providerKeyProofChecklist.liveProofReceipt;
  const liveProofAttemptAudit = liveProofPreflight.attemptAudit;
  const providerTrafficApprovalReady =
    providerTrafficApprovedForActiveAttempt &&
    liveProofPreflight.providerTrafficApprovalEventIds.length > 0;
  const providerTrafficStateLabel = providerTrafficApprovalReady
    ? "approved"
    : providerTrafficApprovedForActiveAttempt
      ? "approval saving"
      : "approval needed";
  const recordProofAttemptLifecycle = (
    eventType:
      | "beta_proof_attempt_started"
      | "beta_proof_attempt_cleared"
      | "beta_provider_traffic_approved"
      | "beta_provider_traffic_approval_cleared",
    proofAttemptId: string,
    metadata: Record<string, unknown> = {},
  ) => {
    void recordMemoryEvent({
      eventType,
      status: "completed",
      source: "admin_beta_diagnostics",
      sessionId: proofAttemptId,
      bookId: activeLearningBookId || undefined,
      summary:
        eventType === "beta_proof_attempt_started"
          ? `Admin started proof attempt ${proofAttemptId}.`
          : eventType === "beta_proof_attempt_cleared"
            ? `Admin cleared proof attempt ${proofAttemptId}.`
            : eventType === "beta_provider_traffic_approved"
              ? `Admin approved provider traffic for proof attempt ${proofAttemptId}.`
              : `Admin cleared provider traffic approval for proof attempt ${proofAttemptId}.`,
      retentionPolicy: "local_indexeddb",
      metadata: {
        proofAttemptId,
        mode: "admin",
        activeLearningBookId: activeLearningBookId || undefined,
        activeProject,
        ...metadata,
      },
    });
  };

  const startLiveProofAttempt = () => {
    const previousProofAttemptId = activeBetaProofAttemptId || undefined;
    const nextProofAttemptId = createBetaProofAttemptId();
    setActiveBetaProofAttemptId(nextProofAttemptId);
    recordProofAttemptLifecycle(
      "beta_proof_attempt_started",
      nextProofAttemptId,
      {
        previousProofAttemptId,
        restarted: Boolean(previousProofAttemptId),
      },
    );
  };
  const clearLiveProofAttempt = () => {
    const proofAttemptId = activeBetaProofAttemptId;
    clearActiveBetaProofAttempt();
    if (proofAttemptId) {
      recordProofAttemptLifecycle("beta_proof_attempt_cleared", proofAttemptId);
    }
  };
  const approveLiveProofProviderTraffic = () => {
    if (!activeBetaProofAttemptId) return;
    approveBetaProofProviderTraffic(activeBetaProofAttemptId);
    recordProofAttemptLifecycle(
      "beta_provider_traffic_approved",
      activeBetaProofAttemptId,
      {
        approvedAt: Date.now(),
        providerTrafficDestinations: ["openrouter", "deepgram"],
        sendsActiveBookContext: true,
        sendsLiveVoiceAudio: true,
      },
    );
    setDiagnosticsExportFeedback(
      `Provider traffic approved for proof attempt ${activeBetaProofAttemptId}.`,
    );
  };
  const revokeLiveProofProviderTrafficApproval = () => {
    const proofAttemptId = activeProviderTrafficApproval?.attemptId;
    clearBetaProofProviderTrafficApproval();
    if (proofAttemptId) {
      recordProofAttemptLifecycle(
        "beta_provider_traffic_approval_cleared",
        proofAttemptId,
        {
          clearedAt: Date.now(),
        },
      );
    }
    setDiagnosticsExportFeedback("Provider traffic approval cleared.");
  };
  const loadLiveProofPrompt = (prompt: string) => {
    setAskTutorQuery(prompt);
    setActiveView("study");
  };
  const brainWiringRehearsalGap = useMemo(
    () =>
      brainWiringRehearsal
        ? summarizeBrainWiringRehearsalGap(
            brainWiringRehearsal,
            betaDiagnosticsSnapshot.brainFlow,
          )
        : null,
    [brainWiringRehearsal, betaDiagnosticsSnapshot.brainFlow],
  );
  const mappedConceptCount = learningBookConcepts.length;
  const tracedBookCount = learningBooks.filter(
    (book) => (conceptsByBook[book.id] || []).length > 0,
  ).length;
  const activeLearningBook = activeLearningBookId
    ? learningBooks.find((book) => book.id === activeLearningBookId)
    : undefined;
  const activeBookDocuments = activeLearningBookId
    ? learningDocuments.filter(
        (document) => document.bookId === activeLearningBookId,
      )
    : [];
  const activeBookReadyDocuments = activeBookDocuments.filter(
    (document) => document.processingStatus === "ready",
  );
  const readyLearningDocuments = learningDocuments.filter(
    (document) => document.processingStatus === "ready",
  );
  const activeBookConceptCount = activeLearningBookId
    ? (conceptsByBook[activeLearningBookId] || []).length
    : 0;
  const activeBookThread = activeLearningBookId
    ? bookChatThreads.find((thread) => thread.bookId === activeLearningBookId)
    : undefined;
  const activeBookThreadSummary = activeBookThread
    ? summarizeChatThreadPersistence(activeBookThread.messages)
    : null;
  const learnerAlgorithmLedgerRows = useMemo(() => {
    const evidenceRows = evidenceEvents.flatMap((event) => {
      const details = learnerAlgorithmDetailsFromMetadata(event.metadata);
      if (!details) return [];
      return [
        {
          id: event.id,
          timestamp: event.timestamp,
          source: "Evidence",
          conceptId: event.conceptId || "concept pending",
          verified: event.verified,
          evidenceType: event.evidenceType,
          ...details,
        },
      ];
    });
    const deltaRows = masteryDeltas.flatMap((delta) => {
      const details = learnerAlgorithmDetailsFromMetadata(delta.metadata);
      if (!details) return [];
      return [
        {
          id: delta.id,
          timestamp: delta.timestamp,
          source: "Mastery",
          conceptId: delta.conceptId,
          verified: delta.verified,
          evidenceType: delta.evidenceType,
          ...details,
        },
      ];
    });

    return [...evidenceRows, ...deltaRows].sort(
      (a, b) => b.timestamp - a.timestamp,
    );
  }, [evidenceEvents, masteryDeltas]);
  const recentLearnerAlgorithmRows = learnerAlgorithmLedgerRows.slice(0, 4);
  const learnerAlgorithmCounts = learnerAlgorithmIds.map((algorithm) => ({
    algorithm,
    label: learnerAlgorithmLabels[algorithm],
    shortLabel: learnerAlgorithmShortLabels[algorithm],
    count: learnerAlgorithmLedgerRows.filter(
      (row) => row.algorithm === algorithm,
    ).length,
  }));
  const activeLearnerAlgorithmCount = learnerAlgorithmCounts.filter(
    (entry) => entry.count > 0,
  ).length;
  const proofSpotlightChecks =
    betaDiagnosticsSnapshot.coherentLiveProof.checks.filter((check) =>
      [
        "typed_chat_request_bundle",
        "live_voice_request_bundle",
        "shared_multi_pdf_context",
        "shared_book_thread",
        "provider_evidence_attempt_bound",
      ].includes(check.id),
    );
  const brainLoopSteps = [
    {
      label: "Capture",
      title: "Chat, voice, PDFs, and revision activity",
      detail: `${memoryEventCount} memory rows and ${learningDocuments.length} PDF source${learningDocuments.length === 1 ? "" : "s"} are stored locally.`,
    },
    {
      label: "Understand",
      title: "Book context and retrieval packets",
      detail: `${retrievalEventCount} retrieval event${retrievalEventCount === 1 ? "" : "s"} can explain what context was assembled for the tutor.`,
    },
    {
      label: "Score",
      title: "Validated evidence updates mastery",
      detail: `${verifiedEvidenceCount} verified evidence row${verifiedEvidenceCount === 1 ? "" : "s"} and ${masteryDeltaCount} mastery delta${masteryDeltaCount === 1 ? "" : "s"} feed BKT.`,
    },
    {
      label: "Inject",
      title: "The tutor receives the active learner packet",
      detail: activeLearningBook
        ? `${activeLearningBook.title} is the active book context.`
        : "General Study is used until a learning book is selected.",
    },
    {
      label: "Adapt",
      title: "Teaching responds to selected learner model",
      detail:
        learnerAlgorithmLedgerRows.length > 0
          ? `${learnerAlgorithmLedgerRows.length} selector decision${learnerAlgorithmLedgerRows.length === 1 ? "" : "s"} chose across ${activeLearnerAlgorithmCount} local algorithm path${activeLearnerAlgorithmCount === 1 ? "" : "s"}.`
          : "The selector is wired; the first validated attempt will record which local learner algorithm was chosen.",
    },
    {
      label: "Prove",
      title: "Admin checks typed chat and live voice",
      detail: betaDiagnosticsSnapshot.coherentLiveProof.ready
        ? "Typed chat and live voice share the same book, thread, provider, and multi-PDF proof bundle."
        : `${betaDiagnosticsSnapshot.coherentLiveProof.readyChecks}/${betaDiagnosticsSnapshot.coherentLiveProof.totalChecks} proof checks are ready.`,
    },
  ];
  const systemEvents = activityPayload?.events || [];
  const systemSummary = activityPayload?.summary;
  const recentSystemEvents = systemEvents.slice(0, MAIN_ACTIVITY_EVENT_LIMIT);
  const requestTimelines = useMemo<AdminRequestTimeline[]>(() => {
    const timelines = new Map<string, AdminRequestTimeline>();

    const ensureTimeline = (
      requestId: string,
      timestamp: number,
      title: string,
      status: string,
      model?: string,
      durationMs?: number,
    ) => {
      const existing = timelines.get(requestId);
      if (!existing) {
        const timeline: AdminRequestTimeline = {
          requestId,
          startedAt: timestamp,
          latestAt: timestamp,
          status,
          title,
          model,
          durationMs,
          events: [],
          memoryEvents: [],
          retrievalEvents: [],
          modelRuns: [],
          toolJobs: [],
          backgroundJobs: [],
        };
        timelines.set(requestId, timeline);
        return timeline;
      }

      existing.startedAt = Math.min(existing.startedAt, timestamp);
      existing.latestAt = Math.max(existing.latestAt, timestamp);
      if (statusWeight(status) >= statusWeight(existing.status)) {
        existing.status = status;
      }
      if (!existing.model && model) existing.model = model;
      if (durationMs !== undefined) {
        existing.durationMs = Math.max(existing.durationMs || 0, durationMs);
      }
      return existing;
    };

    systemEvents.forEach((event) => {
      if (!event.requestId) return;
      const timeline = ensureTimeline(
        event.requestId,
        event.timestamp,
        event.title,
        event.status,
        event.model,
        event.durationMs,
      );
      timeline.events.push(event);
    });

    modelRuns.forEach((run) => {
      if (!run.requestId) return;
      const timeline = ensureTimeline(
        run.requestId,
        run.timestamp,
        run.usedModel || run.requestedModel || "Model request",
        run.status,
        run.usedModel || run.requestedModel,
        run.durationMs,
      );
      timeline.modelRuns.push(run);
    });

    retrievalEvents.forEach((event) => {
      const requestId = requestIdForRetrievalEvent(event);
      if (!requestId) return;
      const timeline = ensureTimeline(
        requestId,
        event.timestamp,
        event.querySummary || "Memory retrieval",
        event.status,
        undefined,
        event.durationMs,
      );
      timeline.retrievalEvents.push(event);
    });

    memoryEvents.forEach((event) => {
      const requestId =
        typeof event.metadata?.requestId === "string"
          ? event.metadata.requestId
          : undefined;
      if (!requestId) return;
      const timeline = ensureTimeline(
        requestId,
        event.timestamp,
        event.summary || "Memory event",
        event.status,
      );
      timeline.memoryEvents.push(event);
    });

    toolJobs.forEach((job) => {
      if (!job.requestId) return;
      const timeline = ensureTimeline(
        job.requestId,
        job.timestamp,
        job.toolName,
        job.status,
        job.model,
        job.durationMs,
      );
      timeline.toolJobs.push(job);
    });

    backgroundJobs.forEach((job) => {
      if (!job.requestId) return;
      const timeline = ensureTimeline(
        job.requestId,
        job.timestamp,
        job.jobName,
        job.status,
        undefined,
        job.durationMs,
      );
      timeline.backgroundJobs.push(job);
    });

    return Array.from(timelines.values())
      .map((timeline) => ({
        ...timeline,
        events: [...timeline.events].sort((a, b) => a.timestamp - b.timestamp),
        memoryEvents: [...timeline.memoryEvents].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
        retrievalEvents: [...timeline.retrievalEvents].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
        modelRuns: [...timeline.modelRuns].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
        toolJobs: [...timeline.toolJobs].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
        backgroundJobs: [...timeline.backgroundJobs].sort(
          (a, b) => a.timestamp - b.timestamp,
        ),
      }))
      .sort((a, b) => b.latestAt - a.latestAt)
      .slice(0, MAIN_REQUEST_TIMELINE_LIMIT);
  }, [
    backgroundJobs,
    memoryEvents,
    modelRuns,
    retrievalEvents,
    systemEvents,
    toolJobs,
  ]);
  const totalChatTokens = chatUsage.inputTokens + chatUsage.outputTokens;
  const totalEstimatedCost = chatUsage.cost + voiceUsage.cost + webUsage.cost;
  const latestVoiceAgentEvent = voiceAgentEvents[0];
  const localProviderCount = activityPayload
    ? Object.values(activityPayload.meters.providers).filter(Boolean).length
    : 0;
  const serverConsoleLabel =
    serverConsoleStatus === "connected"
      ? "Connected"
      : serverConsoleStatus === "connecting"
        ? "Connecting"
        : "Offline";
  const serverConsoleTone =
    serverConsoleStatus === "connected"
      ? "border-green-200 bg-green-50 text-green-600"
      : serverConsoleStatus === "connecting"
        ? "border-blue-200 bg-blue-50 text-blue-600"
        : "border-white/10 bg-white/[0.04] text-zinc-400";
  const activityLabel =
    activityStatus === "ready"
      ? "Live"
      : activityStatus === "loading"
        ? "Loading"
        : activityStatus === "error"
          ? "Offline"
          : "Idle";
  const activityTone =
    activityStatus === "ready"
      ? "border-green-200 bg-green-50 text-green-600"
      : activityStatus === "loading"
        ? "border-blue-200 bg-blue-50 text-blue-600"
        : activityStatus === "error"
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-white/10 bg-white/[0.04] text-zinc-400";
  const updateRuntimeSetting = <K extends keyof BrainRuntimeSettings>(
    key: K,
    value: BrainRuntimeSettings[K],
  ) =>
    setBrainRuntimeSettings({ [key]: value } as Partial<BrainRuntimeSettings>);
  const runtimeSettingsAreDefault =
    brainRuntimeSettings.activityRefreshMs ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.activityRefreshMs &&
    brainRuntimeSettings.memoryConceptLimit ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.memoryConceptLimit &&
    brainRuntimeSettings.toolIterationLimit ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.toolIterationLimit &&
    brainRuntimeSettings.webSearchPolicy ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.webSearchPolicy &&
    brainRuntimeSettings.masteryEvidencePolicy ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.masteryEvidencePolicy &&
    brainRuntimeSettings.bktTransitProbability ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.bktTransitProbability &&
    brainRuntimeSettings.bktSlipProbability ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.bktSlipProbability &&
    brainRuntimeSettings.bktGuessProbability ===
      DEFAULT_BRAIN_RUNTIME_SETTINGS.bktGuessProbability;

  const recordCorrectionRequest = async (input: {
    action: CorrectionEvent["action"];
    targetType: CorrectionEvent["targetType"];
    targetId: string;
    reason: string;
    targetSummary?: string;
    source: string;
    bookId?: string;
    conversationId?: string;
    conceptId?: string;
    relatedEventIds?: string[];
    metadata?: Record<string, unknown>;
  }) => {
    const targetId = input.targetId.trim();
    if (!targetId) {
      setCorrectionFeedback("");
      setCorrectionError("Choose a target before recording a correction.");
      return;
    }

    setCorrectionError("");
    const { record, propagation } = await recordAndApplyCorrectionEvent({
      ...input,
      targetId,
      requestedBy: "admin",
      status: "open",
    });
    setCorrectionFeedback(
      propagation.impactedRows > 0
        ? `${record.action.replace(/_/g, " ")} applied non-destructively to ${propagation.impactedRows} local row${propagation.impactedRows === 1 ? "" : "s"}; concept targets quarantine learner confidence/mastery instead of deleting data.`
        : `${record.action.replace(/_/g, " ")} recorded for ${record.targetType.replace(/_/g, " ")}; no local target row was found yet.`,
    );
  };

  const applyExistingCorrection = async (event: CorrectionEvent) => {
    setCorrectionError("");
    const propagation = await applyCorrectionPropagation(event);
    setCorrectionFeedback(
      propagation.impactedRows > 0
        ? `Applied correction overlay to ${propagation.impactedRows} local row${propagation.impactedRows === 1 ? "" : "s"}; concept targets quarantine learner confidence/mastery instead of deleting data.`
        : "No local target row was found; the request remains open.",
    );
  };

  const setCorrectionReviewStatus = async (
    event: CorrectionEvent,
    status: "blocked" | "dismissed",
  ) => {
    setCorrectionError("");
    await updateCorrectionEventReviewStatus(
      event,
      status,
      `Admin marked this correction request ${status}.`,
    );
    setCorrectionFeedback(`Correction request marked ${status}.`);
  };

  const runLocalArtifactVerifier = async (record: ArtifactRecord) => {
    setCitationVerifierError("");
    setCitationVerifierFeedback("");
    if (!supportsLocalCitationIntegrityArtifact(record)) {
      setCitationVerifierFeedback(
        `${record.title} is a ${record.artifactType.replace(/_/g, " ")} artifact. No local verifier exists for that artifact type yet, so its provenance stays not checked.`,
      );
      return;
    }
    setCitationVerifierBusyId(record.id);

    try {
      const result = await verifyArtifactCitationIntegrity(record.id);
      const states = result.results.map((entry) => entry.state);
      const verified = states.filter((state) => state === "verified").length;
      const risky = states.filter((state) => state !== "verified");
      setCitationVerifierFeedback(
        result.results.length > 0
          ? `Local check completed for ${record.title}: ${verified} verified, ${risky.length} need review. No external pages were fetched.`
          : `Local check completed for ${record.title}: no linked citation states were found.`,
      );
    } catch (error) {
      setCitationVerifierError(
        error instanceof Error ? error.message : "Local citation check failed.",
      );
    } finally {
      setCitationVerifierBusyId("");
    }
  };

  const runLocalCitationVerifier = async (state: CitationState) => {
    setCitationVerifierError("");
    setCitationVerifierFeedback("");
    let linkedArtifact = state.artifactId
      ? artifactRecordsById.get(state.artifactId)
      : undefined;
    if (!linkedArtifact && state.artifactId) {
      linkedArtifact = await db.artifactRecords.get(state.artifactId);
    }
    if (
      linkedArtifact &&
      !supportsLocalCitationIntegrityArtifact(linkedArtifact)
    ) {
      setCitationVerifierFeedback(
        `${state.title || state.sourceRef} belongs to a ${linkedArtifact.artifactType.replace(/_/g, " ")} artifact. No local verifier exists for that citation kind yet, so it stays not checked.`,
      );
      return;
    }
    setCitationVerifierBusyId(state.id);

    try {
      const result = await verifyCitationStateIntegrity(state.id);
      setCitationVerifierFeedback(
        `Local check marked citation ${result.citation.state.replace(/_/g, " ")}. No external pages were fetched.`,
      );
    } catch (error) {
      setCitationVerifierError(
        error instanceof Error ? error.message : "Local citation check failed.",
      );
    } finally {
      setCitationVerifierBusyId("");
    }
  };

  const downloadBetaDiagnostics = () => {
    const payload = buildBetaDiagnosticsExport({
      snapshot: betaDiagnosticsSnapshot,
      metadata: {
        activeLearningBookId,
        activeBetaProofAttemptId: activeBetaProofAttemptId || undefined,
        activeProject,
        aiModel,
        exportedFrom: "AdminView",
        providerKeyProof: {
          status: providerKeyProofChecklist.status,
          completionPercent: providerKeyProofChecklist.completionPercent,
          liveCoveragePercent: providerKeyProofChecklist.liveCoveragePercent,
          canAttemptProviderKeyRun:
            providerKeyProofChecklist.canAttemptProviderKeyRun,
          proofComplete: providerKeyProofChecklist.proofComplete,
          betaProofReady: providerKeyProofChecklist.betaProofReady,
          sourceReadyForBeta: providerKeyProofChecklist.sourceReadyForBeta,
          missingChecks: providerKeyProofChecklist.missingChecks,
          liveProofPreflight,
          liveProofRunbook,
          liveProofDrillPacket,
          liveProofReceipt,
          liveProofAttemptAudit,
          providerTrafficApproval: activeProviderTrafficApproval || undefined,
          activeProofAttemptId: activeBetaProofAttemptId || undefined,
        },
      },
      ledgers: {
        learningBooks,
        learningDocuments,
        learningBookConcepts,
        learningEntries,
        bookChatThreads,
        memoryEvents,
        retrievalEvents,
        correctionEvents,
        artifactRecords,
        citationStates,
        evidenceEvents: masteryIntegrityEvidenceEvents,
        masteryDeltas: masteryIntegrityDeltas,
        persistentConcepts,
        misconceptions,
        modelRuns,
        toolJobs,
        backgroundJobs,
        traceLogs: logs || [],
        systemEvents: recentSystemEvents,
      },
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = url;
    link.download = `tutor-beta-diagnostics-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDiagnosticsExportFeedback(
      `Prepared local diagnostics export with ${betaDiagnosticsSnapshot.summary.totalRows} rows.`,
    );
  };

  const submitManualCorrection = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void recordCorrectionRequest({
      action: correctionAction,
      targetType: correctionTargetType,
      targetId: correctionTargetId,
      reason: correctionReason || "Admin requested correction review.",
      source: "admin_manual_correction",
    }).then(() => {
      if (correctionTargetId.trim()) {
        setCorrectionTargetId("");
        setCorrectionReason("");
      }
    });
  };

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    gsap.killTweensOf(content);
    const contentTween = gsap.fromTo(
      content,
      { autoAlpha: 0, x: 20 },
      {
        autoAlpha: 1,
        x: 0,
        duration: motionEnabled ? 0.24 : 0,
        ease: "power3.out",
      },
    );
    const visibilityFallback = window.setTimeout(() => {
      if (Number(gsap.getProperty(content, "opacity")) === 0) {
        gsap.set(content, { autoAlpha: 1, x: 0 });
      }
    }, 450);

    const animatedItems = Array.from(
      content.querySelectorAll<HTMLElement>(".admin-animated-item"),
    );
    if (animatedItems.length) {
      gsap.fromTo(
        animatedItems,
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: motionEnabled ? 0.26 : 0,
          stagger: motionEnabled ? 0.035 : 0,
          ease: "power2.out",
        },
      );
    }

    return () => {
      window.clearTimeout(visibilityFallback);
      contentTween.kill();
    };
  }, [
    activeTab,
    artifactRecords.length,
    backgroundJobs.length,
    betaDiagnosticsSnapshot.summary.totalRows,
    citationStates.length,
    correctionEvents.length,
    evidenceEvents.length,
    learningBooks.length,
    logs?.length,
    masteryDeltas.length,
    masteryIntegrityDeltas.length,
    masteryIntegrityEvidenceEvents.length,
    memoryEvents.length,
    misconceptions.length,
    modelRuns.length,
    persistentConcepts.length,
    motionEnabled,
    recentSystemEvents.length,
    retrievalEvents.length,
    toolJobs.length,
  ]);

  return (
    <div className="w-full h-full bg-[#0A0A0B] text-zinc-100 flex flex-col overflow-x-hidden overflow-y-auto custom-scroll scroll-pt-32 pt-20 md:pt-0 relative font-serif">
      {/* Subtle Paper Texture Overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noise%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noise)%22/%3E%3C/svg%3E")',
        }}
      />

      <div className="min-h-full flex w-full min-w-0 relative z-10 pt-16 md:pt-20 shrink-0">
        {/* Sidebar Navigation */}
        <div className="sticky top-20 z-40 hidden h-[calc(100vh-80px)] min-h-[calc(100vh-80px)] w-64 flex-shrink-0 self-start overflow-y-auto border-r border-white/10 bg-[#0A0A0B]/98 px-4 py-6 font-sans shadow-[12px_0_36px_rgba(0,0,0,0.5)] backdrop-blur-xl custom-scroll lg:block">
          <button
            onClick={() => setActiveView("study")}
            className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors mb-8 px-2"
          >
            <Menu size={16} /> Back to Library
          </button>

          <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-6 px-3">
            Admin Center
          </div>

          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("learners")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 flex items-center gap-2 ${activeTab === "learners" ? "bg-blue-50 text-blue-700 font-medium shadow-sm border border-blue-100" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 border border-transparent"}`}
            >
              <BrainCircuit size={16} />
              <span className="line-clamp-1 leading-snug">Learners</span>
            </button>
            <button
              onClick={() => setActiveTab("activity")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 flex items-center gap-2 ${activeTab === "activity" ? "bg-blue-50 text-blue-700 font-medium shadow-sm border border-blue-100" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 border border-transparent"}`}
            >
              <Gauge size={16} />
              <span className="line-clamp-1 leading-snug">System Activity</span>
            </button>
            <button
              onClick={() => setActiveTab("evidence")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 flex items-center gap-2 ${activeTab === "evidence" ? "bg-blue-50 text-blue-700 font-medium shadow-sm border border-blue-100" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 border border-transparent"}`}
            >
              <BrainCircuit size={16} />
              <span className="line-clamp-1 leading-snug">Evidence Ledger</span>
            </button>
            <button
              onClick={() => setActiveTab("diagnostics")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 flex items-center gap-2 ${activeTab === "diagnostics" ? "bg-blue-50 text-blue-700 font-medium shadow-sm border border-blue-100" : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 border border-transparent"}`}
            >
              <ShieldCheck size={16} />
              <span className="line-clamp-1 leading-snug">
                Beta Diagnostics
              </span>
            </button>
            <details className="mt-5 border-t border-white/10 pt-4">
              <summary className="cursor-pointer px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Advanced debugging
              </summary>
              <div className="mt-2 flex flex-col gap-1">
                {[
                  { id: "brain", label: "Brain Overview", icon: BrainCircuit },
                  { id: "models", label: "Model Runs", icon: Cpu },
                  { id: "memory", label: "Memory Events", icon: Network },
                  {
                    id: "corrections",
                    label: "Correction Requests",
                    icon: Flag,
                  },
                  {
                    id: "artifacts",
                    label: "Source Artifacts",
                    icon: BookOpen,
                  },
                  {
                    id: "retrieval",
                    label: "Retrieval Events",
                    icon: Search,
                  },
                  {
                    id: "tuning",
                    label: "Runtime Tuning",
                    icon: SlidersHorizontal,
                  },
                  { id: "traces", label: "DeepSeek Trace", icon: Activity },
                  { id: "console", label: "Server Console", icon: Terminal },
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as AdminTab)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        activeTab === tab.id
                          ? "border-blue-100 bg-blue-50 font-medium text-blue-700"
                          : "border-transparent text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                      }`}
                    >
                      <Icon size={14} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </details>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 flex flex-col relative font-sans">
          {/* Header for mobile */}
          <div className="sticky top-16 md:top-20 left-0 right-0 z-50 bg-[#0A0A0B]/95 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between shadow-sm lg:hidden">
            <button
              onClick={() => setActiveView("study")}
              className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Menu size={16} /> Back
            </button>
            <div className="text-sm font-semibold text-zinc-200 tracking-wide truncate max-w-[200px] md:max-w-md">
              Admin Center
            </div>
            <div className="w-16"></div>
          </div>

          <div className="flex-1 p-6 md:p-12 lg:p-16 xl:p-24 relative isolate w-full">
            <div
              ref={contentRef}
              key={activeTab}
              className="relative z-10 font-serif pb-12"
            >
              {/* Admin Center Preface */}
              <div className="mb-12">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 mb-3">
                  {activeTab === "learners"
                    ? "Learner Administration"
                    : "Admin Center"}
                </h1>
                <p className="text-zinc-400 leading-relaxed max-w-2xl text-sm font-serif">
                  {activeTab === "learners"
                    ? "Select a learner, inspect their knowledge map, and follow the evidence behind each interpretation."
                    : "Inspect the few operational signals needed to explain behavior and judge local readiness."}
                </p>
              </div>

              <div className="mb-8 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#14171D] p-2 shadow-sm lg:hidden">
                {[
                  { id: "learners", label: "Learners", icon: BrainCircuit },
                  { id: "activity", label: "Activity", icon: Gauge },
                  { id: "evidence", label: "Evidence", icon: BrainCircuit },
                  { id: "diagnostics", label: "Readiness", icon: ShieldCheck },
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as AdminTab)}
                      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                        activeTab === tab.id
                          ? "bg-blue-50 text-blue-700"
                          : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                      }`}
                    >
                      <Icon size={14} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <details className="mb-8 rounded-2xl border border-white/10 bg-[#14171D] p-3 shadow-sm lg:hidden">
                <summary className="cursor-pointer px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                  Advanced debugging
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    {
                      id: "brain",
                      label: "Brain Overview",
                      icon: BrainCircuit,
                    },
                    { id: "models", label: "Model Runs", icon: Cpu },
                    { id: "memory", label: "Memory Events", icon: Network },
                    { id: "corrections", label: "Corrections", icon: Flag },
                    { id: "artifacts", label: "Artifacts", icon: BookOpen },
                    { id: "retrieval", label: "Retrieval", icon: Search },
                    { id: "tuning", label: "Tuning", icon: SlidersHorizontal },
                    { id: "traces", label: "Trace", icon: Activity },
                    { id: "console", label: "Console", icon: Terminal },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as AdminTab)}
                        className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                          activeTab === tab.id
                            ? "bg-blue-50 text-blue-700"
                            : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                        }`}
                      >
                        <Icon size={14} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </details>

              <div className="mb-10 border-b border-white/10 pb-8 pt-4 font-sans cursor-default">
                <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-zinc-400 mb-6 block font-medium">
                  <span className="text-blue-500 mr-2">#</span>
                  {activeTab === "learners"
                    ? "Learner Knowledge"
                    : activeTab === "brain"
                      ? "Learner Brain"
                      : activeTab === "activity"
                        ? "Observability"
                        : activeTab === "models"
                          ? "Model Behavior"
                          : activeTab === "memory"
                            ? "Memory Audit"
                            : activeTab === "corrections"
                              ? "Memory Control"
                              : activeTab === "artifacts"
                                ? "Source Grounding"
                                : activeTab === "diagnostics"
                                  ? "Beta Readiness"
                                  : activeTab === "retrieval"
                                    ? "Retrieval Audit"
                                    : activeTab === "evidence"
                                      ? "Learner Evidence"
                                      : activeTab === "tuning"
                                        ? "Runtime Controls"
                                        : activeTab === "traces"
                                          ? "Diagnostics"
                                          : "Runtime Environment"}
                </span>
                <div className="flex items-center justify-between">
                  <h1 className="text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight text-zinc-100 mb-2 font-serif leading-[1.15]">
                    {activeTab === "learners"
                      ? "Knowledge, evidence, and learning patterns"
                      : activeTab === "brain"
                        ? "Memory, scoring, and adaptation"
                        : activeTab === "activity"
                          ? "System Activity"
                          : activeTab === "models"
                            ? "Model Runs"
                            : activeTab === "memory"
                              ? "Memory Events"
                              : activeTab === "corrections"
                                ? "Correction Requests"
                                : activeTab === "artifacts"
                                  ? "Artifacts & Citations"
                                  : activeTab === "diagnostics"
                                    ? "Beta Diagnostics"
                                    : activeTab === "retrieval"
                                      ? "Retrieval Events"
                                      : activeTab === "evidence"
                                        ? "Evidence Ledger"
                                        : activeTab === "tuning"
                                          ? "Runtime Tuning"
                                          : activeTab === "traces"
                                            ? "DeepSeek Trace Ledger"
                                            : "Live Server Console"}
                  </h1>
                  {activeTab === "activity" && (
                    <div
                      className={`flex gap-1.5 items-center px-2 py-1 border rounded-md shadow-sm ${activityTone}`}
                    >
                      <span className="relative flex h-2 w-2">
                        {activityStatus === "ready" && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        )}
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 ${
                            activityStatus === "ready"
                              ? "bg-green-500"
                              : activityStatus === "loading"
                                ? "bg-blue-500"
                                : activityStatus === "error"
                                  ? "bg-red-500"
                                  : "bg-zinc-600"
                          }`}
                        ></span>
                      </span>
                      <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                        {activityLabel}
                      </span>
                    </div>
                  )}
                  {activeTab === "console" && (
                    <div
                      className={`flex gap-1.5 items-center px-2 py-1 border rounded-md shadow-sm ${serverConsoleTone}`}
                    >
                      <span className="relative flex h-2 w-2">
                        {serverConsoleStatus === "connected" && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        )}
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 ${
                            serverConsoleStatus === "connected"
                              ? "bg-green-500"
                              : serverConsoleStatus === "connecting"
                                ? "bg-blue-500"
                                : "bg-zinc-600"
                          }`}
                        ></span>
                      </span>
                      <span className="text-[10px] font-mono uppercase font-bold tracking-wider">
                        {serverConsoleLabel}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="prose prose-zinc w-full max-w-none prose-sm md:prose-base font-serif prose-p:leading-[1.8] prose-p:text-zinc-200 prose-p:font-light prose-p:my-5 selection:bg-blue-200 selection:text-zinc-100">
                {activeTab === "learners" ? (
                  <div
                    className="flex flex-col gap-8 font-sans"
                    data-admin-default-view="learner-overview"
                    data-testid="admin-brain-overview"
                  >
                    <section className="rounded-lg border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-3xl">
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">
                            <BrainCircuit size={13} /> How to read this page
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Start with a learner, then inspect the evidence
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-zinc-400">
                            The graph shows concepts saved in this learner's
                            books. Mastery is an evidence-linked estimate,
                            confidence describes the strength of local support,
                            and a low value is a review signal rather than a
                            grade or diagnosis.
                          </p>
                        </div>
                        <div className="flex min-w-[240px] flex-col gap-2 text-xs font-semibold text-zinc-400">
                          <label htmlFor="admin-learner-selector">
                            Learner
                          </label>
                          <select
                            id="admin-learner-selector"
                            value={selectedLearnerName}
                            onChange={(event) =>
                              setSelectedLearnerName(event.target.value)
                            }
                            data-testid="admin-learner-selector"
                            className="h-11 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-zinc-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                          >
                            {learnerNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                          <span className="truncate font-mono text-[10px] font-medium text-zinc-400">
                            active user id: {activeUserId}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        {
                          label: "Learning books",
                          value: selectedLearnerBooks.length,
                          detail: "Subjects and study threads owned locally.",
                        },
                        {
                          label: "Mapped concepts",
                          value: selectedLearnerConcepts.length,
                          detail: "Concept nodes across the learner's books.",
                        },
                        {
                          label: "Verified evidence",
                          value: selectedLearnerEvidence.filter(
                            (event) => event.verified,
                          ).length,
                          detail:
                            "Accepted learner actions, not model summaries.",
                        },
                        {
                          label: "Learning notes",
                          value: selectedLearnerEntries.length,
                          detail: "Conversation-derived revision entries.",
                        },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-lg border border-white/10 bg-[#14171D] p-4 shadow-sm"
                        >
                          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                            {metric.label}
                          </div>
                          <div className="mt-2 text-3xl font-semibold text-zinc-50">
                            {metric.value}
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-400">
                            {metric.detail}
                          </p>
                        </div>
                      ))}
                    </section>

                    <section className="rounded-lg border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Learner concept graph
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            What {selectedLearnerName} has been studying
                          </h2>
                        </div>
                        <p className="max-w-md text-xs leading-5 text-zinc-400">
                          Lines come from saved parent and child concept
                          relationships. This is learner knowledge, not the
                          Graphify source-code graph.
                        </p>
                      </div>

                      {learnerGraphNodes.length > 0 ? (
                        <div
                          className="mt-6 overflow-x-auto rounded-lg border border-white/10 bg-zinc-950"
                          role="img"
                          aria-label={`${selectedLearnerName} learner concept graph`}
                          aria-describedby="learner-concept-graph-node-list"
                        >
                          <svg
                            viewBox="0 0 850 430"
                            aria-hidden="true"
                            className="h-auto min-h-[390px] min-w-[760px] w-full"
                          >
                            <title id="learner-concept-graph-title">
                              {`${selectedLearnerName} learner concept graph`}
                            </title>
                            <desc id="learner-concept-graph-desc">
                              {learnerGraphNodes
                                .map(
                                  ({ concept }) =>
                                    `${concept.name}: mastery ${Math.round(
                                      concept.mastery * 100,
                                    )} percent, confidence ${Math.round(
                                      concept.confidence * 100,
                                    )} percent`,
                                )
                                .join("; ")}
                            </desc>
                            <defs>
                              <pattern
                                id="learner-graph-grid"
                                width="28"
                                height="28"
                                patternUnits="userSpaceOnUse"
                              >
                                <path
                                  d="M 28 0 L 0 0 0 28"
                                  fill="none"
                                  stroke="rgba(255,255,255,0.05)"
                                  strokeWidth="1"
                                />
                              </pattern>
                            </defs>
                            <rect
                              width="850"
                              height="430"
                              fill="url(#learner-graph-grid)"
                            />
                            {uniqueLearnerGraphEdges.map((edge) => (
                              <line
                                key={edge.id}
                                x1={edge.from.x}
                                y1={edge.from.y}
                                x2={edge.to.x}
                                y2={edge.to.y}
                                stroke="rgba(96,165,250,0.42)"
                                strokeWidth="2"
                              />
                            ))}
                            {learnerGraphNodes.map(({ concept, x, y }) => {
                              const signal = Math.max(
                                concept.mastery,
                                concept.confidence,
                              );
                              const fill =
                                signal >= 0.7
                                  ? "#22c55e"
                                  : signal >= 0.4
                                    ? "#3b82f6"
                                    : "#f97316";
                              const label =
                                concept.name.length > 20
                                  ? `${concept.name.slice(0, 18)}...`
                                  : concept.name;
                              return (
                                <g key={concept.id}>
                                  <circle
                                    cx={x}
                                    cy={y}
                                    r="36"
                                    fill={fill}
                                    fillOpacity="0.18"
                                    stroke={fill}
                                    strokeWidth="2"
                                  />
                                  <circle cx={x} cy={y} r="7" fill={fill} />
                                  <text
                                    x={x}
                                    y={y + 52}
                                    textAnchor="middle"
                                    fill="#f4f4f5"
                                    fontSize="12"
                                    fontWeight="600"
                                  >
                                    {label}
                                  </text>
                                  <text
                                    x={x}
                                    y={y + 68}
                                    textAnchor="middle"
                                    fill="#a1a1aa"
                                    fontSize="10"
                                  >
                                    {`M ${Math.round(concept.mastery * 100)}% · C ${Math.round(concept.confidence * 100)}%`}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                          <ul
                            id="learner-concept-graph-node-list"
                            className="sr-only"
                          >
                            {learnerGraphNodes.map(({ concept }) => (
                              <li key={concept.id}>
                                {concept.name}: mastery{" "}
                                {Math.round(concept.mastery * 100)} percent,
                                confidence{" "}
                                {Math.round(concept.confidence * 100)} percent.
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-6 rounded-lg border border-dashed border-white/15 bg-white/[0.04] px-5 py-12 text-center">
                          <BrainCircuit
                            size={24}
                            className="mx-auto text-zinc-400"
                          />
                          <p className="mt-3 text-sm font-medium text-zinc-300">
                            No concept relationships have been saved for this
                            learner yet.
                          </p>
                          <p className="mt-1 text-xs text-zinc-400">
                            Complete a tutor lesson to create the first learning
                            book and concept nodes.
                          </p>
                        </div>
                      )}
                    </section>

                    <section className="grid gap-4 lg:grid-cols-3">
                      <div className="rounded-lg border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-base font-semibold text-zinc-100">
                          Strongest current signals
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">
                          Highest combined mastery and confidence. Verify the
                          evidence before making a high-stakes decision.
                        </p>
                        <div className="mt-4 space-y-3">
                          {strongestLearnerConcepts.length > 0 ? (
                            strongestLearnerConcepts.map((concept) => (
                              <div key={concept.id}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="truncate font-medium text-zinc-200">
                                    {concept.name}
                                  </span>
                                  <span className="font-mono text-xs text-green-700">
                                    {Math.round(
                                      Math.max(
                                        concept.mastery,
                                        concept.confidence,
                                      ) * 100,
                                    )}
                                    %
                                  </span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-zinc-400">
                              Waiting for concept evidence.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-base font-semibold text-zinc-100">
                          Review opportunities
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">
                          Low signals suggest a useful follow-up question, not a
                          failure label.
                        </p>
                        <div className="mt-4 space-y-3">
                          {learnerConceptsToReview.length > 0 ? (
                            learnerConceptsToReview.map((concept) => (
                              <div key={concept.id}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="truncate font-medium text-zinc-200">
                                    {concept.name}
                                  </span>
                                  <span className="font-mono text-xs text-orange-700">
                                    {Math.round(
                                      Math.max(
                                        concept.mastery,
                                        concept.confidence,
                                      ) * 100,
                                    )}
                                    %
                                  </span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-zinc-400">
                              Waiting for concept evidence.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-base font-semibold text-zinc-100">
                          Recent learning books
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">
                          These establish the subjects and document context
                          behind the graph.
                        </p>
                        <div className="mt-4 space-y-3">
                          {selectedLearnerBooks.slice(0, 3).map((book) => (
                            <div key={book.id}>
                              <div className="text-sm font-medium text-zinc-200">
                                {book.title}
                              </div>
                              <div className="mt-0.5 text-xs text-zinc-400">
                                {book.chapters?.length || 0} chapters ·{" "}
                                {book.conversationCount} conversations
                              </div>
                            </div>
                          ))}
                          {selectedLearnerBooks.length === 0 && (
                            <p className="text-sm text-zinc-400">
                              No learning books saved yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="rounded-lg border border-blue-100 bg-blue-50/70 p-5">
                      <div className="flex items-start gap-3">
                        <ShieldCheck
                          size={18}
                          className="mt-0.5 shrink-0 text-blue-600"
                        />
                        <div>
                          <h3 className="text-sm font-semibold text-zinc-100">
                            Local identity boundary
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-zinc-400">
                            Learners are currently separated by the{" "}
                            <code>userName</code> stored on local learning
                            books. This supports local inspection, but it is not
                            secure multi-tenant isolation. Authenticated user
                            IDs and server-enforced access control remain cloud
                            work.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "brain" ? (
                  <div
                    className="flex flex-col gap-8 font-sans"
                    data-testid="admin-brain-overview"
                  >
                    <section
                      className="scroll-mt-32 rounded-lg border border-blue-100 bg-blue-50/60 p-5"
                      data-testid="admin-brain-control-room"
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600/75">
                            <BrainCircuit size={13} /> Learner Brain
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Learner-brain control room
                          </h2>
                          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400 font-serif">
                            The product goal is exactly the loop you described:
                            chat, voice, PDFs, flashcards, and evaluated answers
                            become local learner memory; validated evidence
                            updates mastery; the tutor receives that active book
                            context and adjusts how it teaches. This page shows
                            what is wired, what was recorded, and what is still
                            missing for beta proof.
                          </p>
                        </div>
                        <div className="shrink-0 rounded-lg border border-blue-100 bg-[#14171D] px-5 py-4 text-left">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Local beta proof
                          </div>
                          <div className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                            {
                              betaDiagnosticsSnapshot.brainArchitectureReadiness
                                .localBetaPercent
                            }
                            %
                          </div>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(betaDiagnosticsSnapshot.brainArchitectureReadiness.status)}`}
                          >
                            {betaDiagnosticsSnapshot.brainArchitectureReadiness.stage.replace(
                              /_/g,
                              " ",
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {[
                          {
                            label: "Stored memory",
                            value: memoryEventCount,
                            detail: `${bookChatThreadCount} book threads, ${learningBooks.length} books`,
                          },
                          {
                            label: "Study context",
                            value: readyLearningDocuments.length,
                            detail: `${learningDocuments.length} PDFs stored, ${retrievalEventCount} retrieval rows`,
                          },
                          {
                            label: "Validated scoring",
                            value: verifiedEvidenceCount,
                            detail: `${masteryDeltaCount} mastery deltas, ${activeMisconceptions.length} open misconceptions`,
                          },
                          {
                            label: "Adaptive model",
                            value: "Selector",
                            detail: `${learnerAlgorithmLedgerRows.length} local decision${learnerAlgorithmLedgerRows.length === 1 ? "" : "s"} across ${learnerAlgorithmIds.length} algorithm paths`,
                          },
                        ].map((item) => (
                          <article
                            key={item.label}
                            className="rounded-lg border border-white/80 bg-[#14171D]/90 p-4"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {item.label}
                            </div>
                            <div className="mt-2 truncate text-2xl font-semibold tabular-nums text-zinc-100">
                              {item.value}
                            </div>
                            <p className="mt-2 text-xs leading-relaxed text-zinc-400 font-serif">
                              {item.detail}
                            </p>
                          </article>
                        ))}
                      </div>

                      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {brainLoopSteps.map((step, index) => (
                          <article
                            key={step.label}
                            className="rounded-lg border border-blue-100 bg-[#14171D] p-4"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                                {step.label}
                              </div>
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-[10px] font-bold tabular-nums text-blue-700">
                                {index + 1}
                              </span>
                            </div>
                            <h3 className="mt-3 text-sm font-semibold leading-snug text-zinc-100">
                              {step.title}
                            </h3>
                            <p className="mt-2 text-xs leading-relaxed text-zinc-400 font-serif">
                              {step.detail}
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                      <article className="rounded-lg border border-white/10 bg-[#14171D] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                          <BookOpen size={13} /> Active Learning Context
                        </div>
                        <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                          {activeLearningBook?.title ||
                            activeProject ||
                            "General Study"}
                        </h3>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {[
                            ["Book id", activeLearningBookId || "not selected"],
                            ["Ready PDFs", activeBookReadyDocuments.length],
                            ["Mapped concepts", activeBookConceptCount],
                            [
                              "Saved thread",
                              activeBookThreadSummary
                                ? `${activeBookThreadSummary.meaningfulMessageCount} messages`
                                : "not started",
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                            >
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                {label}
                              </div>
                              <div className="mt-1 truncate text-sm font-semibold text-zinc-100">
                                {value}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-zinc-400 font-serif">
                          {activeBookReadyDocuments.length > 0
                            ? `The active book has ${activeBookReadyDocuments.length} ready PDF context source${activeBookReadyDocuments.length === 1 ? "" : "s"} available for tutor injection.`
                            : "The active book does not yet have a ready PDF source for tutor injection."}
                        </div>
                      </article>

                      <article className="rounded-lg border border-white/10 bg-[#14171D] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                          <SlidersHorizontal size={13} /> Learning Algorithm
                        </div>
                        <h3
                          className="mt-2 text-xl font-serif font-medium text-zinc-100"
                          data-testid="admin-learner-algorithm-selector"
                        >
                          Automatic local selector is active
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-400 font-serif">
                          Validated attempts can choose conservative evidence
                          thresholding, Bayesian Knowledge Tracing, or
                          decay-sensitive BKT. AKT-style neural tracing and
                          remote learner-model competition are still future
                          work, so Admin only claims the local selector that the
                          runtime records today.
                        </p>
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          {[
                            [
                              "Evidence",
                              brainRuntimeSettings.masteryEvidencePolicy.replace(
                                /_/g,
                                " ",
                              ),
                            ],
                            [
                              "Selector rows",
                              learnerAlgorithmLedgerRows.length,
                            ],
                            [
                              "Active paths",
                              `${activeLearnerAlgorithmCount}/${learnerAlgorithmIds.length}`,
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                            >
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                {label}
                              </div>
                              <div className="mt-1 truncate text-sm font-semibold text-zinc-100">
                                {value}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          {learnerAlgorithmCounts.map((entry) => (
                            <div
                              key={entry.algorithm}
                              className={`rounded-lg border p-3 ${
                                entry.count > 0
                                  ? "border-green-200 bg-green-50"
                                  : "border-white/10 bg-white/[0.04]"
                              }`}
                            >
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                {entry.shortLabel}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-zinc-100">
                                {entry.count} decision
                                {entry.count === 1 ? "" : "s"}
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                {entry.label}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Recent selector choices
                          </div>
                          {recentLearnerAlgorithmRows.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {recentLearnerAlgorithmRows.map((row) => (
                                <div
                                  key={`${row.source}-${row.id}`}
                                  className="rounded-md border border-white bg-[#14171D] px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-zinc-100">
                                      {row.label}
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                        row.verified
                                          ? "border-green-200 bg-green-50 text-green-700"
                                          : "border-orange-200 bg-orange-50 text-orange-700"
                                      }`}
                                    >
                                      {row.verified ? "verified" : "watch"}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                    {row.source} | {row.evidenceType} |{" "}
                                    {row.conceptId}
                                    {row.confidence !== null
                                      ? ` | ${row.confidence}% confidence`
                                      : ""}
                                  </p>
                                  {row.reason && (
                                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                      {row.reason}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm leading-relaxed text-zinc-400 font-serif">
                              No selector rows have been recorded yet. The next
                              validated recall, generated answer, or transfer
                              attempt will write the selected local algorithm
                              into evidence and mastery metadata.
                            </p>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveTab("tuning")}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                          >
                            <SlidersHorizontal size={13} />
                            Open tuning
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("evidence")}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06]"
                          >
                            <BrainCircuit size={13} />
                            Open evidence
                          </button>
                        </div>
                      </article>
                    </section>

                    <section className="rounded-lg border border-white/10 bg-[#14171D] p-5">
                      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <ShieldCheck size={13} /> Brain Readiness
                          </div>
                          <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                            What is proven right now
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("diagnostics")}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06]"
                        >
                          <ShieldCheck size={13} />
                          Open proof details
                        </button>
                      </div>

                      <div
                        className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4"
                        data-testid="admin-brain-proof-path"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                              Beta proof path
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Typed chat - book memory - retrieval - evidence -
                              live voice
                            </h4>
                            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-400 font-serif">
                              A pass means the learner brain can prove one typed
                              chat and one live voice run shared the same active
                              book, local thread, multi-PDF context,
                              provider-backed rows, and scored evidence.
                            </p>
                          </div>
                          <div className="shrink-0 rounded-lg border border-blue-100 bg-[#14171D] px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Coherent proof
                            </div>
                            <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                              {
                                betaDiagnosticsSnapshot.coherentLiveProof
                                  .completionPercent
                              }
                              %
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(betaDiagnosticsSnapshot.coherentLiveProof.status)}`}
                            >
                              {betaDiagnosticsSnapshot.coherentLiveProof.status}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                          {proofSpotlightChecks.map((check) => (
                            <article
                              key={check.id}
                              className="rounded-lg border border-white bg-[#14171D]/90 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                  {check.title}
                                </div>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(check.status)}`}
                                >
                                  {check.ready ? "ready" : check.status}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                {check.summary}
                              </p>
                            </article>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-3">
                        {[
                          {
                            title: "Brain-flow ledger",
                            status: betaDiagnosticsSnapshot.brainFlow.status,
                            detail: `${betaDiagnosticsSnapshot.brainFlow.coveragePercent}% coverage across chat, voice, retrieval, tools, memory, and evidence.`,
                          },
                          {
                            title: "Provider proof",
                            status:
                              betaDiagnosticsSnapshot.coherentLiveProof.status,
                            detail: betaDiagnosticsSnapshot.coherentLiveProof
                              .ready
                              ? "OpenRouter chat and Deepgram voice share one local proof bundle."
                              : "A shared typed-chat and voice provider bundle is still needed.",
                          },
                          {
                            title: "Mastery integrity",
                            status: masteryIntegrity.status,
                            detail: masteryIntegrity.ready
                              ? "Validated evidence rows and mastery deltas are linked."
                              : "Some mastery evidence links need review.",
                          },
                        ].map((item) => (
                          <article
                            key={item.title}
                            className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                {item.title}
                              </div>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(item.status)}`}
                              >
                                {item.status}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-zinc-400 font-serif">
                              {item.detail}
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {[
                        {
                          label: "Memory",
                          tab: "memory" as AdminTab,
                          detail: "Stored chat, voice, and learner updates.",
                          icon: Network,
                        },
                        {
                          label: "Evidence",
                          tab: "evidence" as AdminTab,
                          detail: "Validated answers, flashcards, and mastery.",
                          icon: BrainCircuit,
                        },
                        {
                          label: "Retrieval",
                          tab: "retrieval" as AdminTab,
                          detail: "What gets injected into tutor context.",
                          icon: Search,
                        },
                        {
                          label: "Models",
                          tab: "models" as AdminTab,
                          detail: "Provider calls and tutor outputs.",
                          icon: Cpu,
                        },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => setActiveTab(item.tab)}
                            className="min-w-0 rounded-lg border border-white/10 bg-[#14171D] p-4 text-left transition-colors hover:bg-white/[0.06]"
                          >
                            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-500/70">
                              <Icon size={13} /> {item.label}
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-zinc-400 font-serif">
                              {item.detail}
                            </p>
                          </button>
                        );
                      })}
                    </section>
                  </div>
                ) : activeTab === "activity" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="min-w-0 rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <Gauge size={13} /> Local Observability
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Behind-the-scenes activity
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Required local logs for model calls, tool jobs,
                            background jobs, retrieval, voice, memory writes,
                            and errors. Deeper ledgers stay in their focused
                            tabs; Graphify still maps code, not the learner
                            brain.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActivityRefreshKey((key) => key + 1);
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:bg-[#1b1f27] hover:text-zinc-100"
                        >
                          <RefreshCw size={13} />
                          Auto-refresh{" "}
                          {Math.round(
                            brainRuntimeSettings.activityRefreshMs / 1000,
                          )}
                          s
                        </button>
                      </div>

                      {activityStatus === "error" ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                          {activityError ||
                            "System activity is unavailable. Start the Tutor backend and reopen Admin."}
                        </div>
                      ) : null}

                      <div className="grid min-w-0 gap-3 md:grid-cols-4">
                        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Activity Events
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {systemSummary?.total || 0}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-zinc-400">
                            limit {systemSummary?.retentionLimit || 250}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Current Model
                          </div>
                          <div className="mt-2 truncate text-sm font-semibold text-zinc-100">
                            {aiModel}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-zinc-400">
                            {chatUsage.requests} chat requests
                          </div>
                        </div>
                        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Local Memory
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {learningEntries.length +
                              memoryEventCount +
                              backgroundJobCount +
                              artifactRecordCount +
                              citationStateCount +
                              retrievalEventCount +
                              traceCount}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-zinc-400">
                            entries + memory + jobs + sources + traces
                          </div>
                        </div>
                        <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Providers Ready
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {localProviderCount}
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-zinc-400">
                            local config meters
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                            <BrainCircuit size={13} /> Learner-brain logic
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono text-blue-800">
                            <span className="rounded-full border border-blue-200 bg-[#14171D]/80 px-2 py-0.5">
                              evidence{" "}
                              {brainRuntimeSettings.masteryEvidencePolicy.replace(
                                /_/g,
                                " ",
                              )}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-[#14171D]/80 px-2 py-0.5">
                              transit{" "}
                              {brainRuntimeSettings.bktTransitProbability.toFixed(
                                2,
                              )}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-[#14171D]/80 px-2 py-0.5">
                              slip{" "}
                              {brainRuntimeSettings.bktSlipProbability.toFixed(
                                2,
                              )}
                            </span>
                            <span className="rounded-full border border-blue-200 bg-[#14171D]/80 px-2 py-0.5">
                              guess{" "}
                              {brainRuntimeSettings.bktGuessProbability.toFixed(
                                2,
                              )}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab("tuning")}
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200 bg-[#14171D] px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                        >
                          <SlidersHorizontal size={13} />
                          Tune brain logic
                        </button>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Request timelines
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400 font-serif">
                            Shows only the newest request groups for quick
                            triage. Focused tabs keep the full local ledgers
                            available when a turn needs deeper inspection.
                          </p>
                        </div>
                        <div className="w-fit max-w-full rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                          {requestTimelines.length} recent
                        </div>
                      </div>

                      {requestTimelines.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-6 text-center text-sm text-zinc-400">
                          No request ids have been observed yet. A chat request
                          or blocked model call will create a local timeline.
                        </div>
                      ) : (
                        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                          {requestTimelines.map((timeline, index) => (
                            <article
                              key={timeline.requestId}
                              className={`min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 8 ? "admin-animated-item" : ""}`}
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                      {timeline.title}
                                    </h4>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(timeline.status)}`}
                                    >
                                      {timeline.status}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                    <span className="max-w-[12rem] truncate">
                                      {timeline.requestId}
                                    </span>
                                    {timeline.model && (
                                      <span className="max-w-[12rem] truncate">
                                        model {timeline.model}
                                      </span>
                                    )}
                                    {timeline.durationMs !== undefined && (
                                      <span>{timeline.durationMs}ms</span>
                                    )}
                                  </div>
                                </div>
                                <div className="grid min-w-0 grid-cols-2 gap-2 text-center text-[10px] font-mono text-zinc-400 sm:grid-cols-6">
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.events.length} events
                                  </span>
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.memoryEvents.length} memory
                                  </span>
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.retrievalEvents.length} retrievals
                                  </span>
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.modelRuns.length} models
                                  </span>
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.toolJobs.length} tools
                                  </span>
                                  <span className="min-w-0 rounded-xl border border-white/10 bg-[#14171D] px-2 py-1">
                                    {timeline.backgroundJobs.length} jobs
                                  </span>
                                </div>
                              </div>

                              <details className="group mt-3">
                                <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                  <ChevronRight
                                    size={14}
                                    className="transition-transform group-open:rotate-90"
                                  />
                                  Ordered request evidence
                                </summary>
                                <div className="mt-3 space-y-2">
                                  {timeline.events.map((event) => (
                                    <div
                                      key={event.id}
                                      className="rounded-xl border border-white/10 bg-[#14171D] px-3 py-2"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-300">
                                        <span className="truncate">
                                          {event.title}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[9px] uppercase ${statusTone(event.status)}`}
                                        >
                                          {event.status}
                                        </span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>
                                          {formatTime(event.timestamp)}
                                        </span>
                                        <span>{event.kind}</span>
                                        {event.phase && (
                                          <span>phase {event.phase}</span>
                                        )}
                                        {event.toolName && (
                                          <span>tool {event.toolName}</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {timeline.memoryEvents.map((event) => {
                                    const contextDocumentIds =
                                      stringListMetadataValue(
                                        event.metadata,
                                        "contextDocumentIds",
                                      );
                                    const documentCount = numberMetadataValue(
                                      event.metadata,
                                      "documentCount",
                                    );
                                    const readyDocumentCount =
                                      numberMetadataValue(
                                        event.metadata,
                                        "readyDocumentCount",
                                      );
                                    const unreadyDocumentCount =
                                      numberMetadataValue(
                                        event.metadata,
                                        "unreadyDocumentCount",
                                      );
                                    const omittedReadyDocumentCount =
                                      numberMetadataValue(
                                        event.metadata,
                                        "omittedReadyDocumentCount",
                                      );
                                    const requestIds = stringListMetadataValue(
                                      event.metadata,
                                      "requestIds",
                                    );
                                    const transcriptMode = stringMetadataValue(
                                      event.metadata,
                                      "mode",
                                    );
                                    const meaningfulMessageCount =
                                      numberMetadataValue(
                                        event.metadata,
                                        "meaningfulMessageCount",
                                      );
                                    const voiceTurnCount = numberMetadataValue(
                                      event.metadata,
                                      "voiceTurnCount",
                                    );
                                    const evidenceContract =
                                      stringMetadataValue(
                                        event.metadata,
                                        "evidenceContract",
                                      );
                                    const evidenceRole = stringMetadataValue(
                                      event.metadata,
                                      "evidenceRole",
                                    );
                                    const evidenceVerified =
                                      booleanMetadataValue(
                                        event.metadata,
                                        "evidenceVerified",
                                      );
                                    const masteryMutationAllowed =
                                      booleanMetadataValue(
                                        event.metadata,
                                        "masteryMutationAllowed",
                                      );
                                    const confidenceMutationAllowed =
                                      booleanMetadataValue(
                                        event.metadata,
                                        "confidenceMutationAllowed",
                                      );
                                    const showEvidenceGate =
                                      Boolean(
                                        evidenceContract || evidenceRole,
                                      ) ||
                                      evidenceVerified !== undefined ||
                                      masteryMutationAllowed !== undefined ||
                                      confidenceMutationAllowed !== undefined;
                                    return (
                                      <div
                                        key={event.id}
                                        className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800"
                                      >
                                        Memory {event.status}: {event.eventType}
                                        <div className="mt-1 text-[10px] font-mono text-amber-700/80">
                                          {event.metadata?.agentLayer
                                            ? `agent ${String(event.metadata.agentLayer)}`
                                            : event.source}
                                          {event.metadata?.rawContextChars
                                            ? ` - raw ${String(event.metadata.rawContextChars)} chars`
                                            : ""}
                                        </div>
                                        {event.eventType ===
                                          "brain_context_injected" &&
                                          documentCount > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-amber-700">
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                PDFs {documentCount}
                                              </span>
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                ready {readyDocumentCount}
                                              </span>
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                excerpted{" "}
                                                {contextDocumentIds.length}
                                              </span>
                                              {unreadyDocumentCount > 0 && (
                                                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">
                                                  pending or failed{" "}
                                                  {unreadyDocumentCount}
                                                </span>
                                              )}
                                              {omittedReadyDocumentCount >
                                                0 && (
                                                <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700">
                                                  omitted ready{" "}
                                                  {omittedReadyDocumentCount}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        {event.eventType ===
                                          "book_chat_thread_saved" && (
                                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-amber-700">
                                            {transcriptMode && (
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                {transcriptMode} transcript
                                              </span>
                                            )}
                                            <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                              {meaningfulMessageCount} messages
                                            </span>
                                            {voiceTurnCount > 0 && (
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                {voiceTurnCount} voice turns
                                              </span>
                                            )}
                                            {requestIds.length > 0 && (
                                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                {requestIds.length} request id
                                                {requestIds.length === 1
                                                  ? ""
                                                  : "s"}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {showEvidenceGate && (
                                          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-amber-700">
                                            {evidenceContract && (
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                {evidenceContract}
                                              </span>
                                            )}
                                            {evidenceRole && (
                                              <span className="rounded-full border border-amber-200 bg-[#14171D]/70 px-2 py-0.5">
                                                {evidenceRole.replace(
                                                  /_/g,
                                                  " ",
                                                )}
                                              </span>
                                            )}
                                            {evidenceVerified !== undefined && (
                                              <span
                                                className={`rounded-full border px-2 py-0.5 ${
                                                  evidenceVerified
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-orange-200 bg-orange-50 text-orange-700"
                                                }`}
                                              >
                                                {evidenceVerified
                                                  ? "verified evidence"
                                                  : "audit-only observation"}
                                              </span>
                                            )}
                                            {masteryMutationAllowed !==
                                              undefined && (
                                              <span
                                                className={`rounded-full border px-2 py-0.5 ${
                                                  masteryMutationAllowed
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-white/15 bg-[#14171D]/80 text-zinc-400"
                                                }`}
                                              >
                                                mastery{" "}
                                                {masteryMutationAllowed
                                                  ? "allowed"
                                                  : "blocked"}
                                              </span>
                                            )}
                                            {confidenceMutationAllowed !==
                                              undefined && (
                                              <span
                                                className={`rounded-full border px-2 py-0.5 ${
                                                  confidenceMutationAllowed
                                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                    : "border-white/15 bg-[#14171D]/80 text-zinc-400"
                                                }`}
                                              >
                                                confidence{" "}
                                                {confidenceMutationAllowed
                                                  ? "allowed"
                                                  : "blocked"}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {timeline.retrievalEvents.map((event) => (
                                    <div
                                      key={event.id}
                                      className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800"
                                    >
                                      Retrieval {event.status}:{" "}
                                      {event.contextChars.toLocaleString()}{" "}
                                      context chars
                                      <div className="mt-1 text-[10px] font-mono text-emerald-700/80">
                                        {event.selectedConceptIds.length}{" "}
                                        concepts -{" "}
                                        {event.selectedInteractionIds.length}{" "}
                                        interactions
                                      </div>
                                    </div>
                                  ))}
                                  {timeline.modelRuns.map((run) => (
                                    <div
                                      key={run.id}
                                      className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-800"
                                    >
                                      Model {run.status}:{" "}
                                      {run.usedModel || run.requestedModel}
                                    </div>
                                  ))}
                                  {timeline.toolJobs.map((job) => (
                                    <div
                                      key={job.id}
                                      className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-800"
                                    >
                                      Tool {job.status}: {job.toolName}
                                    </div>
                                  ))}
                                  {timeline.backgroundJobs.map((job) => (
                                    <div
                                      key={job.id}
                                      className="rounded-xl border border-cyan-100 bg-cyan-50/70 px-3 py-2 text-[11px] text-cyan-800"
                                    >
                                      Background {job.status.replace(/_/g, " ")}
                                      : {job.jobName}
                                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-cyan-700/80">
                                        <span>
                                          attempt {job.attempt}/
                                          {job.maxAttempts}
                                        </span>
                                        {job.error && (
                                          <span className="max-w-[18rem] truncate text-red-700">
                                            {job.error}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Event stream
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Newest {MAIN_ACTIVITY_EVENT_LIMIT} required
                              events, redacted server-side and retained in
                              memory for this local backend process.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(systemSummary?.latestEventAt)}
                          </div>
                        </div>

                        {activityStatus === "loading" && !activityPayload ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            Loading system activity...
                          </div>
                        ) : recentSystemEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No activity events yet. Start a chat, trigger a
                            tool, or generate learning-book notes to fill the
                            ledger.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {recentSystemEvents.map((event, index) => {
                              const Icon = kindIcon(event.kind);
                              return (
                                <article
                                  key={event.id}
                                  className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                                >
                                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div className="flex min-w-0 gap-3">
                                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                        <Icon size={17} />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <h4 className="m-0 text-sm font-semibold text-zinc-100">
                                            {event.title}
                                          </h4>
                                          <span
                                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(event.status)}`}
                                          >
                                            {event.status}
                                          </span>
                                        </div>
                                        {event.detail && (
                                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400 font-serif">
                                            {event.detail}
                                          </p>
                                        )}
                                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                          <span>{event.kind}</span>
                                          {event.phase && (
                                            <span>phase {event.phase}</span>
                                          )}
                                          {event.toolName && (
                                            <span>tool {event.toolName}</span>
                                          )}
                                          {event.model && (
                                            <span className="max-w-[220px] truncate">
                                              model {event.model}
                                            </span>
                                          )}
                                          {event.durationMs !== undefined && (
                                            <span>{event.durationMs}ms</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                      <div>{formatTime(event.timestamp)}</div>
                                      {event.requestId && (
                                        <div className="mt-1 max-w-[140px] truncate">
                                          {event.requestId}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {event.metadata && (
                                    <details className="group mt-3">
                                      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                        <ChevronRight
                                          size={14}
                                          className="transition-transform group-open:rotate-90"
                                        />
                                        Metadata
                                      </summary>
                                      <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                        {JSON.stringify(
                                          event.metadata,
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </details>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-col gap-4">
                        <section className="min-w-0 rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Meters
                          </h3>
                          <div className="mt-4 grid gap-3">
                            {[
                              ["Tokens", totalChatTokens.toLocaleString()],
                              [
                                "Estimated cost",
                                `$${totalEstimatedCost.toFixed(4)}`,
                              ],
                              ["Web searches", webUsage.requests],
                              ["Web events", webSearchEvents.length],
                              ["Voice sessions", voiceUsage.sessions],
                              ["Voice events", voiceAgentEvents.length],
                              ["Books", learningBooks.length],
                              ["Mapped concepts", mappedConceptCount],
                              ["Evidence events", evidenceEventCount],
                              ["Mastery deltas", masteryDeltaCount],
                              ["Tool jobs", toolJobCount],
                              ["Background jobs", backgroundJobCount],
                              ["Model runs", modelRunCount],
                              ["Request timelines", requestTimelines.length],
                              ["Memory events", memoryEventCount],
                              ["Source artifacts", artifactRecordCount],
                              ["Citation states", citationStateCount],
                              ["Retrieval events", retrievalEventCount],
                              ["Active book", activeLearningBookId || "none"],
                              ["Project", activeProject],
                              [
                                "Pricing",
                                pricing.stale ? "fallback/stale" : "live",
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="grid min-w-0 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-3"
                              >
                                <span className="min-w-0 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 break-words text-xs font-semibold text-zinc-100 sm:text-right">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="min-w-0 rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500/70">
                                <Activity size={12} /> Voice agent
                              </div>
                              <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                                Live voice timeline
                              </h3>
                              <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                                Local session events from the ChatPanel voice
                                websocket, Deepgram settings handshake, barge-in
                                handling, and transcript turns.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={clearVoiceAgentEvents}
                              disabled={voiceAgentEvents.length === 0}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-[#1b1f27] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <RotateCcw size={12} /> Clear
                            </button>
                          </div>

                          <div className="mt-4 grid gap-2">
                            {[
                              [
                                "Latest",
                                latestVoiceAgentEvent
                                  ? latestVoiceAgentEvent.summary
                                  : "waiting for voice activity",
                              ],
                              ["Voice model", voiceUsage.voiceAgentModel],
                              [
                                "Listen/Speak",
                                `${voiceUsage.listenModel} / ${voiceUsage.speakModel}`,
                              ],
                              [
                                "Audio seconds",
                                `${Math.round(voiceUsage.inputAudioSeconds)} in / ${Math.round(voiceUsage.outputAudioSeconds)} out`,
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>

                          <div className="mt-4 space-y-2">
                            {voiceAgentEvents.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-4 text-sm leading-relaxed text-zinc-400 font-serif">
                                Start a voice chat to see the local
                                orchestration trace here. Nothing is sent to a
                                cloud dashboard.
                              </div>
                            ) : (
                              voiceAgentEvents.slice(0, 8).map((event) => (
                                <article
                                  key={event.id}
                                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                          {event.type.replace(/_/g, " ")}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(event.status)}`}
                                        >
                                          {event.status}
                                        </span>
                                      </div>
                                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-300 font-serif">
                                        {event.summary}
                                      </p>
                                    </div>
                                    <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                                      {formatTime(event.timestamp)}
                                    </span>
                                  </div>
                                  {event.metadata && (
                                    <details className="mt-2">
                                      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                                        Metadata
                                      </summary>
                                      <pre className="mt-2 max-h-32 overflow-auto rounded-xl border border-white/10 bg-[#14171D] p-2 text-[10px] text-zinc-400">
                                        {JSON.stringify(
                                          event.metadata,
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </details>
                                  )}
                                </article>
                              ))
                            )}
                          </div>
                        </section>

                        <section className="min-w-0 rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Event mix
                          </h3>
                          <div className="mt-4 space-y-4">
                            <div>
                              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                By kind
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(
                                  systemSummary?.byKind || {},
                                ).map(([kind, count]) => (
                                  <span
                                    key={kind}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                                  >
                                    {kind}: {count}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                By status
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(
                                  systemSummary?.byStatus || {},
                                ).map(([status, count]) => (
                                  <span
                                    key={status}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}
                                  >
                                    {status}: {count}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Tuning snapshot
                          </h3>
                          <div className="mt-4 space-y-2 text-xs text-zinc-400">
                            {activityPayload ? (
                              Object.entries(activityPayload.meters.tuning).map(
                                ([label, value]) => (
                                  <div
                                    key={label}
                                    className="grid min-w-0 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-3"
                                  >
                                    <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                                      {label}
                                    </span>
                                    <span className="min-w-0 break-words font-semibold text-zinc-100 sm:text-right">
                                      {value}
                                    </span>
                                  </div>
                                ),
                              )
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-4 text-center text-zinc-400">
                                Waiting for backend meters.
                              </div>
                            )}
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "models" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <Cpu size={13} /> Durable Model Behavior
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Chat model run ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Local records for chat model starts, fallbacks,
                            completions, blocked requests, and failures. These
                            rows make provider behavior auditable without
                            touching cloud deployment or the learner concept
                            graph.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {modelRunCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Durable runs
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          ["Recent completed", completedModelRuns],
                          ["Blocked or failed", blockedOrFailedModelRuns],
                          ["Fallbacks", fallbackModelRuns],
                          [
                            "Latest",
                            latestModelRun?.usedModel ||
                              latestModelRun?.requestedModel ||
                              "none",
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Recent runs
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400 font-serif">
                            Newest first. Runtime settings are captured per
                            request so tuning decisions can be compared against
                            model behavior.
                          </p>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                          {formatTime(latestModelRun?.timestamp)}
                        </div>
                      </div>

                      {modelRuns.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                          No durable model runs yet. Send a chat request and the
                          stream will persist local model-run rows here,
                          including blocked API-key checks.
                        </div>
                      ) : (
                        <div className="grid gap-3 xl:grid-cols-2">
                          {modelRuns.map((run, index) => (
                            <article
                              key={run.id}
                              className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                      {run.usedModel ||
                                        run.requestedModel ||
                                        "unknown model"}
                                    </h4>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(run.status)}`}
                                    >
                                      {run.status}
                                    </span>
                                  </div>
                                  {run.requestedModel &&
                                    run.usedModel &&
                                    run.requestedModel !== run.usedModel && (
                                      <p className="mt-1 text-sm leading-relaxed text-orange-700 font-serif">
                                        Requested {run.requestedModel}; used{" "}
                                        {run.usedModel}.
                                      </p>
                                    )}
                                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400 font-serif">
                                    {run.error ||
                                      `${run.outputTokens || 0} output tokens, ${run.inputTokens || 0} input tokens${run.cost !== undefined ? `, $${run.cost.toFixed(6)}` : ""}.`}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                    {run.requestId && (
                                      <span className="max-w-[9rem] truncate">
                                        {run.requestId}
                                      </span>
                                    )}
                                    <span>{run.provider}</span>
                                    {run.durationMs !== undefined && (
                                      <span>{run.durationMs}ms</span>
                                    )}
                                    {run.iterations !== undefined && (
                                      <span>{run.iterations} loops</span>
                                    )}
                                    {run.webSources !== undefined && (
                                      <span>{run.webSources} sources</span>
                                    )}
                                    {run.estimated && <span>estimated</span>}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                  {formatTime(run.timestamp)}
                                </div>
                              </div>

                              {(run.runtimeSettings || run.metadata) && (
                                <details className="group mt-3">
                                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                    <ChevronRight
                                      size={14}
                                      className="transition-transform group-open:rotate-90"
                                    />
                                    Runtime and metadata
                                  </summary>
                                  <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                    {JSON.stringify(
                                      {
                                        runtimeSettings: run.runtimeSettings,
                                        memoryContextChars:
                                          run.memoryContextChars,
                                        sourceMaterialRequest:
                                          run.sourceMaterialRequest,
                                        requestedWebSearch:
                                          run.requestedWebSearch,
                                        graphUpdates: run.graphUpdates,
                                        flashcards: run.flashcards,
                                        metadata: run.metadata,
                                      },
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </details>
                              )}
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                ) : activeTab === "memory" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <Network size={13} /> Durable Memory Activity
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Learner memory event ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Append-only local records for memory sessions, saved
                            chat interactions, learning-book updates, concept
                            writes, and graph memory changes. This is the
                            user-brain runtime audit trail, separate from
                            Graphify's code architecture graph.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {memoryEventCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Durable events
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          ["Completed", completedMemoryEvents],
                          ["Failed", failedMemoryEvents],
                          ["Book updates", learningBookMemoryEvents],
                          ["Concept writes", conceptMemoryEvents],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Recent memory writes
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Newest first. Rows are written from local memory
                              code paths so failures are visible without
                              blocking the learner flow.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestMemoryEvent?.timestamp)}
                          </div>
                        </div>

                        {memoryEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No durable memory events yet. Opening Tutor starts a
                            local memory session; completed chats will add
                            interaction and learning-book rows.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {memoryEvents.map((event, index) => (
                              <article
                                key={event.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="flex min-w-0 gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                      <Network size={17} />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                          {event.eventType.replace(/_/g, " ")}
                                        </h4>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(event.status)}`}
                                        >
                                          {event.status}
                                        </span>
                                      </div>
                                      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-zinc-400 font-serif">
                                        {event.summary}
                                      </p>
                                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>{event.source}</span>
                                        {event.bookId && (
                                          <span className="max-w-[10rem] truncate">
                                            book {event.bookId}
                                          </span>
                                        )}
                                        {event.conceptId && (
                                          <span className="max-w-[10rem] truncate">
                                            concept {event.conceptId}
                                          </span>
                                        )}
                                        {event.conversationId && (
                                          <span className="max-w-[10rem] truncate">
                                            convo {event.conversationId}
                                          </span>
                                        )}
                                        {event.confidence !== undefined && (
                                          <span>
                                            confidence{" "}
                                            {(event.confidence * 100).toFixed(
                                              0,
                                            )}
                                            %
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    <div>{formatTime(event.timestamp)}</div>
                                    {event.retentionPolicy && (
                                      <div className="mt-1">
                                        {event.retentionPolicy}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void recordCorrectionRequest({
                                        action: "mark_wrong",
                                        targetType: "memory_event",
                                        targetId: event.id,
                                        targetSummary: event.summary,
                                        reason:
                                          "Admin marked this memory event as wrong for review.",
                                        source: "admin_memory_events",
                                        bookId: event.bookId,
                                        conversationId: event.conversationId,
                                        conceptId: event.conceptId,
                                        relatedEventIds: [event.id],
                                        metadata: {
                                          eventType: event.eventType,
                                          eventStatus: event.status,
                                        },
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-100"
                                  >
                                    <Flag size={12} />
                                    Mark wrong
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void recordCorrectionRequest({
                                        action: "delete_request",
                                        targetType: "memory_event",
                                        targetId: event.id,
                                        targetSummary: event.summary,
                                        reason:
                                          "Admin requested deletion review for this memory event.",
                                        source: "admin_memory_events",
                                        bookId: event.bookId,
                                        conversationId: event.conversationId,
                                        conceptId: event.conceptId,
                                        relatedEventIds: [event.id],
                                        metadata: {
                                          eventType: event.eventType,
                                          eventStatus: event.status,
                                        },
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                                  >
                                    <Trash2 size={12} />
                                    Request deletion
                                  </button>
                                </div>
                                {(event.sourceIds?.length ||
                                  event.metadata) && (
                                  <details className="group mt-3">
                                    <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                      <ChevronRight
                                        size={14}
                                        className="transition-transform group-open:rotate-90"
                                      />
                                      Source ids and metadata
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                      {JSON.stringify(
                                        {
                                          sourceIds: event.sourceIds,
                                          metadata: event.metadata,
                                        },
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </details>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Event mix
                          </h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.keys(memoryEventsByType).length === 0 ? (
                              <span className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                                Waiting for memory writes.
                              </span>
                            ) : (
                              Object.entries(memoryEventsByType).map(
                                ([type, count]) => (
                                  <span
                                    key={type}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                                  >
                                    {type.replace(/_/g, " ")}: {count}
                                  </span>
                                ),
                              )
                            )}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Saved threads
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400 font-serif">
                            Durable book chat rows prove typed chat and voice
                            transcripts can be reloaded locally.
                          </p>
                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                            {[
                              ["Rows", bookChatThreadCount],
                              ["Typed", savedTypedChatThreads],
                              ["Voice", savedVoiceThreads],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </div>
                                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                                  {value}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2">
                            {bookChatThreadSummaries.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-zinc-400">
                                Waiting for a book-scoped chat or voice save.
                              </div>
                            ) : (
                              bookChatThreadSummaries
                                .slice(0, 4)
                                .map(({ thread, summary }) => (
                                  <div
                                    key={thread.id}
                                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-zinc-100">
                                          {thread.title}
                                        </div>
                                        <div className="mt-1 truncate text-[11px] font-mono text-zinc-400">
                                          {thread.bookTitle}
                                        </div>
                                      </div>
                                      <span className="shrink-0 rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                        {summary.mode}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                      <span>
                                        {summary.meaningfulMessageCount}{" "}
                                        messages
                                      </span>
                                      <span>
                                        {summary.voiceTurnCount} voice turns
                                      </span>
                                      <span>
                                        {formatTime(thread.updatedAt)}
                                      </span>
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Latest context
                          </h3>
                          <div className="mt-4 space-y-2">
                            {[
                              [
                                "Latest source",
                                latestMemoryEvent?.source || "none",
                              ],
                              [
                                "Latest status",
                                latestMemoryEvent?.status || "waiting",
                              ],
                              [
                                "Latest thread",
                                latestBookChatThread?.title || "none",
                              ],
                              [
                                "Retention",
                                latestMemoryEvent?.retentionPolicy ||
                                  "local_indexeddb",
                              ],
                              [
                                "Active book",
                                latestMemoryEvent?.bookId ||
                                  activeLearningBookId ||
                                  "none",
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Boundary
                          </h3>
                          <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Memory Events describe the user-facing learner
                              brain runtime.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Graphify remains the separate code architecture
                              graph for agents.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              AWS/cloud synchronization is still deferred until
                              beta testing.
                            </div>
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "corrections" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <Flag size={13} /> Local Memory Control
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Correction and deletion request ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Local requests for marking learner-brain records
                            wrong, requesting deletion review, or flagging
                            entries that need a human correction pass. Applied
                            requests now add non-destructive correction overlays
                            to affected local ledgers before any deletion
                            exists.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {correctionEventCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Requests
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-6">
                        {[
                          ["Open", openCorrectionEvents],
                          ["Applied", appliedCorrectionEvents],
                          ["Blocked", blockedCorrectionEvents],
                          ["Marked wrong", markWrongCorrectionEvents],
                          ["Deletion review", deleteRequestCorrectionEvents],
                          ["Overlay rows", propagatedCorrectionRows],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Recent correction requests
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Newest first. Memory rows can create these
                              requests directly; manual entries can target any
                              local learner-brain record.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestCorrectionEvent?.timestamp)}
                          </div>
                        </div>

                        {correctionEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No correction requests yet. Use Memory Events to
                            mark a local memory write wrong or request deletion
                            review.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {correctionEvents.map((event, index) => (
                              <article
                                key={event.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="flex min-w-0 gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                      <Flag size={17} />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                          {event.action.replace(/_/g, " ")}
                                        </h4>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(event.status)}`}
                                        >
                                          {event.status}
                                        </span>
                                      </div>
                                      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-zinc-400 font-serif">
                                        {event.reason}
                                      </p>
                                      {event.targetSummary && (
                                        <p className="mt-2 line-clamp-2 rounded-xl border border-white/10 bg-[#14171D] px-3 py-2 text-xs leading-relaxed text-zinc-400 font-serif">
                                          {event.targetSummary}
                                        </p>
                                      )}
                                      {correctionImpactedRows(event) > 0 && (
                                        <div className="mt-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[11px] font-semibold text-green-700">
                                          Non-destructive overlay applied to{" "}
                                          {correctionImpactedRows(event)} local
                                          row
                                          {correctionImpactedRows(event) === 1
                                            ? ""
                                            : "s"}
                                          .
                                        </div>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>{event.targetType}</span>
                                        <span className="max-w-[12rem] truncate">
                                          target {event.targetId}
                                        </span>
                                        {event.bookId && (
                                          <span className="max-w-[10rem] truncate">
                                            book {event.bookId}
                                          </span>
                                        )}
                                        {event.conceptId && (
                                          <span className="max-w-[10rem] truncate">
                                            concept {event.conceptId}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    <div>{formatTime(event.timestamp)}</div>
                                    <div className="mt-1">{event.source}</div>
                                  </div>
                                </div>
                                {(event.relatedEventIds?.length ||
                                  event.metadata) && (
                                  <details className="group mt-3">
                                    <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                      <ChevronRight
                                        size={14}
                                        className="transition-transform group-open:rotate-90"
                                      />
                                      Related ids and metadata
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                      {JSON.stringify(
                                        {
                                          relatedEventIds:
                                            event.relatedEventIds,
                                          metadata: event.metadata,
                                        },
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </details>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {event.status === "open" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void applyExistingCorrection(event)
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100"
                                    >
                                      <Flag size={12} />
                                      Apply overlay
                                    </button>
                                  )}
                                  {event.status === "open" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void setCorrectionReviewStatus(
                                          event,
                                          "dismissed",
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-white/[0.06]"
                                    >
                                      Dismiss
                                    </button>
                                  )}
                                  {event.status === "open" && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void setCorrectionReviewStatus(
                                          event,
                                          "blocked",
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-100"
                                    >
                                      Block
                                    </button>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Manual request
                          </h3>
                          <form
                            className="mt-4 grid gap-3"
                            onSubmit={submitManualCorrection}
                          >
                            <label className="grid gap-1.5 text-xs font-semibold text-zinc-400">
                              Action
                              <select
                                value={correctionAction}
                                onChange={(event) =>
                                  setCorrectionAction(
                                    event.target
                                      .value as CorrectionEvent["action"],
                                  )
                                }
                                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-blue-300 focus:bg-[#1b1f27]"
                              >
                                <option value="mark_wrong">Mark wrong</option>
                                <option value="delete_request">
                                  Request deletion review
                                </option>
                                <option value="supersede">Supersede</option>
                                <option value="review">Review</option>
                              </select>
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-zinc-400">
                              Target type
                              <select
                                value={correctionTargetType}
                                onChange={(event) =>
                                  setCorrectionTargetType(
                                    event.target
                                      .value as CorrectionEvent["targetType"],
                                  )
                                }
                                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-blue-300 focus:bg-[#1b1f27]"
                              >
                                <option value="memory_event">
                                  Memory event
                                </option>
                                <option value="retrieval_event">
                                  Retrieval event
                                </option>
                                <option value="evidence_event">
                                  Evidence event
                                </option>
                                <option value="mastery_delta">
                                  Mastery delta
                                </option>
                                <option value="model_run">Model run</option>
                                <option value="tool_job">Tool job</option>
                                <option value="artifact_record">
                                  Artifact record
                                </option>
                                <option value="citation_state">
                                  Citation state
                                </option>
                                <option value="concept">Concept</option>
                                <option value="interaction">Interaction</option>
                                <option value="learning_book">
                                  Learning book
                                </option>
                                <option value="other">Other</option>
                              </select>
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-zinc-400">
                              Target id
                              <input
                                value={correctionTargetId}
                                onChange={(event) =>
                                  setCorrectionTargetId(event.target.value)
                                }
                                placeholder="Paste a local event, concept, or book id"
                                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-300 focus:bg-[#1b1f27]"
                              />
                            </label>
                            <label className="grid gap-1.5 text-xs font-semibold text-zinc-400">
                              Reason
                              <textarea
                                value={correctionReason}
                                onChange={(event) =>
                                  setCorrectionReason(event.target.value)
                                }
                                placeholder="What is wrong, stale, sensitive, or ready for deletion review?"
                                className="min-h-24 resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-300 focus:bg-[#1b1f27]"
                              />
                            </label>
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                            >
                              <Flag size={14} />
                              Record and apply overlay
                            </button>
                          </form>
                          {(correctionFeedback || correctionError) && (
                            <p
                              className={`mt-3 rounded-2xl border px-3 py-2 text-xs font-semibold ${
                                correctionError
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : "border-green-200 bg-green-50 text-green-700"
                              }`}
                            >
                              {correctionError || correctionFeedback}
                            </p>
                          )}
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Target mix
                          </h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.keys(correctionEventsByTarget).length ===
                            0 ? (
                              <span className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                                Waiting for correction requests.
                              </span>
                            ) : (
                              Object.entries(correctionEventsByTarget).map(
                                ([targetType, count]) => (
                                  <span
                                    key={targetType}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                                  >
                                    {targetType.replace(/_/g, " ")}: {count}
                                  </span>
                                ),
                              )
                            )}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Boundary
                          </h3>
                          <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Applied requests mark affected local ledger rows
                              with correction metadata and conservative
                              stale/skipped states. They do not destructively
                              delete learner data.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Concept corrections quarantine learner-state
                              scores locally: confidence is cleared, mastery/BKT
                              knowledge are capped, and previous values stay in
                              correctionState for review.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Later propagation must mark derived summaries,
                              embeddings, graph facts, and mastery deltas as
                              superseded where practical.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              AWS/cloud synchronization remains deferred until
                              beta testing.
                            </div>
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "artifacts" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <BookOpen size={13} /> Local Source Grounding
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Artifact and citation state ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Durable local records for source cards, generated
                            study artifacts, chapter audio guides, and citation
                            states captured from chat, memory, tool streams, and
                            built-in manifests. Artifacts can be ready while
                            their citations remain checking or not checked; the
                            local verifier checks saved source-card structure,
                            generated flashcard provenance, generated
                            learning-note provenance plus local summary-preview
                            to source-preview lexical support when document text
                            exists, and stored audio-guide manifest integrity
                            without fetching external pages.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {artifactRecordCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Artifacts
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
                        {[
                          ["Source cards", sourceCardArtifacts],
                          ["Flashcards", flashcardArtifacts],
                          ["Learning notes", noteArtifacts],
                          ["Audio guides", audioOverviewArtifacts],
                          ["Ready artifacts", readyArtifactRecords],
                          [
                            "Verifier coverage",
                            `${localVerifierCoveragePercent}%`,
                          ],
                          ["Checking", checkingCitationStates],
                          ["Unavailable", unavailableCitationStates],
                          ["Verified", verifiedCitationStates],
                          ["Conflicting", conflictingCitationStates],
                          ["Unsupported", unsupportedCitationStates],
                          ["Not checked", notCheckedCitationStates],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-zinc-100">
                              Local verifier coverage
                            </h3>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              Coverage counts artifact rows that have a local,
                              no-fetch integrity contract. Unsupported rows stay
                              visible so future chart, code, image, website, or
                              preview contracts can be added deliberately.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-[#14171D] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {locallyVerifiableArtifactRecords}/
                            {artifactRecordCount} rows
                          </div>
                        </div>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#14171D]">
                          <div
                            className="h-full rounded-full bg-green-500"
                            style={{
                              width: `${localVerifierCoveragePercent}%`,
                            }}
                          />
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                          <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-green-700">
                            {locallyVerifiableArtifactRecords} locally checkable
                          </div>
                          <div className="rounded-xl border border-white/10 bg-[#14171D] px-3 py-2">
                            {locallyUnsupportedArtifactRecords} awaiting a
                            verifier contract
                          </div>
                          <div className="rounded-xl border border-white/10 bg-[#14171D] px-3 py-2">
                            {unsupportedVerifierArtifactTypes.length > 0
                              ? unsupportedVerifierArtifactTypes
                                  .map((type) => type.replace(/_/g, " "))
                                  .join(", ")
                              : "No unsupported artifact rows loaded"}
                          </div>
                        </div>
                      </div>

                      {(citationVerifierFeedback || citationVerifierError) && (
                        <div
                          className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-serif ${
                            citationVerifierError
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-green-200 bg-green-50 text-green-700"
                          }`}
                        >
                          {citationVerifierError || citationVerifierFeedback}
                        </div>
                      )}
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Recent artifacts
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Newest first. These rows include source cards and
                              generated study artifacts captured locally for
                              review before they influence learner-brain trust.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestArtifactRecord?.timestamp)}
                          </div>
                        </div>

                        {artifactRecords.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No artifacts yet. A chat web-search result,
                            generated flashcard batch, or generated learning
                            note will persist reviewable artifact rows here.
                            Built-in chapter audio guide manifests are seeded
                            when Admin loads.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {artifactRecords.map((record, index) => (
                              <article
                                key={record.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="flex min-w-0 gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                      <BookOpen size={17} />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                          {record.title}
                                        </h4>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(record.status)}`}
                                        >
                                          {record.status}
                                        </span>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(record.verificationState)}`}
                                        >
                                          {record.verificationState.replace(
                                            /_/g,
                                            " ",
                                          )}
                                        </span>
                                      </div>
                                      {record.summary && (
                                        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-zinc-400 font-serif">
                                          {record.summary}
                                        </p>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>{record.artifactType}</span>
                                        <span>{record.source}</span>
                                        {record.domain && (
                                          <span>{record.domain}</span>
                                        )}
                                        {record.searchId && (
                                          <span className="max-w-[10rem] truncate">
                                            search {record.searchId}
                                          </span>
                                        )}
                                        {record.bookId && (
                                          <span className="max-w-[10rem] truncate">
                                            book {record.bookId}
                                          </span>
                                        )}
                                        {record.citationStateIds.length > 0 && (
                                          <span>
                                            {record.citationStateIds.length}{" "}
                                            citation states
                                          </span>
                                        )}
                                      </div>
                                      {(() => {
                                        const coverage =
                                          generatedNoteClaimSpanCoverageFor(
                                            record,
                                          );
                                        return coverage ? (
                                          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-[#14171D] px-3 py-2 text-[11px] text-zinc-400">
                                            <span className="font-semibold text-zinc-200">
                                              Preview lexical support
                                            </span>
                                            <span
                                              className={`rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.1em] ${statusTone(coverage.state)}`}
                                            >
                                              {coverage.state.replace(
                                                /_/g,
                                                " ",
                                              )}
                                            </span>
                                            <span className="font-mono">
                                              {coverage.matchedClaimCount}/
                                              {coverage.claimCount} claims (
                                              {coverage.coveragePercent}%)
                                            </span>
                                            <span>
                                              local overlap only, not entailment
                                              or fact proof
                                            </span>
                                          </div>
                                        ) : null;
                                      })()}
                                      {record.url && (
                                        <a
                                          href={record.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="mt-2 block max-w-full truncate text-xs font-semibold text-blue-600 no-underline hover:text-blue-800"
                                        >
                                          {record.url}
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    {formatTime(record.timestamp)}
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  {supportsLocalCitationIntegrityArtifact(
                                    record,
                                  ) ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void runLocalArtifactVerifier(record)
                                      }
                                      disabled={
                                        citationVerifierBusyId === record.id
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      <RefreshCw
                                        size={12}
                                        className={
                                          citationVerifierBusyId === record.id
                                            ? "animate-spin"
                                            : ""
                                        }
                                      />
                                      Run local check
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                                      No local verifier yet
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void recordCorrectionRequest({
                                        action: "review",
                                        targetType: "artifact_record",
                                        targetId: record.id,
                                        targetSummary:
                                          record.summary || record.title,
                                        reason:
                                          "Admin requested source artifact review.",
                                        source: "admin_source_artifacts",
                                        bookId: record.bookId,
                                        conversationId: record.conversationId,
                                        conceptId: record.conceptId,
                                        relatedEventIds: [record.id],
                                        metadata: {
                                          artifactType: record.artifactType,
                                          status: record.status,
                                          verificationState:
                                            record.verificationState,
                                          url: record.url,
                                        },
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                                  >
                                    <Flag size={12} />
                                    Request review
                                  </button>
                                </div>

                                {(record.sourceIds.length ||
                                  record.citationStateIds.length ||
                                  record.metadata) && (
                                  <details className="group mt-3">
                                    <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                      <ChevronRight
                                        size={14}
                                        className="transition-transform group-open:rotate-90"
                                      />
                                      Source ids, citation ids, and metadata
                                    </summary>
                                    <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                      {JSON.stringify(
                                        {
                                          sourceIds: record.sourceIds,
                                          citationStateIds:
                                            record.citationStateIds,
                                          metadata: record.metadata,
                                        },
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </details>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-xl font-serif font-medium text-zinc-100">
                                Citation states
                              </h3>
                              <p className="mt-1 text-sm text-zinc-400 font-serif">
                                State machine rows for source-card claims,
                                generated-artifact provenance, and search
                                failures.
                              </p>
                            </div>
                            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                              {formatTime(latestCitationState?.timestamp)}
                            </div>
                          </div>

                          {citationStates.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-6 text-center text-sm text-zinc-400">
                              No citation states yet. Source capture writes
                              checking states, generated artifacts write not
                              checked states, and source failures write
                              unavailable states.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {citationStates.map((state, index) => (
                                <article
                                  key={state.id}
                                  className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                          {state.title || state.sourceRef}
                                        </h4>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(state.state)}`}
                                        >
                                          {state.state.replace(/_/g, " ")}
                                        </span>
                                      </div>
                                      {state.failureReason && (
                                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-orange-700 font-serif">
                                          {state.failureReason}
                                        </p>
                                      )}
                                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>{state.verifier}</span>
                                        {state.domain && (
                                          <span>{state.domain}</span>
                                        )}
                                        {state.artifactId && (
                                          <span className="max-w-[10rem] truncate">
                                            artifact {state.artifactId}
                                          </span>
                                        )}
                                        {state.checkedAt !== undefined && (
                                          <span>
                                            checked{" "}
                                            {formatTime(state.checkedAt)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                      {formatTime(state.timestamp)}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {(() => {
                                      const linkedArtifact = state.artifactId
                                        ? artifactRecordsById.get(
                                            state.artifactId,
                                          )
                                        : undefined;
                                      const linkedArtifactType =
                                        linkedArtifact?.artifactType ||
                                        (state.artifactId
                                          ? citationArtifactTypeById[
                                              state.artifactId
                                            ]
                                          : undefined);
                                      const canRun =
                                        !linkedArtifactType ||
                                        supportsLocalCitationIntegrityArtifact({
                                          artifactType: linkedArtifactType,
                                        });

                                      return canRun ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void runLocalCitationVerifier(state)
                                          }
                                          disabled={
                                            citationVerifierBusyId === state.id
                                          }
                                          className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:cursor-wait disabled:opacity-60"
                                        >
                                          <RefreshCw
                                            size={12}
                                            className={
                                              citationVerifierBusyId ===
                                              state.id
                                                ? "animate-spin"
                                                : ""
                                            }
                                          />
                                          Run local check
                                        </button>
                                      ) : (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                                          No local verifier yet
                                        </span>
                                      );
                                    })()}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void recordCorrectionRequest({
                                          action: "review",
                                          targetType: "citation_state",
                                          targetId: state.id,
                                          targetSummary:
                                            state.failureReason ||
                                            state.title ||
                                            state.sourceRef,
                                          reason:
                                            "Admin requested citation-state review.",
                                          source: "admin_citation_states",
                                          relatedEventIds: [state.id],
                                          metadata: {
                                            state: state.state,
                                            sourceRef: state.sourceRef,
                                            url: state.url,
                                            artifactId: state.artifactId,
                                          },
                                        })
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                                    >
                                      <Flag size={12} />
                                      Request review
                                    </button>
                                  </div>
                                  {(state.metadata || state.url) && (
                                    <details className="group mt-3">
                                      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                        <ChevronRight
                                          size={14}
                                          className="transition-transform group-open:rotate-90"
                                        />
                                        Source ref and metadata
                                      </summary>
                                      <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                        {JSON.stringify(
                                          {
                                            claimId: state.claimId,
                                            sourceRef: state.sourceRef,
                                            url: state.url,
                                            metadata: state.metadata,
                                          },
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    </details>
                                  )}
                                </article>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            State mix
                          </h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.keys(citationStatesByState).length === 0 ? (
                              <span className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                                Waiting for citation states.
                              </span>
                            ) : (
                              Object.entries(citationStatesByState).map(
                                ([state, count]) => (
                                  <span
                                    key={state}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(state)}`}
                                  >
                                    {state.replace(/_/g, " ")}: {count}
                                  </span>
                                ),
                              )
                            )}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Artifact mix
                          </h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.keys(artifactRecordsByType).length === 0 ? (
                              <span className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
                                Waiting for artifact records.
                              </span>
                            ) : (
                              Object.entries(artifactRecordsByType).map(
                                ([type, count]) => (
                                  <span
                                    key={type}
                                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                                  >
                                    {type.replace(/_/g, " ")}: {count}
                                  </span>
                                ),
                              )
                            )}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Boundary
                          </h3>
                          <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Source artifacts describe captured source cards,
                              generated artifacts, and citation state, not
                              learner concept mastery. Generated-note preview
                              lexical support means saved summary and source
                              previews share normalized content terms. It is not
                              sentence-level entailment, note truth, or
                              document-wide grounding.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              A checking citation is not a verified citation.
                              The local verifier can only check saved
                              source-card structure, citation linkage, URL
                              shape, domain consistency, generated flashcard
                              provenance, generated learning-note provenance,
                              saved generated-note source-span anchors and local
                              lexical overlap when available, plus stored
                              audio-guide manifest integrity; it does not fetch
                              or prove external page content, flashcard
                              correctness, note sentence truth, semantic
                              entailment, or audio transcription accuracy.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              AWS/cloud synchronization remains deferred until
                              beta testing.
                            </div>
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "diagnostics" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <ShieldCheck size={13} /> Local Beta Readiness
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Diagnostic snapshot and export
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            A non-destructive local readiness snapshot across
                            model runs, tool jobs, memory writes, retrieval,
                            background jobs, correction requests, source
                            artifacts, citation states, and mastery evidence. It
                            packages what exists in the browser now; it does not
                            sync to AWS or claim cloud-beta readiness.
                          </p>
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <span
                            className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${statusTone(betaDiagnosticsSnapshot.overallStatus)}`}
                          >
                            {betaDiagnosticsSnapshot.overallStatus.replace(
                              /_/g,
                              " ",
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={downloadBetaDiagnostics}
                            className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                          >
                            <Download size={13} />
                            Export diagnostics JSON
                          </button>
                        </div>
                      </div>

                      {diagnosticsExportFeedback && (
                        <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
                          {diagnosticsExportFeedback}
                        </div>
                      )}

                      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600/75">
                              <BrainCircuit size={13} /> Brain Architecture
                            </div>
                            <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                              Local beta completion
                            </h3>
                            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {
                                betaDiagnosticsSnapshot
                                  .brainArchitectureReadiness.summary
                              }
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusTone(betaDiagnosticsSnapshot.brainArchitectureReadiness.status)}`}
                              >
                                {betaDiagnosticsSnapshot.brainArchitectureReadiness.stage.replace(
                                  /_/g,
                                  " ",
                                )}
                              </span>
                              <span className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                brain flow{" "}
                                {
                                  betaDiagnosticsSnapshot
                                    .brainArchitectureReadiness.brainFlowPercent
                                }
                                %
                              </span>
                              <span className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                coherent proof{" "}
                                {
                                  betaDiagnosticsSnapshot
                                    .brainArchitectureReadiness
                                    .coherentProofPercent
                                }
                                %
                              </span>
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${statusTone(masteryIntegrity.status)}`}
                              >
                                mastery integrity{" "}
                                {masteryIntegrity.ready ? "ready" : "blocked"}
                              </span>
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">
                                cloud deferred
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 rounded-2xl border border-blue-100 bg-[#14171D] px-5 py-4 text-right shadow-sm">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Completion
                            </div>
                            <div className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                              {
                                betaDiagnosticsSnapshot
                                  .brainArchitectureReadiness.localBetaPercent
                              }
                              %
                            </div>
                            <p className="mt-2 max-w-[11rem] text-[11px] leading-relaxed text-zinc-400 font-serif">
                              Local brain architecture proof, not AWS readiness.
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-white/80 bg-[#14171D]/80 px-3 py-2 text-xs leading-relaxed text-zinc-400 font-serif">
                          Next action:{" "}
                          {
                            betaDiagnosticsSnapshot.brainArchitectureReadiness
                              .nextAction
                          }
                        </div>

                        {betaDiagnosticsSnapshot.brainArchitectureReadiness
                          .gapGroups.length > 0 && (
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {betaDiagnosticsSnapshot.brainArchitectureReadiness.gapGroups.map(
                              (group) => (
                                <article
                                  key={group.id}
                                  className="rounded-2xl border border-white/80 bg-[#14171D]/80 px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                      {group.title}
                                    </div>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(group.status)}`}
                                    >
                                      {group.status}
                                    </span>
                                  </div>
                                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-zinc-400 font-serif">
                                    {group.gaps.map((gap) => (
                                      <li key={`${group.id}-${gap}`}>{gap}</li>
                                    ))}
                                  </ul>
                                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                    {group.action}
                                  </p>
                                </article>
                              ),
                            )}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-3 md:grid-cols-5">
                        {[
                          [
                            "Local rows",
                            betaDiagnosticsSnapshot.summary.totalRows,
                          ],
                          [
                            "Ready gates",
                            betaDiagnosticsSnapshot.summary.ready,
                          ],
                          [
                            "Watch gates",
                            betaDiagnosticsSnapshot.summary.watch,
                          ],
                          [
                            "Blocked gates",
                            betaDiagnosticsSnapshot.summary.blocked,
                          ],
                          [
                            "Deferred gates",
                            betaDiagnosticsSnapshot.summary.deferred,
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <BrainCircuit size={13} /> Brain Flow Coverage
                          </div>
                          <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                            Chat, voice, tools, and memory proof
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            This local verifier looks across context-injection
                            rows, retrieval rows, model runs, tool jobs, and
                            request-correlated evaluated mastery, transcript
                            persistence, and background memory events for both
                            chat and voice. It proves the brain flow is wired in
                            the browser ledger; it does not call cloud services
                            or inspect private model internals.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Coverage
                          </div>
                          <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                            {betaDiagnosticsSnapshot.brainFlow.coveragePercent}%
                          </div>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(betaDiagnosticsSnapshot.brainFlow.status)}`}
                          >
                            {betaDiagnosticsSnapshot.brainFlow.status}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {betaDiagnosticsSnapshot.brainFlow.signals.map(
                          (signal) => {
                            const hasSignalEvidence =
                              signal.evidence.requestIds.length > 0 ||
                              signal.evidence.sources.length > 0 ||
                              signal.evidence.documentIds.length > 0 ||
                              typeof signal.evidence.latestTimestamp ===
                                "number";
                            return (
                              <article
                                key={signal.id}
                                className={`rounded-2xl border p-3 ${
                                  signal.ready
                                    ? "border-green-200 bg-green-50"
                                    : "border-white/10 bg-white/[0.04]"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                    {signal.title}
                                  </div>
                                  {signal.ready ? (
                                    <ShieldCheck
                                      size={14}
                                      className="shrink-0 text-green-600"
                                    />
                                  ) : (
                                    <Clock
                                      size={14}
                                      className="shrink-0 text-zinc-400"
                                    />
                                  )}
                                </div>
                                <div className="mt-2 text-xl font-semibold tabular-nums text-zinc-100">
                                  {signal.count}
                                </div>
                                <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-zinc-400 font-serif">
                                  {signal.detail}
                                </p>
                                <div className="mt-3 rounded-xl border border-white/70 bg-[#14171D]/70 px-3 py-2">
                                  <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                    Live anchors
                                  </div>
                                  {hasSignalEvidence ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {typeof signal.evidence
                                        .latestTimestamp === "number" && (
                                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                          latest{" "}
                                          {formatTime(
                                            signal.evidence.latestTimestamp,
                                          )}
                                        </span>
                                      )}
                                      {signal.evidence.requestIds.map(
                                        (requestId) => (
                                          <span
                                            key={`request-${signal.id}-${requestId}`}
                                            className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                          >
                                            req {requestId}
                                          </span>
                                        ),
                                      )}
                                      {signal.evidence.documentIds.map(
                                        (documentId) => (
                                          <span
                                            key={`document-${signal.id}-${documentId}`}
                                            className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700"
                                          >
                                            pdf {documentId}
                                          </span>
                                        ),
                                      )}
                                      {signal.evidence.sources.map((source) => (
                                        <span
                                          key={`source-${signal.id}-${source}`}
                                          className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                        >
                                          {source.replace(/_/g, " ")}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                      No live request anchor has satisfied this
                                      signal yet.
                                    </p>
                                  )}
                                </div>
                              </article>
                            );
                          },
                        )}
                      </div>

                      {betaDiagnosticsSnapshot.brainFlow.missingSignals.length >
                        0 && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Missing local evidence:{" "}
                          {betaDiagnosticsSnapshot.brainFlow.missingSignals.join(
                            ", ",
                          )}
                          .
                        </div>
                      )}
                    </section>

                    <section className="rounded-[28px] border border-blue-200 bg-blue-50/40 p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600/80">
                            <Flag size={13} /> Provider-Key Live Proof
                          </div>
                          <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                            Deliberate beta-run checklist
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            This checklist combines local provider-key presence
                            with live ledger anchors. Keys make a live run
                            possible; only request-correlated chat and voice
                            rows make proof complete. No key values are shown
                            and this panel does not call providers until this
                            attempt is explicitly approved for traffic.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={startLiveProofAttempt}
                              className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                            >
                              <Flag size={13} />
                              {activeBetaProofAttemptId
                                ? "Restart proof attempt"
                                : "Start proof attempt"}
                            </button>
                            {activeBetaProofAttemptId && (
                              <button
                                type="button"
                                onClick={clearLiveProofAttempt}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#14171D] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:border-white/15 hover:bg-white/[0.06]"
                              >
                                <Trash2 size={13} />
                                Clear attempt
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-blue-100 bg-[#14171D] px-4 py-3 text-right">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Ledger checks
                          </div>
                          <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                            {providerKeyProofChecklist.completionPercent}%
                          </div>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(providerKeyProofChecklist.status)}`}
                          >
                            {providerKeyProofChecklist.status}
                          </span>
                        </div>
                      </div>

                      <div className="mb-4 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.canAttemptProviderKeyRun ? "border-green-200 bg-green-50 text-green-700" : providerKeyProofChecklist.status === "blocked" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          {providerKeyProofChecklist.canAttemptProviderKeyRun
                            ? "live run available"
                            : providerKeyProofChecklist.status === "blocked"
                              ? "live blockers"
                              : "keys/setup needed"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.betaProofReady ? "border-green-200 bg-green-50 text-green-700" : providerKeyProofChecklist.proofComplete ? "border-amber-200 bg-amber-50 text-amber-700" : "border-white/10 bg-[#14171D] text-zinc-400"}`}
                        >
                          {providerKeyProofChecklist.betaProofReady
                            ? "beta proof ready"
                            : providerKeyProofChecklist.proofComplete
                              ? "source proof pending"
                              : "proof pending"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.chatModelKeyConfigured ? "border-green-200 bg-green-50 text-green-700" : "border-white/10 bg-[#14171D] text-zinc-400"}`}
                        >
                          chat key{" "}
                          {providerKeyProofChecklist.chatModelKeyConfigured
                            ? "seen"
                            : "missing"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.voiceRealtimeKeyConfigured ? "border-green-200 bg-green-50 text-green-700" : "border-white/10 bg-[#14171D] text-zinc-400"}`}
                        >
                          voice key{" "}
                          {providerKeyProofChecklist.voiceRealtimeKeyConfigured
                            ? "seen"
                            : "missing"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${activityTone}`}
                        >
                          provider meters {activityLabel.toLowerCase()}
                        </span>
                        <span className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                          live coverage{" "}
                          {providerKeyProofChecklist.liveCoveragePercent}%
                        </span>
                        <span
                          className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${activeBetaProofAttemptId ? "border-blue-200 bg-blue-50 text-blue-700" : "border-white/10 bg-[#14171D] text-zinc-400"}`}
                        >
                          active attempt{" "}
                          {activeBetaProofAttemptId || "not started"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerTrafficApprovalReady ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          traffic {providerTrafficStateLabel}
                        </span>
                        <span
                          className={`max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.sharedProofAttemptIds.length > 0 ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          shared attempt{" "}
                          {providerKeyProofChecklist.coherentLiveProof
                            .sharedProofAttemptIds[0] || "missing"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.proofAttemptLifecycleEventIds.length > 0 ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          attempt start{" "}
                          {providerKeyProofChecklist.coherentLiveProof
                            .proofAttemptLifecycleEventIds.length > 0
                            ? "recorded"
                            : "missing"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.proofFresh ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          proof{" "}
                          {providerKeyProofChecklist.coherentLiveProof
                            .proofFresh
                            ? "fresh"
                            : "stale"}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.proofWindowReady ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                        >
                          proof window{" "}
                          {formatDurationMinutes(
                            providerKeyProofChecklist.coherentLiveProof
                              .proofWindowMs,
                          )}
                        </span>
                      </div>

                      <div className="rounded-2xl border border-blue-100 bg-[#14171D] px-4 py-3 text-sm leading-relaxed text-zinc-400 font-serif">
                        {providerKeyProofChecklist.summary}
                      </div>

                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
                              External provider traffic
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Approve this proof attempt before the real drill
                            </h4>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              Approval lets the exact proof prompts send the
                              active book context to OpenRouter and live voice
                              audio/context to Deepgram. It may use provider
                              credits. Approval is local, attempt-scoped, and
                              does not reveal keys.
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                            <button
                              type="button"
                              onClick={approveLiveProofProviderTraffic}
                              disabled={!activeBetaProofAttemptId}
                              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-[#14171D] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700 transition hover:border-amber-400 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-zinc-400"
                            >
                              <ShieldCheck size={13} />
                              Approve provider traffic
                            </button>
                            {providerTrafficApprovedForActiveAttempt && (
                              <button
                                type="button"
                                onClick={revokeLiveProofProviderTrafficApproval}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#14171D] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:border-white/15 hover:bg-white/[0.06]"
                              >
                                <Trash2 size={13} />
                                Revoke approval
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${providerTrafficApprovalReady ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-[#14171D] text-amber-700"}`}
                          >
                            {providerTrafficApprovalReady
                              ? "traffic approved"
                              : providerTrafficApprovedForActiveAttempt
                                ? "approval event pending"
                                : "traffic locked"}
                          </span>
                          <span className="max-w-full truncate rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-mono text-zinc-400">
                            attempt {activeBetaProofAttemptId || "not started"}
                          </span>
                          {activeProviderTrafficApproval && (
                            <span className="rounded-full border border-green-200 bg-[#14171D] px-2.5 py-1 text-[11px] font-mono text-green-700">
                              approved{" "}
                              {formatTime(
                                activeProviderTrafficApproval.approvedAt,
                              )}
                            </span>
                          )}
                          {liveProofPreflight.providerTrafficApprovalEventIds.map(
                            (eventId) => (
                              <span
                                key={`provider-traffic-approval-event-${eventId}`}
                                className="max-w-full truncate rounded-full border border-green-200 bg-[#14171D] px-2.5 py-1 text-[11px] font-mono text-green-700"
                              >
                                approval event {eventId}
                              </span>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">
                              Local proof receipt
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Export-ready chat and voice run summary
                            </h4>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {liveProofReceipt.summary}
                            </p>
                          </div>
                          <div className="shrink-0 rounded-2xl border border-emerald-100 bg-[#14171D] px-4 py-3 text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Receipt
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(liveProofReceipt.status)}`}
                            >
                              {liveProofReceipt.status}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofReceipt.ready ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {liveProofReceipt.ready
                              ? "receipt ready"
                              : "receipt pending"}
                          </span>
                          <span className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                            provider captures{" "}
                            {liveProofReceipt.providerCaptureCount}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofReceipt.sourceReadyForBeta ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {liveProofReceipt.sourceKind.replace(/_/g, " ")}
                          </span>
                          {liveProofReceipt.selectedRequestIds.map(
                            (requestId) => (
                              <span
                                key={`receipt-request-${requestId}`}
                                className="max-w-full truncate rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-mono text-blue-700"
                              >
                                req {requestId}
                              </span>
                            ),
                          )}
                          {liveProofReceipt.sharedProofAttemptIds.map(
                            (attemptId) => (
                              <span
                                key={`receipt-attempt-${attemptId}`}
                                className="max-w-full truncate rounded-full border border-emerald-100 bg-[#14171D] px-2.5 py-1 text-[11px] font-mono text-emerald-700"
                              >
                                attempt {attemptId}
                              </span>
                            ),
                          )}
                          {typeof liveProofReceipt.latestTimestamp ===
                            "number" && (
                            <span className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-mono text-zinc-400">
                              latest{" "}
                              {formatTime(liveProofReceipt.latestTimestamp)}
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofReceipt.proofFresh ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {liveProofReceipt.proofFresh ? "fresh" : "stale"}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofReceipt.proofWindowReady ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            window{" "}
                            {formatDurationMinutes(
                              liveProofReceipt.proofWindowMs,
                            )}
                          </span>
                        </div>

                        <div
                          className={`mt-3 rounded-xl border px-3 py-2 text-[11px] leading-relaxed font-serif ${liveProofReceipt.sourceReadyForBeta ? "border-emerald-100 bg-[#14171D] text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                        >
                          {liveProofReceipt.sourceSummary}
                        </div>

                        {liveProofReceipt.providerCaptures.length > 0 && (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {liveProofReceipt.providerCaptures.map(
                              (capture, index) => {
                                const modelLabel =
                                  capture.usedModel ||
                                  capture.requestedModel ||
                                  capture.phase ||
                                  capture.source.replace(/_/g, " ");
                                return (
                                  <div
                                    key={`receipt-provider-${capture.layer}-${capture.requestId || index}-${capture.timestamp || index}`}
                                    className="rounded-xl border border-emerald-100 bg-[#14171D] px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">
                                        {capture.layer} provider
                                      </span>
                                      <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                                        {capture.provider}
                                      </span>
                                    </div>
                                    <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
                                      {capture.title}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {modelLabel && (
                                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                          {modelLabel}
                                        </span>
                                      )}
                                      {capture.requestId && (
                                        <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700">
                                          req {capture.requestId}
                                        </span>
                                      )}
                                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                        {capture.source.replace(/_/g, " ")}
                                      </span>
                                      {capture.runSource && (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-mono text-amber-700">
                                          {capture.runSource.replace(/_/g, " ")}
                                        </span>
                                      )}
                                      {capture.seeded && (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700">
                                          seeded QA
                                        </span>
                                      )}
                                      {capture.synthetic && (
                                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-700">
                                          synthetic
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        )}

                        {liveProofReceipt.warnings.length > 0 && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 font-serif">
                            {liveProofReceipt.warnings.join(" ")}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 rounded-2xl border border-blue-100 bg-[#14171D] p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-500">
                              Live beta runbook
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Ordered manual proof path
                            </h4>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {liveProofRunbook.summary}
                            </p>
                          </div>
                          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Runbook
                            </div>
                            <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
                              {liveProofRunbook.readySteps}/
                              {liveProofRunbook.totalSteps}
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(liveProofRunbook.status)}`}
                            >
                              {liveProofRunbook.status}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofRunbook.canStart ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {liveProofRunbook.canStart
                              ? "manual run can start"
                              : "setup before run"}
                          </span>
                          {liveProofRunbook.nextStepId && (
                            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">
                              next{" "}
                              {liveProofRunbook.nextStepId.replace(/_/g, " ")}
                            </span>
                          )}
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                            local only
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {liveProofRunbook.steps.map((runbookStep, index) => {
                            const StepIcon =
                              runbookStep.status === "ready"
                                ? ShieldCheck
                                : runbookStep.status === "blocked"
                                  ? AlertTriangle
                                  : Clock;
                            const hasStepEvidence =
                              runbookStep.evidence.requestIds.length > 0 ||
                              runbookStep.evidence.documentIds.length > 0 ||
                              (runbookStep.evidence.proofAttemptIds || [])
                                .length > 0 ||
                              typeof runbookStep.evidence.latestTimestamp ===
                                "number";
                            return (
                              <article
                                key={runbookStep.id}
                                className={`rounded-2xl border p-3 ${
                                  runbookStep.status === "ready"
                                    ? "border-green-200 bg-green-50"
                                    : runbookStep.status === "blocked"
                                      ? "border-red-200 bg-red-50"
                                      : "border-white/10 bg-white/[0.04]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="rounded-full border border-white/70 bg-[#14171D]/70 px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                        {index + 1}
                                      </span>
                                      <h5 className="m-0 text-sm font-semibold text-zinc-100">
                                        {runbookStep.title}
                                      </h5>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(runbookStep.status)}`}
                                      >
                                        {runbookStep.status}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs leading-relaxed text-zinc-400 font-serif">
                                      {runbookStep.summary}
                                    </p>
                                  </div>
                                  <StepIcon
                                    size={15}
                                    className={`shrink-0 ${
                                      runbookStep.status === "ready"
                                        ? "text-green-600"
                                        : runbookStep.status === "blocked"
                                          ? "text-red-600"
                                          : "text-zinc-400"
                                    }`}
                                  />
                                </div>

                                <p className="mt-3 rounded-xl border border-white/80 bg-[#14171D]/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                  {runbookStep.action}
                                </p>

                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {runbookStep.evidenceNeeded.map((entry) => (
                                    <span
                                      key={`${runbookStep.id}-needed-${entry}`}
                                      className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-semibold text-zinc-400"
                                    >
                                      {entry}
                                    </span>
                                  ))}
                                </div>

                                {runbookStep.blockingChecks.length > 0 && (
                                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 font-serif">
                                    Missing:{" "}
                                    {runbookStep.blockingChecks.join(", ")}.
                                  </div>
                                )}

                                {hasStepEvidence && (
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {typeof runbookStep.evidence
                                      .latestTimestamp === "number" && (
                                      <span className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                        latest{" "}
                                        {formatTime(
                                          runbookStep.evidence.latestTimestamp,
                                        )}
                                      </span>
                                    )}
                                    {runbookStep.evidence.requestIds.map(
                                      (requestId) => (
                                        <span
                                          key={`runbook-request-${runbookStep.id}-${requestId}`}
                                          className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                        >
                                          req {requestId}
                                        </span>
                                      ),
                                    )}
                                    {(
                                      runbookStep.evidence.proofAttemptIds || []
                                    ).map((attemptId) => (
                                      <span
                                        key={`runbook-attempt-${runbookStep.id}-${attemptId}`}
                                        className="rounded-full border border-blue-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                      >
                                        attempt {attemptId}
                                      </span>
                                    ))}
                                    {runbookStep.evidence.documentIds.map(
                                      (documentId) => (
                                        <span
                                          key={`runbook-document-${runbookStep.id}-${documentId}`}
                                          className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700"
                                        >
                                          pdf {documentId}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-600">
                              Live proof drill packet
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Exact local prompts for chat and voice
                            </h4>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {liveProofDrillPacket.summary}
                            </p>
                          </div>
                          <div className="shrink-0 rounded-2xl border border-cyan-100 bg-[#14171D] px-4 py-3 text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Drill
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(liveProofDrillPacket.status)}`}
                            >
                              {liveProofDrillPacket.status}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${liveProofDrillPacket.canRun ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {liveProofDrillPacket.canRun
                              ? "ready to run"
                              : "not runnable yet"}
                          </span>
                          <span className="rounded-full border border-cyan-100 bg-[#14171D] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-700">
                            local only
                          </span>
                          {liveProofDrillPacket.activeAttemptRequired && (
                            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-blue-700">
                              active attempt required
                            </span>
                          )}
                          {liveProofDrillPacket.activeMultiPdfBookRequired && (
                            <span className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-violet-700">
                              multi-PDF book required
                            </span>
                          )}
                        </div>

                        <div className="mt-4 rounded-2xl border border-white bg-[#14171D]/85 p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-600">
                                Live drill preflight
                              </div>
                              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400 font-serif">
                                {liveProofPreflight.summary}
                              </p>
                            </div>
                            <div className="shrink-0 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-right">
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                Preflight
                              </div>
                              <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                                {liveProofPreflight.readyChecks}/
                                {liveProofPreflight.totalChecks}
                              </div>
                              <span
                                className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(liveProofPreflight.status)}`}
                              >
                                {liveProofPreflight.status}
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${liveProofPreflight.canRun ? "border-green-200 bg-green-50 text-green-700" : liveProofPreflight.needsProviderTraffic ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}
                            >
                              {liveProofPreflight.canRun
                                ? "ready to call providers"
                                : liveProofPreflight.needsProviderTraffic
                                  ? "provider traffic gated"
                                  : "proof already ready"}
                            </span>
                            <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">
                              ready PDFs {liveProofPreflight.readyDocumentCount}
                            </span>
                            {liveProofPreflight.activeBookId && (
                              <span className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                book {liveProofPreflight.activeBookId}
                              </span>
                            )}
                            {liveProofPreflight.activeProofAttemptId && (
                              <span className="max-w-full truncate rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700">
                                attempt{" "}
                                {liveProofPreflight.activeProofAttemptId}
                              </span>
                            )}
                            {liveProofPreflight.readyDocumentIds.map(
                              (documentId) => (
                                <span
                                  key={`preflight-document-${documentId}`}
                                  className="max-w-full truncate rounded-full border border-violet-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-violet-700"
                                >
                                  pdf {documentId}
                                </span>
                              ),
                            )}
                          </div>

                          {liveProofPreflight.missingChecks.length > 0 && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 font-serif">
                              Preflight needs{" "}
                              {liveProofPreflight.missingChecks.join(", ")}.
                            </div>
                          )}

                          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">
                                  Attempt audit
                                </div>
                                <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-400 font-serif">
                                  {liveProofAttemptAudit.summary}
                                </p>
                                <p className="mt-1 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                  {liveProofAttemptAudit.nextAction}
                                </p>
                              </div>
                              <div className="shrink-0 text-left md:text-right">
                                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                  Audit
                                </div>
                                <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                                  {liveProofAttemptAudit.readyChecks}/
                                  {liveProofAttemptAudit.totalChecks}
                                </div>
                                <span
                                  className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(liveProofAttemptAudit.status)}`}
                                >
                                  {liveProofAttemptAudit.status}
                                </span>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${liveProofAttemptAudit.canRunProviderTraffic ? "border-green-200 bg-green-50 text-green-700" : liveProofAttemptAudit.sourceReadyForBeta ? "border-blue-200 bg-[#14171D] text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                              >
                                {liveProofAttemptAudit.canRunProviderTraffic
                                  ? "provider run unlocked"
                                  : liveProofAttemptAudit.sourceReadyForBeta
                                    ? "receipt beta-ready"
                                    : "provider run locked"}
                              </span>
                              <span className="rounded-full border border-blue-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">
                                captures{" "}
                                {liveProofAttemptAudit.providerCaptureCount}
                              </span>
                              <span className="rounded-full border border-violet-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700">
                                ready PDFs{" "}
                                {liveProofAttemptAudit.readyDocumentCount}
                              </span>
                              {liveProofAttemptAudit.activeProofAttemptId && (
                                <span className="max-w-full truncate rounded-full border border-blue-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-blue-700">
                                  active{" "}
                                  {liveProofAttemptAudit.activeProofAttemptId}
                                </span>
                              )}
                              {liveProofAttemptAudit.selectedLedgerProofAttemptId && (
                                <span className="max-w-full truncate rounded-full border border-cyan-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-cyan-700">
                                  ledger{" "}
                                  {
                                    liveProofAttemptAudit.selectedLedgerProofAttemptId
                                  }
                                </span>
                              )}
                              {liveProofAttemptAudit.selectedRequestIds.map(
                                (requestId) => (
                                  <span
                                    key={`attempt-audit-request-${requestId}`}
                                    className="max-w-full truncate rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                  >
                                    req {requestId}
                                  </span>
                                ),
                              )}
                              {liveProofAttemptAudit.providerProofAttemptIds.map(
                                (attemptId) => (
                                  <span
                                    key={`attempt-audit-provider-${attemptId}`}
                                    className="max-w-full truncate rounded-full border border-emerald-100 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-emerald-700"
                                  >
                                    provider {attemptId}
                                  </span>
                                ),
                              )}
                            </div>
                            {liveProofAttemptAudit.missingChecks.length > 0 && (
                              <div className="mt-2 text-[11px] leading-relaxed text-amber-700 font-serif">
                                Audit still needs{" "}
                                {liveProofAttemptAudit.missingChecks.join(", ")}
                                .
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {[
                            [
                              "Setup checklist",
                              liveProofDrillPacket.setupChecklist,
                            ],
                            ["Run sequence", liveProofDrillPacket.runSequence],
                          ].map(([title, entries]) => (
                            <div
                              key={title as string}
                              className="rounded-2xl border border-white bg-[#14171D]/85 p-3"
                            >
                              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                {title as string}
                              </div>
                              <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400 font-serif">
                                {(entries as string[]).map((entry, index) => (
                                  <li
                                    key={`${title}-${entry}`}
                                    className="grid grid-cols-[1.35rem_minmax(0,1fr)] gap-2"
                                  >
                                    <span className="font-mono text-[10px] text-zinc-400">
                                      {index + 1}
                                    </span>
                                    <span>{entry}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {liveProofDrillPacket.prompts.map((prompt) => (
                            <article
                              key={prompt.id}
                              className="rounded-2xl border border-white bg-[#14171D]/90 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                    {prompt.layer} agent layer
                                  </div>
                                  <h5 className="mt-1 text-sm font-semibold text-zinc-100">
                                    {prompt.title}
                                  </h5>
                                </div>
                                <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-700">
                                  exact prompt
                                </span>
                              </div>
                              {prompt.layer === "chat" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    loadLiveProofPrompt(prompt.prompt)
                                  }
                                  disabled={!liveProofPreflight.canRun}
                                  className="mt-3 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-zinc-400"
                                >
                                  Load in chat
                                </button>
                              )}
                              {prompt.layer === "voice" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    loadLiveProofPrompt(prompt.prompt)
                                  }
                                  disabled={!liveProofPreflight.canRun}
                                  className="mt-3 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-zinc-400"
                                >
                                  Load voice script
                                </button>
                              )}
                              <p className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2 text-xs leading-relaxed text-zinc-300 font-serif">
                                {prompt.prompt}
                              </p>
                              <p className="mt-3 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                {prompt.toolExpectation}
                              </p>
                              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                {prompt.evidenceGoal}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {prompt.expectedRows.map((row) => (
                                  <span
                                    key={`${prompt.id}-${row}`}
                                    className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-semibold text-zinc-400"
                                  >
                                    {row}
                                  </span>
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>

                        {liveProofDrillPacket.blockingChecks.length > 0 && (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 font-serif">
                            Blocking checks:{" "}
                            {liveProofDrillPacket.blockingChecks.join(", ")}.
                          </div>
                        )}

                        <div className="mt-4 rounded-2xl border border-white bg-[#14171D]/85 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                            Export instructions
                          </div>
                          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400 font-serif">
                            {liveProofDrillPacket.exportInstructions.map(
                              (instruction) => (
                                <li
                                  key={instruction}
                                  className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2"
                                >
                                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                                  <span>{instruction}</span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-blue-100 bg-[#14171D] p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-500">
                              Coherent live proof bundle
                            </div>
                            <h4 className="mt-1 text-base font-semibold text-zinc-100">
                              Same book, same thread, both agent layers
                            </h4>
                            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {
                                providerKeyProofChecklist.coherentLiveProof
                                  .summary
                              }
                            </p>
                          </div>
                          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              Bundle
                            </div>
                            <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
                              {
                                providerKeyProofChecklist.coherentLiveProof
                                  .completionPercent
                              }
                              %
                            </div>
                            <span
                              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(providerKeyProofChecklist.coherentLiveProof.status)}`}
                            >
                              {
                                providerKeyProofChecklist.coherentLiveProof
                                  .status
                              }
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {providerKeyProofChecklist.coherentLiveProof
                            .chatRequestId && (
                            <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700">
                              chat req{" "}
                              {
                                providerKeyProofChecklist.coherentLiveProof
                                  .chatRequestId
                              }
                            </span>
                          )}
                          {providerKeyProofChecklist.coherentLiveProof
                            .voiceRequestId && (
                            <span className="rounded-full border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-[10px] font-mono text-cyan-700">
                              voice req{" "}
                              {
                                providerKeyProofChecklist.coherentLiveProof
                                  .voiceRequestId
                              }
                            </span>
                          )}
                          {providerKeyProofChecklist.coherentLiveProof.sharedProofAttemptIds.map(
                            (attemptId) => (
                              <span
                                key={`coherent-attempt-${attemptId}`}
                                className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                              >
                                attempt {attemptId}
                              </span>
                            ),
                          )}
                          {providerKeyProofChecklist.coherentLiveProof.sharedBookIds.map(
                            (bookId) => (
                              <span
                                key={`coherent-book-${bookId}`}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                              >
                                book {bookId}
                              </span>
                            ),
                          )}
                          {providerKeyProofChecklist.coherentLiveProof.sharedConversationIds.map(
                            (conversationId) => (
                              <span
                                key={`coherent-thread-${conversationId}`}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                              >
                                thread {conversationId}
                              </span>
                            ),
                          )}
                          {providerKeyProofChecklist.coherentLiveProof.sharedDocumentIds.map(
                            (documentId) => (
                              <span
                                key={`coherent-pdf-${documentId}`}
                                className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700"
                              >
                                pdf {documentId}
                              </span>
                            ),
                          )}
                          {typeof providerKeyProofChecklist.coherentLiveProof
                            .latestTimestamp === "number" && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                              latest{" "}
                              {formatTime(
                                providerKeyProofChecklist.coherentLiveProof
                                  .latestTimestamp,
                              )}
                            </span>
                          )}
                          {typeof providerKeyProofChecklist.coherentLiveProof
                            .oldestTimestamp === "number" && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                              first{" "}
                              {formatTime(
                                providerKeyProofChecklist.coherentLiveProof
                                  .oldestTimestamp,
                              )}
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.proofWindowReady ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            window{" "}
                            {formatDurationMinutes(
                              providerKeyProofChecklist.coherentLiveProof
                                .proofWindowMs,
                            )}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${providerKeyProofChecklist.coherentLiveProof.proofFresh ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                          >
                            {providerKeyProofChecklist.coherentLiveProof
                              .proofFresh
                              ? "fresh proof"
                              : "stale proof"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {providerKeyProofChecklist.coherentLiveProof.requestBundles.map(
                            (bundle) => {
                              const rowMetrics = [
                                ["Context", bundle.contextRows],
                                ["Retrieval", bundle.retrievalRows],
                                ["Completed model", bundle.completedModelRows],
                                ["Provider", bundle.providerRows],
                                ["Tool", bundle.toolRows],
                                ["Mastery", bundle.evidenceRows],
                                ["Transcript", bundle.transcriptRows],
                                ["Background", bundle.backgroundRows],
                              ] as const;
                              return (
                                <article
                                  key={bundle.layer}
                                  className={`rounded-2xl border p-3 ${
                                    bundle.complete
                                      ? "border-green-200 bg-green-50"
                                      : "border-white/10 bg-white/[0.04]"
                                  }`}
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                        Selected request rows
                                      </div>
                                      <h5 className="mt-1 text-sm font-semibold text-zinc-100">
                                        {bundle.title}
                                      </h5>
                                      <div className="mt-1 max-w-full truncate text-[10px] font-mono text-zinc-400">
                                        {bundle.requestId
                                          ? `req ${bundle.requestId}`
                                          : "no request selected yet"}
                                      </div>
                                    </div>
                                    <span
                                      className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(bundle.status)}`}
                                    >
                                      {bundle.status}
                                    </span>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                                    {rowMetrics.map(([label, value]) => (
                                      <div
                                        key={`${bundle.layer}-${label}`}
                                        className="min-w-0 rounded-xl border border-white/80 bg-[#14171D]/80 px-2 py-1.5"
                                      >
                                        <div className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                          {label}
                                        </div>
                                        <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-100">
                                          {value}
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  {bundle.providerCaptures.length > 0 && (
                                    <div className="mt-3 grid gap-2">
                                      {bundle.providerCaptures.map(
                                        (capture, index) => {
                                          const modelLabel =
                                            capture.usedModel ||
                                            capture.requestedModel ||
                                            "";
                                          return (
                                            <div
                                              key={`${bundle.layer}-provider-${capture.source}-${capture.requestId || index}-${capture.timestamp || index}`}
                                              className="rounded-xl border border-blue-100 bg-[#14171D] px-3 py-2"
                                            >
                                              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
                                                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-500">
                                                    Provider capture
                                                  </div>
                                                  <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
                                                    {capture.title}
                                                  </div>
                                                </div>
                                                <span className="w-fit rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">
                                                  {capture.provider}
                                                </span>
                                              </div>
                                              <div className="mt-2 flex flex-wrap gap-1.5">
                                                {modelLabel && (
                                                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                                    model {modelLabel}
                                                  </span>
                                                )}
                                                {capture.phase && (
                                                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                                    phase {capture.phase}
                                                  </span>
                                                )}
                                                {capture.requestId && (
                                                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700">
                                                    req {capture.requestId}
                                                  </span>
                                                )}
                                                {typeof capture.timestamp ===
                                                  "number" && (
                                                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                                    latest{" "}
                                                    {formatTime(
                                                      capture.timestamp,
                                                    )}
                                                  </span>
                                                )}
                                                {capture.proofAttemptIds.map(
                                                  (attemptId) => (
                                                    <span
                                                      key={`${bundle.layer}-provider-attempt-${attemptId}`}
                                                      className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                                    >
                                                      attempt {attemptId}
                                                    </span>
                                                  ),
                                                )}
                                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                                  {capture.source.replace(
                                                    /_/g,
                                                    " ",
                                                  )}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        },
                                      )}
                                    </div>
                                  )}

                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {bundle.proofAttemptIds.map((attemptId) => (
                                      <span
                                        key={`${bundle.layer}-attempt-${attemptId}`}
                                        className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                      >
                                        attempt {attemptId}
                                      </span>
                                    ))}
                                    {bundle.documentIds.map((documentId) => (
                                      <span
                                        key={`${bundle.layer}-pdf-${documentId}`}
                                        className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700"
                                      >
                                        pdf {documentId}
                                      </span>
                                    ))}
                                    {bundle.bookIds.map((bookId) => (
                                      <span
                                        key={`${bundle.layer}-book-${bookId}`}
                                        className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                      >
                                        book {bookId}
                                      </span>
                                    ))}
                                    {bundle.conversationIds.map(
                                      (conversationId) => (
                                        <span
                                          key={`${bundle.layer}-thread-${conversationId}`}
                                          className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                        >
                                          thread {conversationId}
                                        </span>
                                      ),
                                    )}
                                    {typeof bundle.latestTimestamp ===
                                      "number" && (
                                      <span className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                        latest{" "}
                                        {formatTime(bundle.latestTimestamp)}
                                      </span>
                                    )}
                                  </div>

                                  {bundle.missingRows.length > 0 && (
                                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 font-serif">
                                      Missing rows:{" "}
                                      {bundle.missingRows.join(", ")}.
                                    </div>
                                  )}
                                </article>
                              );
                            },
                          )}
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                          {providerKeyProofChecklist.coherentLiveProof.checks.map(
                            (check) => (
                              <div
                                key={check.id}
                                className={`rounded-xl border px-3 py-2 ${
                                  check.ready
                                    ? "border-green-200 bg-green-50"
                                    : check.status === "blocked"
                                      ? "border-red-200 bg-red-50"
                                      : "border-white/10 bg-white/[0.04]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                    {check.title}
                                  </div>
                                  {check.ready ? (
                                    <ShieldCheck
                                      size={13}
                                      className="shrink-0 text-green-600"
                                    />
                                  ) : (
                                    <Clock
                                      size={13}
                                      className="shrink-0 text-zinc-400"
                                    />
                                  )}
                                </div>
                                <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                  {check.summary}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {providerKeyProofChecklist.checks.map((check) => {
                          const CheckIcon = check.ready
                            ? ShieldCheck
                            : check.status === "blocked"
                              ? AlertTriangle
                              : Clock;
                          const hasCheckEvidence =
                            check.evidence.requestIds.length > 0 ||
                            check.evidence.sources.length > 0 ||
                            check.evidence.documentIds.length > 0 ||
                            (check.evidence.proofAttemptIds || []).length > 0 ||
                            typeof check.evidence.latestTimestamp === "number";
                          return (
                            <article
                              key={check.id}
                              className={`rounded-2xl border p-3 ${
                                check.ready
                                  ? "border-green-200 bg-green-50"
                                  : check.status === "blocked"
                                    ? "border-red-200 bg-red-50"
                                    : "border-white/10 bg-[#14171D]"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                    {check.title}
                                  </div>
                                  <span className="mt-1 inline-flex rounded-full border border-white/70 bg-[#14171D]/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                    {check.scope === "provider_key"
                                      ? "key setup"
                                      : "live ledger"}
                                  </span>
                                </div>
                                <CheckIcon
                                  size={14}
                                  className={`shrink-0 ${
                                    check.ready
                                      ? "text-green-600"
                                      : check.status === "blocked"
                                        ? "text-red-600"
                                        : "text-zinc-400"
                                  }`}
                                />
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(check.status)}`}
                                >
                                  {check.status}
                                </span>
                                <span className="text-[10px] font-mono text-zinc-400">
                                  rows {check.count}
                                </span>
                              </div>
                              <p className="mt-2 text-xs leading-relaxed text-zinc-400 font-serif">
                                {check.summary}
                              </p>
                              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                {check.action}
                              </p>
                              {hasCheckEvidence && (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {typeof check.evidence.latestTimestamp ===
                                    "number" && (
                                    <span className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400">
                                      latest{" "}
                                      {formatTime(
                                        check.evidence.latestTimestamp,
                                      )}
                                    </span>
                                  )}
                                  {check.evidence.requestIds.map(
                                    (requestId) => (
                                      <span
                                        key={`proof-request-${check.id}-${requestId}`}
                                        className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                      >
                                        req {requestId}
                                      </span>
                                    ),
                                  )}
                                  {(check.evidence.proofAttemptIds || []).map(
                                    (attemptId) => (
                                      <span
                                        key={`proof-attempt-${check.id}-${attemptId}`}
                                        className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                      >
                                        attempt {attemptId}
                                      </span>
                                    ),
                                  )}
                                  {check.evidence.documentIds.map(
                                    (documentId) => (
                                      <span
                                        key={`proof-document-${check.id}-${documentId}`}
                                        className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-mono text-violet-700"
                                      >
                                        pdf {documentId}
                                      </span>
                                    ),
                                  )}
                                  {check.evidence.sources.map((source) => (
                                    <span
                                      key={`proof-source-${check.id}-${source}`}
                                      className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                    >
                                      {source.replace(/_/g, " ")}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>

                      {providerKeyProofChecklist.missingChecks.length > 0 && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Missing provider-key proof:{" "}
                          {providerKeyProofChecklist.missingChecks.join(", ")}.
                        </div>
                      )}
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-600/80">
                            <Activity size={13} /> Background Job Ledger
                          </div>
                          <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                            Local retry and dead-letter visibility
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Memory workers now record interaction,
                            learning-book, and graph-concept jobs with queued,
                            running, completed, retry, and dead-letter states in
                            the browser ledger. Admin can tune beta behavior
                            from these rows without cloud workers.
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${statusTone(latestBackgroundJob?.status || "watch")}`}
                        >
                          {latestBackgroundJob
                            ? latestBackgroundJob.status.replace(/_/g, " ")
                            : "waiting"}
                        </span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          ["Rows", backgroundJobCount],
                          ["Active", runningBackgroundJobs],
                          ["Retry scheduled", retryScheduledBackgroundJobs],
                          ["Dead-letter", deadLetterBackgroundJobs],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {latestBackgroundJob ? (
                        <>
                          <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-800">
                            Latest: {latestBackgroundJob.jobName} on attempt{" "}
                            {latestBackgroundJob.attempt}/
                            {latestBackgroundJob.maxAttempts}
                            {latestBackgroundJob.error
                              ? ` - ${latestBackgroundJob.error}`
                              : ""}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {Object.entries(backgroundJobsByName).map(
                              ([jobName, count]) => (
                                <span
                                  key={jobName}
                                  className="rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800"
                                >
                                  {jobName.replace(/_/g, " ")}: {count}
                                </span>
                              ),
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-400">
                          Run a chat turn, voice turn, document ingest, or graph
                          update to populate the local background memory queue.
                        </div>
                      )}
                    </section>

                    <section className="rounded-[28px] border border-blue-200 bg-blue-50/40 p-5 shadow-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-600/80">
                            <Sparkles size={13} /> Synthetic Wiring Rehearsal
                          </div>
                          <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                            Exercise shared contracts without beta traffic
                          </h3>
                          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Runs a deterministic in-memory rehearsal through the
                            shared multi-PDF packet helpers, typed-chat tool
                            definitions, live-voice tool definitions, and the
                            same thirteen-signal coverage verifier. It also
                            compares shared tool schemas and the voice-only
                            study-context tool before live provider turns. It
                            writes no durable rows, calls no providers, and
                            never raises the live coverage meter above.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setBrainWiringRehearsal(
                              runLocalBrainWiringRehearsal(),
                            )
                          }
                          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-blue-200 bg-[#14171D] px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                        >
                          <RefreshCw size={13} />
                          {brainWiringRehearsal
                            ? "Run rehearsal again"
                            : "Run local rehearsal"}
                        </button>
                      </div>

                      {brainWiringRehearsal ? (
                        <div className="mt-4">
                          <div className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-[#14171D] p-4 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(brainWiringRehearsal.status)}`}
                                >
                                  synthetic {brainWiringRehearsal.status}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                  no durable rows
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                                  excluded from live coverage
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-zinc-300 font-serif">
                                {brainWiringRehearsal.summary}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-2xl font-semibold tabular-nums text-zinc-100">
                                {brainWiringRehearsal.coverage.coveragePercent}%
                              </div>
                              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                synthetic contract
                              </div>
                              <div className="mt-1 text-[10px] font-mono text-zinc-400">
                                live remains{" "}
                                {
                                  betaDiagnosticsSnapshot.brainFlow
                                    .coveragePercent
                                }
                                %
                              </div>
                            </div>
                          </div>

                          {brainWiringRehearsalGap && (
                            <div className="mt-3 grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
                              <div className="rounded-2xl border border-blue-200 bg-[#14171D] p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                                      Live beta gap
                                    </div>
                                    <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                                      {brainWiringRehearsalGap.summary}
                                    </p>
                                  </div>
                                  <span
                                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${brainWiringRehearsalGap.readyForProviderKeyRun ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
                                  >
                                    {brainWiringRehearsalGap.readyForProviderKeyRun
                                      ? "preflight ready"
                                      : "fix live blockers"}
                                  </span>
                                </div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                      Synthetic
                                    </div>
                                    <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                                      {
                                        brainWiringRehearsalGap.syntheticCoveragePercent
                                      }
                                      %
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400">
                                      {brainWiringRehearsalGap.syntheticStatus}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                      Live ledger
                                    </div>
                                    <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
                                      {
                                        brainWiringRehearsalGap.liveCoveragePercent
                                      }
                                      %
                                    </div>
                                    <div className="text-[10px] font-mono text-zinc-400">
                                      {brainWiringRehearsalGap.liveStatus}
                                    </div>
                                  </div>
                                </div>
                                {brainWiringRehearsalGap.liveMissingSignals
                                  .length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {brainWiringRehearsalGap.liveMissingSignals.map(
                                      (signal) => (
                                        <span
                                          key={signal}
                                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                                        >
                                          {signal}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="rounded-2xl border border-blue-200 bg-[#14171D] p-4">
                                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
                                  Rehearsed contracts
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                      Request IDs
                                    </div>
                                    <div className="mt-1 space-y-1 text-[10px] font-mono text-zinc-300">
                                      <div className="truncate">
                                        chat{" "}
                                        {brainWiringRehearsal.chatRequestId}
                                      </div>
                                      <div className="truncate">
                                        voice{" "}
                                        {brainWiringRehearsal.voiceRequestId}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                      Context PDFs
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {brainWiringRehearsal.documentIds.map(
                                        (documentId) => (
                                          <span
                                            key={documentId}
                                            className="rounded-full border border-white/10 bg-[#14171D] px-2 py-0.5 text-[10px] font-mono text-zinc-400"
                                          >
                                            {documentId}
                                          </span>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                  {[
                                    {
                                      label: "Chat tools",
                                      tools: brainWiringRehearsal.chatToolNames,
                                    },
                                    {
                                      label: "Voice tools",
                                      tools:
                                        brainWiringRehearsal.voiceToolNames,
                                    },
                                  ].map(({ label, tools }) => (
                                    <div
                                      key={label}
                                      className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
                                    >
                                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                        {label}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {tools.map((toolName) => (
                                          <span
                                            key={toolName}
                                            className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-mono text-blue-700"
                                          >
                                            {toolName.replace(/_/g, " ")}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                    Shared schema checks
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {brainWiringRehearsal.toolContracts.map(
                                      (contract) => (
                                        <span
                                          key={contract.toolName}
                                          title={`Required: ${contract.sharedRequiredParameters.join(", ") || "none"}`}
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                                            contract.ready
                                              ? "border-green-100 bg-green-50 text-green-700"
                                              : "border-red-100 bg-red-50 text-red-700"
                                          }`}
                                        >
                                          {contract.toolName.replace(/_/g, " ")}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                </div>
                                <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                                    Voice-only context
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {brainWiringRehearsal.voiceOnlyToolContracts.map(
                                      (contract) => (
                                        <span
                                          key={contract.toolName}
                                          title={`Required: ${contract.requiredParameters.join(", ") || "none"}; ${contract.chatExcluded ? "excluded from typed-chat parity" : "unexpectedly exposed to typed chat"}`}
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-mono ${
                                            contract.ready
                                              ? "border-green-100 bg-green-50 text-green-700"
                                              : "border-red-100 bg-red-50 text-red-700"
                                          }`}
                                        >
                                          {contract.toolName.replace(/_/g, " ")}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 font-serif">
                                    Typed chat is checked through pre-stream
                                    context injection; live voice also keeps
                                    this local tool so it can inspect study
                                    context mid-session.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {brainWiringRehearsal.checks.map((check) => (
                              <article
                                key={check.id}
                                className={`rounded-2xl border p-3 ${
                                  check.ready
                                    ? "border-green-200 bg-green-50"
                                    : "border-red-200 bg-red-50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                    {check.title}
                                  </div>
                                  {check.ready ? (
                                    <ShieldCheck
                                      size={14}
                                      className="shrink-0 text-green-600"
                                    />
                                  ) : (
                                    <AlertTriangle
                                      size={14}
                                      className="shrink-0 text-red-600"
                                    />
                                  )}
                                </div>
                                <p className="mt-2 text-xs leading-relaxed text-zinc-400 font-serif">
                                  {check.detail}
                                </p>
                              </article>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-[#14171D]/80 p-4 text-sm leading-relaxed text-zinc-400 font-serif">
                          The live readiness meter remains authoritative. Run
                          this only to rehearse local wiring before deliberate
                          provider-key chat and voice turns.
                        </div>
                      )}
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Readiness gates
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              These are local beta review gates, not launch
                              certification. `Watch` means inspect before a
                              broader beta; `blocked` means fix the underlying
                              ledger failures first.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {new Date(
                              betaDiagnosticsSnapshot.generatedAt,
                            ).toLocaleTimeString([], {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </div>
                        </div>

                        <div className="space-y-3">
                          {betaDiagnosticsSnapshot.items.map((item, index) => (
                            <article
                              key={item.id}
                              className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="flex min-w-0 gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                    {item.status === "blocked" ? (
                                      <AlertTriangle size={17} />
                                    ) : item.status === "deferred" ? (
                                      <Clock size={17} />
                                    ) : (
                                      <ShieldCheck size={17} />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                        {item.title}
                                      </h4>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(item.status)}`}
                                      >
                                        {item.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                                      {item.summary}
                                    </p>
                                    {item.action && (
                                      <p className="mt-2 rounded-xl border border-white/10 bg-[#14171D] px-3 py-2 text-xs leading-relaxed text-zinc-400 font-serif">
                                        {item.action}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                {item.count !== undefined && (
                                  <div className="shrink-0 text-right">
                                    <div className="text-lg font-semibold tabular-nums text-zinc-100">
                                      {item.count}
                                    </div>
                                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-zinc-400">
                                      rows
                                    </div>
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-4">
                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Export contents
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                            The JSON export is capped to the local rows already
                            loaded in Admin. It is meant for beta review and
                            debugging, not for backup or cloud migration.
                          </p>
                          <div className="mt-4 space-y-2">
                            {[
                              ["Learning books", learningBooks.length],
                              ["Mapped concepts", learningBookConcepts.length],
                              ["Learning entries", learningEntries.length],
                              ["Book chat threads", bookChatThreads.length],
                              ["Memory events", memoryEvents.length],
                              ["Retrieval events", retrievalEvents.length],
                              ["Correction requests", correctionEvents.length],
                              [
                                "Correction overlay rows",
                                propagatedCorrectionRows,
                              ],
                              ["Source artifacts", artifactRecords.length],
                              ["Citation states", citationStates.length],
                              ["Evidence events", evidenceEvents.length],
                              ["Mastery deltas", masteryDeltas.length],
                              ["Model runs", modelRuns.length],
                              ["Tool jobs", toolJobs.length],
                              ["Background jobs", backgroundJobs.length],
                              ["Trace logs", logs?.length || 0],
                              ["System events", recentSystemEvents.length],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Runtime context
                          </h3>
                          <div className="mt-4 space-y-2">
                            {[
                              ["Active book", activeLearningBookId || "none"],
                              ["Project", activeProject],
                              ["Current model", aiModel],
                              [
                                "Web policy",
                                brainRuntimeSettings.webSearchPolicy,
                              ],
                              [
                                "Tool loops",
                                brainRuntimeSettings.toolIterationLimit,
                              ],
                              [
                                "Memory concepts",
                                brainRuntimeSettings.memoryConceptLimit,
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Out of scope
                          </h3>
                          <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                            {betaDiagnosticsSnapshot.outOfScope.map((item) => (
                              <div
                                key={item}
                                className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                              >
                                {item}
                              </div>
                            ))}
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "retrieval" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <Search size={13} /> Semantic Memory Retrieval
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Retrieval context ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Local records for semantic memory retrieval: query
                            summaries, active-book filters, selected concepts,
                            selected interactions, context size, latency, and
                            failures. This shows what Tutor put into the chat
                            context before a model request.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {retrievalEventCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Durable retrievals
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          ["Completed", completedRetrievalEvents],
                          ["Failed", failedRetrievalEvents],
                          [
                            "Context chars",
                            latestRetrievalEvent?.contextChars || 0,
                          ],
                          [
                            "Selected concepts",
                            latestRetrievalEvent?.selectedConceptIds.length ||
                              0,
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Recent retrievals
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Newest first. These rows explain which memory
                              candidates were available and which ones were
                              injected into Tutor's request context.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestRetrievalEvent?.timestamp)}
                          </div>
                        </div>

                        {retrievalEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No retrieval records yet. Send a chat message and
                            Tutor will persist the memory context selection
                            before the model request starts.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {retrievalEvents.map((event, index) => (
                              <article
                                key={event.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 16 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                  <div className="flex min-w-0 gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14171D] text-blue-600">
                                      <Search size={17} />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                          {event.querySummary}
                                        </h4>
                                        <span
                                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(event.status)}`}
                                        >
                                          {event.status}
                                        </span>
                                      </div>
                                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400 font-serif">
                                        {event.error ||
                                          `${event.selectedConceptIds.length} concepts and ${event.selectedInteractionIds.length} interactions selected from ${event.candidateConceptCount} concepts and ${event.candidateInteractionCount} interactions.`}
                                      </p>
                                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                        <span>{event.source}</span>
                                        {event.activeBookId && (
                                          <span className="max-w-[10rem] truncate">
                                            book {event.activeBookId}
                                          </span>
                                        )}
                                        {requestIdForRetrievalEvent(event) && (
                                          <span className="max-w-[10rem] truncate">
                                            request{" "}
                                            {requestIdForRetrievalEvent(event)}
                                          </span>
                                        )}
                                        {event.durationMs !== undefined && (
                                          <span>{event.durationMs}ms</span>
                                        )}
                                        <span>
                                          context {event.contextChars} chars
                                        </span>
                                        {event.topConceptScore !==
                                          undefined && (
                                          <span>
                                            top concept{" "}
                                            {event.topConceptScore.toFixed(2)}
                                          </span>
                                        )}
                                        {event.topInteractionScore !==
                                          undefined && (
                                          <span>
                                            top interaction{" "}
                                            {event.topInteractionScore.toFixed(
                                              2,
                                            )}
                                          </span>
                                        )}
                                      </div>
                                      {event.selectedConceptNames.length >
                                        0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          {event.selectedConceptNames.map(
                                            (name) => (
                                              <span
                                                key={`${event.id}-${name}`}
                                                className="rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                                              >
                                                {name}
                                              </span>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    <div>{formatTime(event.timestamp)}</div>
                                    {event.pageNumber !== undefined && (
                                      <div className="mt-1">
                                        page {event.pageNumber}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <details className="group mt-3">
                                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                                    <ChevronRight
                                      size={14}
                                      className="transition-transform group-open:rotate-90"
                                    />
                                    Selected ids and metadata
                                  </summary>
                                  <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#14171D] p-3 text-[11px] text-zinc-400 shadow-inner">
                                    {JSON.stringify(
                                      {
                                        selectedConceptIds:
                                          event.selectedConceptIds,
                                        selectedInteractionIds:
                                          event.selectedInteractionIds,
                                        tutorInstructionChars:
                                          event.tutorInstructionChars,
                                        metadata: event.metadata,
                                      },
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </details>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-4">
                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Retrieval meters
                          </h3>
                          <div className="mt-4 space-y-2">
                            {[
                              ["Total context chars", retrievalContextChars],
                              ["Selected concepts", retrievalSelectedConcepts],
                              [
                                "Latest status",
                                latestRetrievalEvent?.status || "waiting",
                              ],
                              [
                                "Latest source",
                                latestRetrievalEvent?.source || "none",
                              ],
                              [
                                "Active book",
                                latestRetrievalEvent?.activeBookId ||
                                  activeLearningBookId ||
                                  "none",
                              ],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                  {label}
                                </span>
                                <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                  {value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Boundary
                          </h3>
                          <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Retrieval Events describe local semantic memory
                              context selection, not web search results.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              Model-run rows still show how much memory context
                              was sent to the provider.
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                              AWS/cloud synchronization remains deferred until
                              beta testing.
                            </div>
                          </div>
                        </section>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "evidence" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-violet-500/70">
                            <BrainCircuit size={13} /> Local Learner Evidence
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Evidence and mastery audit trail
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Durable local records for model-summary evidence,
                            flashcard reviews, evaluated learner answers, and
                            BKT mastery changes. Model summaries can explain why
                            a memory exists; only validated recall evidence
                            should create mastery deltas.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {verifiedEvidenceCount}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Verified events shown
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                        {[
                          ["Evidence Events", evidenceEventCount],
                          ["Model Summaries", modelSummaryEvidenceCount],
                          ["Mastery Deltas", masteryDeltaCount],
                          [
                            "Active Misconceptions",
                            activeMisconceptions.length,
                          ],
                          ["Tool Jobs", toolJobCount],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div
                        className={`mt-4 rounded-2xl border p-4 ${
                          masteryIntegrity.ready
                            ? "border-green-200 bg-green-50"
                            : "border-red-200 bg-red-50"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                              <ShieldCheck size={15} />
                              Mastery ledger integrity
                            </div>
                            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-400 font-serif">
                              {masteryIntegrity.summary}
                            </p>
                            {masteryIntegrity.issues.length > 0 && (
                              <div className="mt-2 text-xs font-mono text-red-700">
                                {masteryIntegrity.issues.join(" | ")}
                              </div>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(masteryIntegrity.status)}`}
                          >
                            {masteryIntegrity.ready
                              ? "atomic audit ready"
                              : "readiness blocked"}
                          </span>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Mastery deltas
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Changes created by validated flashcard or
                              evaluated-answer BKT evidence.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestMasteryDelta?.timestamp)}
                          </div>
                        </div>

                        {masteryDeltas.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No mastery deltas yet. Complete a flashcard review
                            or evaluated answer tied to a concept to create the
                            first audited BKT update.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {masteryDeltas.map((delta, index) => (
                              <article
                                key={delta.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 12 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                        {delta.conceptId}
                                      </h4>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                          delta.correct
                                            ? "border-green-200 bg-green-50 text-green-700"
                                            : "border-orange-200 bg-orange-50 text-orange-700"
                                        }`}
                                      >
                                        {delta.correct ? "correct" : "review"}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                                      {delta.reason}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                      <span>{delta.evidenceType}</span>
                                      <span>
                                        mastery{" "}
                                        {(delta.previousMastery * 100).toFixed(
                                          0,
                                        )}
                                        % to{" "}
                                        {(delta.nextMastery * 100).toFixed(0)}%
                                      </span>
                                      <span>
                                        delta {delta.delta >= 0 ? "+" : ""}
                                        {(delta.delta * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    {formatTime(delta.timestamp)}
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-xl font-serif font-medium text-zinc-100">
                              Evidence events
                            </h3>
                            <p className="mt-1 text-sm text-zinc-400 font-serif">
                              Model summaries are retained as evidence, while
                              evaluated recall attempts carry the rubric and
                              score metadata needed for mastery.
                            </p>
                          </div>
                          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                            {formatTime(latestEvidence?.timestamp)}
                          </div>
                        </div>

                        {evidenceEvents.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                            No durable evidence records yet. Chat graph updates,
                            learning-book updates, flashcard reviews, and
                            evaluated answers will appear here.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {evidenceEvents.map((event, index) => (
                              <article
                                key={event.id}
                                className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 12 ? "admin-animated-item" : ""}`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                        {event.conceptId ||
                                          event.bookId ||
                                          event.source}
                                      </h4>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                          event.verified
                                            ? "border-green-200 bg-green-50 text-green-700"
                                            : "border-white/15 bg-white/[0.06] text-zinc-400"
                                        }`}
                                      >
                                        {event.verified
                                          ? "verified"
                                          : "not mastery evidence"}
                                      </span>
                                    </div>
                                    <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-zinc-400 font-serif">
                                      {event.summary}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                      <span>{event.evidenceType}</span>
                                      <span>{event.source}</span>
                                      {event.confidence !== undefined && (
                                        <span>
                                          confidence{" "}
                                          {(event.confidence * 100).toFixed(0)}%
                                        </span>
                                      )}
                                      {event.correct !== undefined && (
                                        <span>
                                          {event.correct
                                            ? "correct"
                                            : "incorrect"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                    {formatTime(event.timestamp)}
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Misconception candidates
                          </h3>
                          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-400 font-serif">
                            Incorrect evaluated answers can create or
                            consolidate source-linked candidates for Socratic
                            follow-up. Candidates are auditable learner-state
                            hypotheses; they never mutate mastery by themselves.
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-orange-700">
                            {activeMisconceptions.length} active
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                            {sortedMisconceptions.length -
                              activeMisconceptions.length}{" "}
                            resolved
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                            {formatTime(
                              latestMisconception?.updatedAt ||
                                latestMisconception?.createdAt,
                            )}
                          </span>
                        </div>
                      </div>

                      {sortedMisconceptions.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                          No misconception candidates yet. A validated incorrect
                          answer tied to a real concept will create the first
                          source-linked candidate here.
                        </div>
                      ) : (
                        <div className="grid gap-3 xl:grid-cols-2">
                          {sortedMisconceptions.map((misconception, index) => (
                            <article
                              key={misconception.id}
                              className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${index < 12 ? "admin-animated-item" : ""}`}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                      {misconception.concept_id}
                                    </h4>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                        misconception.resolved
                                          ? "border-green-200 bg-green-50 text-green-700"
                                          : "border-orange-200 bg-orange-50 text-orange-700"
                                      }`}
                                    >
                                      {misconception.resolved
                                        ? "resolved"
                                        : misconception.candidateContract
                                          ? "candidate"
                                          : "active"}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-sm leading-relaxed text-zinc-400 font-serif">
                                    {misconception.description}
                                  </p>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                    <span>
                                      evidence {misconception.evidence.length}
                                    </span>
                                    <span>
                                      confidence{" "}
                                      {(misconception.confidence * 100).toFixed(
                                        0,
                                      )}
                                      %
                                    </span>
                                    {misconception.evidenceType && (
                                      <span>{misconception.evidenceType}</span>
                                    )}
                                    {misconception.scoreRatio !== undefined && (
                                      <span>
                                        score{" "}
                                        {(
                                          misconception.scoreRatio * 100
                                        ).toFixed(0)}
                                        %
                                      </span>
                                    )}
                                    {misconception.bookId && (
                                      <span className="max-w-[12rem] truncate">
                                        book {misconception.bookId}
                                      </span>
                                    )}
                                    {misconception.requestId && (
                                      <span className="max-w-[12rem] truncate">
                                        request {misconception.requestId}
                                      </span>
                                    )}
                                    {misconception.source && (
                                      <span>{misconception.source}</span>
                                    )}
                                    {misconception.evaluator && (
                                      <span>{misconception.evaluator}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right text-[10px] font-mono text-zinc-400">
                                  {formatTime(
                                    misconception.updatedAt ||
                                      misconception.createdAt,
                                  )}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-serif font-medium text-zinc-100">
                            Tool jobs
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400 font-serif">
                            Durable local rows from chat-stream tool execution,
                            plus the schema for future retries and dead-letter
                            review.
                          </p>
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-zinc-400">
                          {formatTime(latestToolJob?.timestamp)}
                        </div>
                      </div>

                      {toolJobs.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-6 text-center text-sm text-zinc-400">
                          No durable tool jobs yet. Ask the tutor to use web
                          search, inspect a page, update the graph, or generate
                          flashcards and the chat stream will persist tool
                          execution rows here.
                        </div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                          {toolJobs.map((job) => (
                            <article
                              key={job.id}
                              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h4 className="m-0 truncate text-sm font-semibold text-zinc-100">
                                    {job.toolName}
                                  </h4>
                                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400 font-serif">
                                    {job.outputSummary ||
                                      job.inputSummary ||
                                      job.error ||
                                      "No summary recorded."}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-zinc-400">
                                    {job.requestId && (
                                      <span className="max-w-[9rem] truncate">
                                        {job.requestId}
                                      </span>
                                    )}
                                    {job.durationMs !== undefined && (
                                      <span>{job.durationMs}ms</span>
                                    )}
                                    {job.source && <span>{job.source}</span>}
                                    {job.model && (
                                      <span className="max-w-[9rem] truncate">
                                        {job.model}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTone(job.status)}`}
                                >
                                  {job.status}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                ) : activeTab === "tuning" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                            <SlidersHorizontal size={13} /> Local Runtime
                            Controls
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            Tune the learner-brain runtime
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            These controls are stored locally and sent with chat
                            requests. They tune source-vs-web behavior, model
                            tool loops, memory context size, and Admin polling
                            without touching AWS or cloud deployment paths.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetBrainRuntimeSettings}
                          disabled={runtimeSettingsAreDefault}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:bg-[#1b1f27] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <RotateCcw size={13} />
                          Reset defaults
                        </button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
                        {[
                          [
                            "Web Policy",
                            brainRuntimeSettings.webSearchPolicy.replace(
                              /_/g,
                              " ",
                            ),
                          ],
                          [
                            "Tool Loops",
                            brainRuntimeSettings.toolIterationLimit,
                          ],
                          [
                            "Memory Concepts",
                            brainRuntimeSettings.memoryConceptLimit,
                          ],
                          [
                            "Admin Refresh",
                            `${Math.round(brainRuntimeSettings.activityRefreshMs / 1000)}s`,
                          ],
                          [
                            "Evidence",
                            brainRuntimeSettings.masteryEvidencePolicy.replace(
                              /_/g,
                              " ",
                            ),
                          ],
                          [
                            "BKT Transit",
                            brainRuntimeSettings.bktTransitProbability.toFixed(
                              2,
                            ),
                          ],
                          [
                            "BKT Slip/Guess",
                            `${brainRuntimeSettings.bktSlipProbability.toFixed(2)} / ${brainRuntimeSettings.bktGuessProbability.toFixed(2)}`,
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                              {label}
                            </div>
                            <div className="mt-2 truncate text-lg font-semibold capitalize tabular-nums text-zinc-100">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-blue-500/70">
                          <BrainCircuit size={13} /> Learner-Brain Logic
                        </div>
                        <h3 className="mt-2 text-xl font-serif font-medium text-zinc-100">
                          Evidence and BKT controls
                        </h3>
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                          These local settings travel with chat tool metadata
                          and guide when the tutor may stage evaluated-answer
                          evidence. The current mastery engine still commits
                          against persisted concept BKT fields.
                        </p>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                          <h4 className="m-0 text-sm font-semibold text-zinc-100">
                            Mastery evidence policy
                          </h4>
                          <div className="mt-3 grid gap-3">
                            {masteryEvidencePolicyOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() =>
                                  updateRuntimeSetting(
                                    "masteryEvidencePolicy",
                                    option.id,
                                  )
                                }
                                className={`rounded-2xl border p-4 text-left transition-colors ${
                                  brainRuntimeSettings.masteryEvidencePolicy ===
                                  option.id
                                    ? "border-blue-200 bg-blue-50 text-blue-900 shadow-sm"
                                    : "border-white/10 bg-[#14171D] text-zinc-300 hover:bg-white/[0.06]"
                                }`}
                              >
                                <div className="text-sm font-semibold">
                                  {option.label}
                                </div>
                                <div className="mt-1 text-xs leading-relaxed text-zinc-400 font-serif">
                                  {option.description}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                          <h4 className="m-0 text-sm font-semibold text-zinc-100">
                            BKT prior knobs
                          </h4>
                          <div className="mt-4 grid gap-4 lg:grid-cols-3">
                            {[
                              {
                                key: "bktTransitProbability",
                                label: "BKT transit prior",
                                help: "Chance of learning between attempts.",
                              },
                              {
                                key: "bktSlipProbability",
                                label: "BKT slip prior",
                                help: "Chance of a wrong answer despite knowing.",
                              },
                              {
                                key: "bktGuessProbability",
                                label: "BKT guess prior",
                                help: "Chance of a correct guess while unlearned.",
                              },
                            ].map(({ key, label, help }) => {
                              const settingKey = key as keyof Pick<
                                BrainRuntimeSettings,
                                | "bktTransitProbability"
                                | "bktSlipProbability"
                                | "bktGuessProbability"
                              >;
                              const limits =
                                BRAIN_RUNTIME_SETTING_LIMITS[settingKey];
                              const updateProbability = (
                                event: React.FormEvent<HTMLInputElement>,
                              ) =>
                                updateRuntimeSetting(
                                  settingKey,
                                  Number(event.currentTarget.value),
                                );
                              return (
                                <label
                                  key={key}
                                  className="block rounded-2xl border border-white/10 bg-[#14171D] p-4"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                                      {label}
                                    </span>
                                    <span className="text-sm font-semibold tabular-nums text-zinc-100">
                                      {brainRuntimeSettings[settingKey].toFixed(
                                        2,
                                      )}
                                    </span>
                                  </div>
                                  <input
                                    aria-label={label}
                                    type="range"
                                    min={limits.min}
                                    max={limits.max}
                                    step={limits.step}
                                    value={brainRuntimeSettings[settingKey]}
                                    onInput={updateProbability}
                                    onChange={updateProbability}
                                    className="mt-3 w-full accent-blue-600"
                                  />
                                  <div className="mt-2 text-xs text-zinc-400 font-serif">
                                    {help}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-xl font-serif font-medium text-zinc-100">
                          Web and source policy
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                          Controls when Tutor is allowed to leave the local
                          reading context for live web retrieval.
                        </p>
                        <div className="mt-4 grid gap-3">
                          {webSearchPolicyOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                updateRuntimeSetting(
                                  "webSearchPolicy",
                                  option.id,
                                )
                              }
                              className={`rounded-2xl border p-4 text-left transition-colors ${
                                brainRuntimeSettings.webSearchPolicy ===
                                option.id
                                  ? "border-blue-200 bg-blue-50 text-blue-900 shadow-sm"
                                  : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-[#1b1f27]"
                              }`}
                            >
                              <div className="text-sm font-semibold">
                                {option.label}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-zinc-400 font-serif">
                                {option.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-xl font-serif font-medium text-zinc-100">
                          Runtime budgets
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-zinc-400 font-serif">
                          Bounded local budgets keep tool calls and retrieved
                          concepts inspectable while preserving the tutor's
                          default behavior.
                        </p>

                        <div className="mt-5 space-y-5">
                          <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                                Tool iteration limit
                              </span>
                              <span className="text-sm font-semibold tabular-nums text-zinc-100">
                                {brainRuntimeSettings.toolIterationLimit}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={
                                BRAIN_RUNTIME_SETTING_LIMITS.toolIterationLimit
                                  .min
                              }
                              max={
                                BRAIN_RUNTIME_SETTING_LIMITS.toolIterationLimit
                                  .max
                              }
                              step={
                                BRAIN_RUNTIME_SETTING_LIMITS.toolIterationLimit
                                  .step
                              }
                              value={brainRuntimeSettings.toolIterationLimit}
                              onChange={(event) =>
                                updateRuntimeSetting(
                                  "toolIterationLimit",
                                  Number(event.currentTarget.value),
                                )
                              }
                              className="mt-3 w-full accent-blue-600"
                            />
                            <div className="mt-2 text-xs text-zinc-400 font-serif">
                              Sent to the server as the maximum model/tool
                              follow-up loop for a chat request.
                            </div>
                          </label>

                          <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                                Memory concept limit
                              </span>
                              <span className="text-sm font-semibold tabular-nums text-zinc-100">
                                {brainRuntimeSettings.memoryConceptLimit}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={
                                BRAIN_RUNTIME_SETTING_LIMITS.memoryConceptLimit
                                  .min
                              }
                              max={
                                BRAIN_RUNTIME_SETTING_LIMITS.memoryConceptLimit
                                  .max
                              }
                              step={
                                BRAIN_RUNTIME_SETTING_LIMITS.memoryConceptLimit
                                  .step
                              }
                              value={brainRuntimeSettings.memoryConceptLimit}
                              onChange={(event) =>
                                updateRuntimeSetting(
                                  "memoryConceptLimit",
                                  Number(event.currentTarget.value),
                                )
                              }
                              className="mt-3 w-full accent-blue-600"
                            />
                            <div className="mt-2 text-xs text-zinc-400 font-serif">
                              Controls how many active-book concepts ChatPanel
                              includes in local memory context.
                            </div>
                          </label>

                          <label className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
                                Activity refresh
                              </span>
                              <span className="text-sm font-semibold tabular-nums text-zinc-100">
                                {Math.round(
                                  brainRuntimeSettings.activityRefreshMs / 1000,
                                )}
                                s
                              </span>
                            </div>
                            <input
                              type="range"
                              min={
                                BRAIN_RUNTIME_SETTING_LIMITS.activityRefreshMs
                                  .min
                              }
                              max={
                                BRAIN_RUNTIME_SETTING_LIMITS.activityRefreshMs
                                  .max
                              }
                              step={
                                BRAIN_RUNTIME_SETTING_LIMITS.activityRefreshMs
                                  .step
                              }
                              value={brainRuntimeSettings.activityRefreshMs}
                              onChange={(event) =>
                                updateRuntimeSetting(
                                  "activityRefreshMs",
                                  Number(event.currentTarget.value),
                                )
                              }
                              className="mt-3 w-full accent-blue-600"
                            />
                            <div className="mt-2 text-xs text-zinc-400 font-serif">
                              Controls the System Activity polling interval in
                              this Admin session.
                            </div>
                          </label>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-xl font-serif font-medium text-zinc-100">
                          Model behavior context
                        </h3>
                        <div className="mt-4 space-y-2">
                          {[
                            ["Current model", aiModel],
                            [
                              "System prompt",
                              systemPrompt ? "custom prompt active" : "default",
                            ],
                            [
                              "Search policy",
                              brainRuntimeSettings.webSearchPolicy,
                            ],
                            [
                              "Evidence policy",
                              brainRuntimeSettings.masteryEvidencePolicy,
                            ],
                            [
                              "BKT priors",
                              `${brainRuntimeSettings.bktTransitProbability.toFixed(2)} / ${brainRuntimeSettings.bktSlipProbability.toFixed(2)} / ${brainRuntimeSettings.bktGuessProbability.toFixed(2)}`,
                            ],
                            [
                              "Settings source",
                              "localStorage brain_runtime_settings",
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                            >
                              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                                {label}
                              </span>
                              <span className="min-w-0 truncate text-right text-xs font-semibold text-zinc-100">
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                        <h3 className="text-xl font-serif font-medium text-zinc-100">
                          Local-only contract
                        </h3>
                        <div className="mt-4 grid gap-2 text-sm text-zinc-400 font-serif">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            Runtime settings are persisted in the browser and
                            included in `/api/chat` request metadata.
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            The server normalizes bounds before applying tool
                            iteration, web-search policy, evidence policy, and
                            BKT prior controls.
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                            AWS/cloud rollout remains deferred; this is a local
                            beta tuning surface.
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : activeTab === "traces" ? (
                  <div className="flex flex-col gap-8 font-sans">
                    <section className="rounded-[28px] border border-white/10 bg-[#14171D] p-5 shadow-sm">
                      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-orange-500/70">
                            <Sparkles size={13} /> Trace Evidence
                          </div>
                          <h2 className="mt-2 text-2xl font-serif font-medium text-zinc-100">
                            {learnerName}'s DeepSeek Trace Ledger
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400 font-serif">
                            This ledger shows persisted learning-book updates,
                            concept maps, and saved trace explanations. It does
                            not expose hidden chain-of-thought; each item
                            reflects records written by Tutor after a chat
                            action completes.
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                          <div className="text-2xl font-semibold text-zinc-100">
                            {learningBooks.length}
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                            Books mapped
                          </div>
                        </div>
                      </div>

                      <div className="mb-5 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Trace Events
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {traceCount}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Mapped Concepts
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {mappedConceptCount}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Books With Graphs
                          </div>
                          <div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                            {tracedBookCount}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                            Latest Action
                          </div>
                          <div className="mt-2 truncate font-mono text-sm font-semibold text-zinc-100">
                            {latestTrace?.action || "none"}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-zinc-400">
                            {latestTrace?.timestamp
                              ? new Date(
                                  latestTrace.timestamp,
                                ).toLocaleTimeString([], {
                                  hour12: false,
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })
                              : "waiting"}
                          </div>
                        </div>
                      </div>

                      {learningBooks.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.04] p-8 text-center text-sm text-zinc-400">
                          No learning books yet. Complete a chat and the
                          learning-book agent will map it here.
                        </div>
                      ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                          {learningBooks.map((book, index) => {
                            const concepts = (
                              conceptsByBook[book.id] || []
                            ).slice(0, 8);
                            const latestEntry = latestEntryByBook[book.id];
                            const avgConfidence = concepts.length
                              ? concepts.reduce(
                                  (sum, concept) =>
                                    sum + (concept.confidence || 0),
                                  0,
                                ) / concepts.length
                              : 0;
                            return (
                              <article
                                key={book.id}
                                className={`relative overflow-hidden rounded-[24px] border border-white/10 bg-[#14171D] p-4 shadow-sm ${index < 12 ? "admin-animated-item" : ""}`}
                              >
                                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_10%_0%,rgba(255,110,0,0.04),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(59,130,246,0.03),transparent_38%)]" />
                                <div className="relative">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3">
                                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-orange-500">
                                        <BookOpen size={18} />
                                      </div>
                                      <div>
                                        <h3 className="text-lg font-semibold leading-tight text-zinc-100">
                                          {book.title}
                                        </h3>
                                        <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.14em] text-zinc-400">
                                          {book.conversationCount} chats ·{" "}
                                          {book.agentModel ||
                                            "deepseek/deepseek-v4-flash"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                                      {Math.round(avgConfidence * 100)}%
                                    </div>
                                  </div>

                                  <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-zinc-400 font-serif">
                                    {book.overview ||
                                      book.knowledgeSummary ||
                                      book.summary ||
                                      "Knowledge summary pending."}
                                  </p>

                                  {(book.chapters || []).length > 0 && (
                                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                                        Chapters
                                      </div>
                                      <div className="space-y-2">
                                        {(book.chapters || [])
                                          .slice(-3)
                                          .map((chapter, chapterIndex) => (
                                            <div
                                              key={chapter.id}
                                              className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400"
                                            >
                                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#14171D] border border-white/10 text-[10px] text-orange-500 font-medium">
                                                {chapterIndex + 1}
                                              </span>
                                              <span>
                                                <span className="text-zinc-200 font-medium">
                                                  {chapter.title}
                                                </span>
                                                {chapter.summary && (
                                                  <span className="text-zinc-400">
                                                    {" "}
                                                    · {chapter.summary}
                                                  </span>
                                                )}
                                              </span>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {concepts.length === 0 ? (
                                      <span className="text-xs text-zinc-400 font-serif">
                                        No concepts mapped yet.
                                      </span>
                                    ) : (
                                      concepts.map((concept) => (
                                        <span
                                          key={concept.id}
                                          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#14171D] px-2.5 py-1 text-[11px] font-medium text-zinc-300 shadow-sm"
                                        >
                                          <Network
                                            size={11}
                                            className="text-blue-500"
                                          />
                                          {concept.name}
                                        </span>
                                      ))
                                    )}
                                  </div>

                                  {concepts.some(
                                    (concept) =>
                                      concept.childConcepts.length > 0 ||
                                      concept.parentConcepts.length > 0,
                                  ) && (
                                    <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
                                      {concepts
                                        .filter(
                                          (concept) =>
                                            concept.childConcepts.length > 0 ||
                                            concept.parentConcepts.length > 0,
                                        )
                                        .slice(0, 3)
                                        .map((concept) => (
                                          <div
                                            key={`${concept.id}-branch`}
                                            className="text-xs text-zinc-400"
                                          >
                                            <span className="text-zinc-200 font-medium">
                                              {concept.name}
                                            </span>
                                            {concept.childConcepts.length >
                                              0 && (
                                              <span>
                                                {" "}
                                                branches to{" "}
                                                {concept.childConcepts
                                                  .slice(0, 4)
                                                  .join(", ")}
                                              </span>
                                            )}
                                            {concept.childConcepts.length ===
                                              0 &&
                                              concept.parentConcepts.length >
                                                0 && (
                                                <span>
                                                  {" "}
                                                  sits under{" "}
                                                  {concept.parentConcepts
                                                    .slice(0, 3)
                                                    .join(", ")}
                                                </span>
                                              )}
                                          </div>
                                        ))}
                                    </div>
                                  )}

                                  {latestEntry && (
                                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-relaxed text-zinc-400 font-serif">
                                      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 font-sans">
                                        Latest update ·{" "}
                                        {new Date(
                                          latestEntry.timestamp,
                                        ).toLocaleTimeString()}
                                      </div>
                                      {latestEntry.conversationSummary ||
                                        latestEntry.assistantSummary}
                                    </div>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {!logs || logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-white/10 bg-[#14171D] px-6 py-16 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-blue-600">
                          <Activity size={20} />
                        </div>
                        <div className="font-serif text-lg italic text-zinc-300">
                          No trace records yet.
                        </div>
                        <div className="max-w-md text-sm leading-relaxed text-zinc-400">
                          Saved trace explanations will appear here after Tutor
                          writes a trace log from a completed learning action.
                        </div>
                      </div>
                    ) : (
                      logs.map((log, index) => {
                        const animateTraceRow = index < 24;
                        return (
                          <div
                            key={log.id}
                            className={`relative pl-8 pb-8 ${animateTraceRow ? "admin-animated-item" : ""}`}
                          >
                            <div
                              className="absolute left-[0px] top-4 w-[2px] bg-white/10"
                              style={{ height: "100%" }}
                            />
                            <div className="absolute w-3 h-3 rounded-full bg-blue-500 border-2 border-white/10 shadow-sm -left-[5px] top-1 z-10" />

                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-xs font-mono text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 font-medium">
                                {log.action}
                              </span>
                              <span className="text-xs text-zinc-400 flex items-center gap-1.5 font-mono">
                                <Clock size={12} />{" "}
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                            </div>

                            <div className="text-[15px] text-zinc-200 mb-4 leading-relaxed mt-3 bg-[#14171D] p-5 rounded-xl border border-white/10 shadow-sm font-serif">
                              {log.llmExplanation}
                            </div>

                            <details className="group">
                              <summary className="text-xs font-mono text-zinc-400 cursor-pointer hover:text-zinc-200 transition-colors flex items-center gap-1.5 select-none font-medium">
                                <ChevronRight
                                  size={14}
                                  className="group-open:rotate-90 transition-transform"
                                />
                                Raw JSON Payload
                              </summary>
                              <pre className="mt-3 text-[11px] text-zinc-400 bg-white/[0.04] p-4 rounded-xl overflow-x-auto border border-white/10 font-mono shadow-inner">
                                {JSON.stringify(log.payload, null, 2)}
                              </pre>
                            </details>
                          </div>
                        );
                      })
                    )}
                    {logs && logs.length > 0 && logs.length < traceCount && (
                      <div className="flex justify-center pt-2">
                        <button
                          type="button"
                          onClick={() =>
                            setTraceLimit((limit) => limit + TRACE_PAGE_SIZE)
                          }
                          className="rounded-full border border-white/10 bg-[#14171D] px-4 py-2 text-xs font-semibold text-zinc-400 shadow-sm transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
                        >
                          Load more traces
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    ref={consoleRef}
                    className="bg-[#111] border border-zinc-800 rounded-2xl p-6 font-mono text-[11px] sm:text-xs leading-relaxed custom-scroll h-[600px] overflow-y-auto shadow-inner text-zinc-300"
                  >
                    {serverLogs.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-zinc-400 italic">
                        Awaiting server output...
                      </div>
                    ) : (
                      serverLogs.map((log, i) => (
                        <div
                          key={i}
                          className="mb-2 flex gap-4 hover:bg-white/5 px-2 py-1.5 rounded transition-colors"
                        >
                          <span className="text-zinc-400 shrink-0 select-none">
                            {new Date(log.time).toLocaleTimeString([], {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                          <span
                            className={`break-words ${
                              log.type === "error"
                                ? "text-red-400"
                                : log.type === "warn"
                                  ? "text-yellow-400"
                                  : "text-zinc-300"
                            }`}
                          >
                            {log.msg}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
