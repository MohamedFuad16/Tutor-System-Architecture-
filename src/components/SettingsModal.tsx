import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import {
  BarChart3,
  Coins,
  Settings,
  X,
  Key,
  Loader2,
  Mic,
  AlertCircle,
  Globe2,
  UserRound,
  MessageSquare,
  RotateCcw,
  Search,
  Volume2,
  Crown,
  Gauge,
  ShieldCheck,
  TimerReset,
  UserCog,
} from "lucide-react";
import { useStore, type VoiceMode } from "../store";
import { useTranslation } from "../lib/translations";
import { useMotionPreference } from "../hooks/useMotionPreference";
import {
  type AccessMode,
  type PlanTier,
  estimateServiceMinutes,
  formatServiceTime,
  getPlanOption,
  planOptions,
  serviceMilestones,
} from "../lib/accessPlans";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatCount = (value: number) => {
  const n = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toString();
};

const planCardMeta: Record<
  PlanTier,
  { eyebrow: string; promise: string; badge: string }
> = {
  free: {
    eyebrow: "Starter",
    promise: "Quick tutor checks with enough room for light PDF study.",
    badge: "Included",
  },
  plus: {
    eyebrow: "Focused",
    promise: "Longer reading sessions, richer tutor turns, and recall work.",
    badge: "Popular",
  },
  pro: {
    eyebrow: "Research",
    promise: "Heavy document analysis, voice, search, and revision cycles.",
    badge: "Max",
  },
};

const UsageGraphBar = ({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) => {
  const width = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 4;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        <span>{label}</span>
        <span className="font-mono text-zinc-300">{formatCount(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          style={{ width: `${width}%` }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
};

function UsageInsightsPanel() {
  const chatUsage = useStore((state) => state.chatUsage);
  const voiceUsage = useStore((state) => state.voiceUsage);
  const webUsage = useStore((state) => state.webUsage);
  const resetUsageAnalytics = useStore((state) => state.resetUsageAnalytics);

  const inputTokens = chatUsage.inputTokens;
  const outputTokens = chatUsage.outputTokens;
  const chatTotal = inputTokens + outputTokens;
  const voiceUnits =
    voiceUsage.connectionSeconds + voiceUsage.ttsCharacters / 80;
  const totalCost = chatUsage.cost + voiceUsage.cost + webUsage.cost;
  const maxGraphValue = Math.max(
    inputTokens,
    outputTokens,
    webUsage.requests,
    1,
  );
  const costSegments = [
    {
      key: "chat",
      label: "Chat",
      value: chatUsage.cost,
      color: "bg-[#ff6e00]",
    },
    {
      key: "voice",
      label: "Voice",
      value: voiceUsage.cost,
      color: "bg-white/70",
    },
    {
      key: "search",
      label: "Search",
      value: webUsage.cost,
      color: "bg-white/40",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        <div className="relative p-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,110,0,0.22),transparent_34%),radial-gradient(circle_at_90%_110%,rgba(34,211,238,0.16),transparent_38%)]" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                <Coins size={13} className="text-[#ff6e00]" />
                Session Cost
              </div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {formatCurrency(totalCost)}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {formatCount(chatTotal)} chat tokens ·{" "}
                {formatCount(webUsage.requests)} web calls
              </div>
            </div>
            <button
              type="button"
              onClick={resetUsageAnalytics}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>

          <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="flex h-full w-full">
              {costSegments.map((segment) => (
                <div
                  key={segment.key}
                  style={{
                    width:
                      totalCost > 0
                        ? `${Math.max(3, (segment.value / totalCost) * 100)}%`
                        : "33.333%",
                  }}
                  className={`${segment.color} transition-[width] duration-500 ease-out`}
                  title={`${segment.label}: ${formatCurrency(segment.value)}`}
                />
              ))}
            </div>
          </div>
          <div className="relative mt-3 flex flex-wrap gap-2 text-[10px] text-zinc-500">
            {costSegments.map((segment) => (
              <span
                key={segment.key}
                className="inline-flex items-center gap-1.5"
              >
                <span className={`h-2 w-2 rounded-full ${segment.color}`} />
                {segment.label} {formatCurrency(segment.value)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <MessageSquare size={15} className="text-[#ff6e00]" />
            Chat Tokens
          </div>
          <div className="space-y-3">
            <UsageGraphBar
              label="Input"
              value={inputTokens}
              max={maxGraphValue}
              color="bg-[#ff6e00] shadow-[0_0_18px_rgba(255,110,0,0.45)]"
            />
            <UsageGraphBar
              label="Output"
              value={outputTokens}
              max={maxGraphValue}
              color="bg-white/80"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
            <div className="rounded-xl bg-white/[0.04] p-2">
              Model
              <div className="mt-1 truncate font-mono text-zinc-300">
                {chatUsage.model || "unknown"}
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-2">
              Requests
              <div className="mt-1 font-mono text-zinc-300">
                {formatCount(chatUsage.requests)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
              <Volume2 size={15} className="text-zinc-400" />
              Voice
            </div>
            <div className="text-xl font-semibold text-white">
              {formatCount(Math.round(voiceUnits))}
            </div>
            <div className="text-xs text-zinc-500">billable units</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#121214] p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
              <Search size={15} className="text-zinc-400" />
              Search
            </div>
            <div className="text-xl font-semibold text-white">
              {formatCount(webUsage.sourcesReviewed)}
            </div>
            <div className="text-xs text-zinc-500">sources reviewed</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserUsagePanel({
  showPlanSelector = true,
  showMilestones = true,
}: {
  showPlanSelector?: boolean;
  showMilestones?: boolean;
}) {
  const chatUsage = useStore((state) => state.chatUsage);
  const voiceUsage = useStore((state) => state.voiceUsage);
  const webUsage = useStore((state) => state.webUsage);
  const planTier = useStore((state) => state.planTier);
  const setPlanTier = useStore((state) => state.setPlanTier);
  const plan = getPlanOption(planTier);
  const usedRequests = chatUsage.requests + webUsage.requests;
  const remainingRequests = Math.max(0, plan.dailyRequests - usedRequests);
  const serviceMinutes = estimateServiceMinutes({
    chatRequests: chatUsage.requests,
    webRequests: webUsage.requests,
    voiceSeconds: voiceUsage.connectionSeconds,
  });
  const serviceProgress = Math.min(100, (serviceMinutes / 180) * 100);
  const usedPercent = Math.max(
    0,
    Math.min(100, (usedRequests / Math.max(1, plan.dailyRequests)) * 100),
  );
  const reachedMilestones = serviceMilestones.filter(
    (milestone) => serviceMinutes >= milestone.minutes,
  );
  const currentMilestone =
    reachedMilestones[reachedMilestones.length - 1] || serviceMilestones[0];
  const nextMilestone =
    serviceMilestones.find((milestone) => serviceMinutes < milestone.minutes) ||
    null;

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#101012] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(255,110,0,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_42%)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              <Gauge size={13} className="text-[#ff6e00]" />
              {plan.name} allowance
            </div>
            <div className="mt-4 flex items-end gap-3">
              <span className="text-4xl font-semibold leading-none tracking-tight text-white">
                {formatCount(remainingRequests)}
              </span>
              <span className="pb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
                left today
              </span>
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              {formatCount(usedRequests)} used of{" "}
              {formatCount(plan.dailyRequests)} daily tutor requests.
            </div>
          </div>
          <div className="w-full rounded-2xl border border-white/10 bg-black/25 p-3 sm:w-44">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              <span>Limit used</span>
              <span className="text-zinc-300">{Math.round(usedPercent)}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                style={{ width: `${Math.max(4, usedPercent)}%` }}
                className="h-full rounded-full bg-gradient-to-r from-[#ff6e00] via-[#ff9a3c] to-white shadow-[0_0_20px_rgba(255,110,0,0.35)] transition-[width] duration-500 ease-out"
              />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
              <ShieldCheck size={13} className="text-[#ffb17a]" />
              Rate limited per browser
            </div>
          </div>
        </div>
      </div>

      {showMilestones && (
        <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,110,0,0.13),transparent_32%),radial-gradient(circle_at_92%_100%,rgba(255,255,255,0.08),transparent_34%)]" />
          <div className="relative mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <TimerReset size={15} className="text-zinc-300" />
                Service milestones
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {formatServiceTime(serviceMinutes)} studied in this browser.
              </div>
            </div>
            <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
              {nextMilestone
                ? `${nextMilestone.label} next`
                : `${currentMilestone.label} complete`}
            </div>
          </div>
          <div className="relative">
            <div className="absolute left-3 right-3 top-[1.35rem] h-px bg-white/10" />
            <div
              style={{ width: `${serviceProgress}%` }}
              className="absolute left-3 top-[1.35rem] h-px max-w-[calc(100%-1.5rem)] bg-gradient-to-r from-[#ff6e00] to-white shadow-[0_0_18px_rgba(255,110,0,0.24)] transition-[width] duration-700 ease-out"
            />
            <div className="relative grid grid-cols-3 gap-2">
              {serviceMilestones.map((milestone, index) => {
                const reached = serviceMinutes >= milestone.minutes;
                const active =
                  reached ||
                  (!reached &&
                    serviceMilestones.findIndex(
                      (item) => serviceMinutes < item.minutes,
                    ) === index);
                return (
                  <div key={milestone.label} className="min-w-0">
                    <div
                      className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-full border transition-[color,background-color,border-color,box-shadow,transform,opacity] ${
                        reached
                          ? "border-[#ffb17a]/80 bg-[#ff6e00] text-white shadow-[0_0_24px_rgba(255,110,0,0.34)]"
                          : active
                            ? "border-white/20 bg-white/[0.08] text-zinc-200"
                            : "border-white/10 bg-black/30 text-zinc-600"
                      }`}
                    >
                      <TimerReset size={15} />
                    </div>
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-2.5 py-2 text-center">
                      <div
                        className={`text-[12px] font-semibold ${
                          reached ? "text-white" : "text-zinc-500"
                        }`}
                      >
                        {milestone.label}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-zinc-600">
                        {reached ? "Reached" : "Locked"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showPlanSelector && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {planOptions.map((option) => {
            const selected = option.id === planTier;
            const meta = planCardMeta[option.id];
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setPlanTier(option.id)}
                className={`group relative overflow-hidden rounded-[24px] border p-4 text-left transition-[color,background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 active:scale-[0.98] ${
                  selected
                    ? "border-[#ff8d3a]/70 bg-white/[0.08] shadow-[0_18px_50px_rgba(255,110,0,0.1),inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.07),transparent_42%)] opacity-80" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff6e00] to-transparent opacity-80" />
                <div className="relative flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Crown size={15} style={{ color: option.accent }} />
                      {option.name}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                      {meta.eyebrow}
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${
                      selected
                        ? "border-[#ffb17a]/40 bg-[#ff6e00]/15 text-[#ffb17a]"
                        : "border-white/10 bg-black/20 text-zinc-500"
                    }`}
                  >
                    {meta.badge}
                  </span>
                </div>
                <div className="relative mt-5 text-3xl font-semibold leading-none text-white">
                  {formatCount(option.dailyRequests)}
                </div>
                <div className="relative mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  daily requests
                </div>
                <p className="relative mt-4 min-h-[3rem] text-xs leading-relaxed text-zinc-500">
                  {meta.promise}
                </p>
                <div className="relative mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[11px] text-zinc-500">
                  <span>{option.description}</span>
                  {selected && (
                    <ShieldCheck
                      size={15}
                      className="shrink-0 text-[#ffb17a]"
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();
  const motionEnabled = useMotionPreference();
  const {
    accessMode,
    setAccessMode,
    apiKey,
    setApiKey,
    serperApiKey,
    setSerperApiKey,
    deepgramApiKey,
    setDeepgramApiKey,
    learnerName,
    setLearnerName,
    ttsVoice,
    setTtsVoice,
    misoTtsApiUrl,
    setMisoTtsApiUrl,
    voiceMode,
    setVoiceMode,
    aiModel,
    setAiModel,
    animationsEnabled,
    setAnimationsEnabled,
    systemPrompt,
    setSystemPrompt,
    language,
    setLanguage,
    activeView,
    setActiveView,
  } = useStore();
  const [inputKey, setInputKey] = useState(apiKey);
  const [inputSerperKey, setInputSerperKey] = useState(serperApiKey);
  const [inputDeepgramKey, setInputDeepgramKey] = useState(deepgramApiKey);
  const [inputLearnerName, setInputLearnerName] = useState(learnerName);
  const [inputVoice, setInputVoice] = useState(ttsVoice || "gpt-4o-mini-tts");
  const [inputMisoTtsApiUrl, setInputMisoTtsApiUrl] = useState(
    misoTtsApiUrl || "http://127.0.0.1:8080",
  );
  const [inputModel, setInputModel] = useState(aiModel || "gpt-4o-mini");
  const [inputAnimations, setInputAnimations] = useState(animationsEnabled);
  const [inputPrompt, setInputPrompt] = useState(systemPrompt || "");
  const [inputLanguage, setInputLanguage] = useState(language || "en");
  const [personaDesc, setPersonaDesc] = useState("");
  const [isGeneratingPersona, setIsGeneratingPersona] = useState(false);
  const [personaStatus, setPersonaStatus] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState<AccessMode | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "persona" | "usage">(
    "general",
  );
  const settingsBorderRef = useRef<HTMLDivElement | null>(null);
  const modalBackdropRef = useRef<HTMLDivElement | null>(null);
  const modalFrameRef = useRef<HTMLDivElement | null>(null);
  const tabPanelRef = useRef<HTMLDivElement | null>(null);
  const settingsTabBarRef = useRef<HTMLDivElement | null>(null);
  const settingsTabPillRef = useRef<HTMLSpanElement | null>(null);
  const settingsTabButtonRefs = useRef<
    Record<"general" | "persona" | "usage", HTMLButtonElement | null>
  >({
    general: null,
    persona: null,
    usage: null,
  });
  const switchingOverlayRef = useRef<HTMLDivElement | null>(null);
  const switchingCardRef = useRef<HTMLDivElement | null>(null);

  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const TTS_VOICES = [
    { id: "miso-tts-8b", name: "MisoTTS 8B (Vast local API)" },
    { id: "gpt-4o-mini-tts", name: "OpenAI gpt-4o-mini-tts (Premium)" },
    { id: "aura-asteria-en", name: "Asteria (Clear)" },
    { id: "aura-luna-en", name: "Luna (Warm)" },
    { id: "aura-stella-en", name: "Stella (Bright)" },
    { id: "aura-athena-en", name: "Athena (Measured)" },
    { id: "aura-hera-en", name: "Hera (Expressive)" },
    { id: "aura-orion-en", name: "Orion (Male)" },
    { id: "aura-arcas-en", name: "Arcas (Deep)" },
    { id: "aura-perseus-en", name: "Perseus (Authoritative)" },
    { id: "aura-angus-en", name: "Angus (Friendly)" },
    { id: "aura-orpheus-en", name: "Orpheus (Narrator)" },
    { id: "aura-helios-en", name: "Helios (Crisp)" },
    { id: "aura-zeus-en", name: "Zeus (Bold)" },
  ];

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      setInputKey(apiKey);
      setInputSerperKey(serperApiKey);
      setInputDeepgramKey(deepgramApiKey);
      setInputLearnerName(learnerName);
      setInputVoice(ttsVoice || "gpt-4o-mini-tts");
      setInputMisoTtsApiUrl(misoTtsApiUrl || "http://127.0.0.1:8080");
      setInputModel(aiModel || "gpt-4o-mini");
      setInputAnimations(animationsEnabled);
      setInputPrompt(systemPrompt || "");
      setInputLanguage(language || "en");
      setValidationError(null);
      setPersonaStatus(null);
      setActiveTab("general");
    }
  }, [
    isOpen,
    apiKey,
    serperApiKey,
    deepgramApiKey,
    learnerName,
    ttsVoice,
    misoTtsApiUrl,
    aiModel,
    animationsEnabled,
    systemPrompt,
    language,
  ]);

  useEffect(() => {
    const border = settingsBorderRef.current;
    if (!border) return;
    gsap.killTweensOf(border);
    gsap.set(border, { rotate: 0 });
    if (!motionEnabled) return;
    const tween = gsap.to(border, {
      rotate: 360,
      duration: 4,
      repeat: -1,
      ease: "none",
    });
    return () => {
      tween.kill();
    };
  }, [motionEnabled]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    if (modalBackdropRef.current) {
      gsap.fromTo(
        modalBackdropRef.current,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration: motionEnabled ? 0.16 : 0,
          ease: "power2.out",
        },
      );
    }
    if (modalFrameRef.current) {
      gsap.fromTo(
        modalFrameRef.current,
        { autoAlpha: 0, y: 16, scale: 0.975, filter: "blur(8px)" },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: motionEnabled ? 0.28 : 0,
          ease: "power4.out",
        },
      );
    }
  }, [isOpen, motionEnabled]);

  useLayoutEffect(() => {
    const panel = tabPanelRef.current;
    if (!panel) return;
    gsap.killTweensOf(panel);
    gsap.fromTo(
      panel,
      { autoAlpha: 0, y: 10, filter: "blur(6px)" },
      {
        autoAlpha: 1,
        y: 0,
        filter: "blur(0px)",
        duration: motionEnabled ? 0.18 : 0,
        ease: "power2.out",
      },
    );
  }, [activeTab, motionEnabled]);

  useLayoutEffect(() => {
    const bar = settingsTabBarRef.current;
    const pill = settingsTabPillRef.current;
    const activeButton = settingsTabButtonRefs.current[activeTab];
    if (!bar || !pill || !activeButton) return;
    const barRect = bar.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    gsap.killTweensOf(pill);
    gsap.to(pill, {
      autoAlpha: 1,
      x: buttonRect.left - barRect.left,
      y: buttonRect.top - barRect.top,
      width: buttonRect.width,
      height: buttonRect.height,
      duration: motionEnabled ? 0.2 : 0,
      ease: "power3.out",
    });
  }, [activeTab, motionEnabled]);

  useLayoutEffect(() => {
    if (!switchingMode) return;
    if (switchingOverlayRef.current) {
      gsap.fromTo(
        switchingOverlayRef.current,
        { autoAlpha: 0, filter: "blur(10px)" },
        {
          autoAlpha: 1,
          filter: "blur(0px)",
          duration: motionEnabled ? 0.18 : 0,
          ease: "power2.out",
        },
      );
    }
    if (switchingCardRef.current) {
      gsap.fromTo(
        switchingCardRef.current,
        { y: 18, scale: 0.96 },
        {
          y: 0,
          scale: 1,
          duration: motionEnabled ? 0.28 : 0,
          ease: "power4.out",
        },
      );
    }
  }, [motionEnabled, switchingMode]);

  const handleAccessModeChange = (mode: AccessMode) => {
    if (mode === accessMode || switchingMode) return;
    setSwitchingMode(mode);
    setAccessMode(mode);
    if (mode === "user" && activeView === "admin") {
      setActiveView("study");
    }
    window.setTimeout(
      () => {
        window.location.reload();
      },
      motionEnabled ? 480 : 120,
    );
  };

  const handleSave = async () => {
    setValidationError(null);
    const trimmedSerperKey = inputSerperKey.trim();
    const trimmedDeepgramKey = inputDeepgramKey.trim();
    const trimmedMisoTtsApiUrl = inputMisoTtsApiUrl.trim();

    if (accessMode === "user") {
      setLearnerName(inputLearnerName);
      setAnimationsEnabled(inputAnimations);
      setLanguage(inputLanguage);
      setIsOpen(false);
      return;
    }

    // Auto-save if key is empty
    if (!inputKey || inputKey.trim() === "") {
      setApiKey("");
      setSerperApiKey(trimmedSerperKey);
      setDeepgramApiKey(trimmedDeepgramKey);
      setLearnerName(inputLearnerName);
      setTtsVoice(inputVoice);
      setMisoTtsApiUrl(trimmedMisoTtsApiUrl);
      setAiModel(inputModel);
      setAnimationsEnabled(inputAnimations);
      setSystemPrompt(inputPrompt);
      setLanguage(inputLanguage);
      setIsOpen(false);
      return;
    }

    setIsValidating(true);
    try {
      setSerperApiKey(trimmedSerperKey);
      // Ping the models endpoint to verify API key integrity
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${inputKey}`,
          "HTTP-Referer": window.location.href,
          "X-Title": "Cosmic Obsidian AI Tutor",
        },
      });

      if (!res.ok) {
        setValidationError("Invalid API Key or OpenRouter is unreachable.");
        setIsValidating(false);
        return;
      }

      setApiKey(inputKey);
      setSerperApiKey(trimmedSerperKey);
      setDeepgramApiKey(trimmedDeepgramKey);
      setLearnerName(inputLearnerName);
      setTtsVoice(inputVoice);
      setMisoTtsApiUrl(trimmedMisoTtsApiUrl);
      setAiModel(inputModel);
      setAnimationsEnabled(inputAnimations);
      setSystemPrompt(inputPrompt);
      setLanguage(inputLanguage);
      setIsOpen(false);
    } catch (err: any) {
      setValidationError(
        err.message || "Network error. Failed to validate key.",
      );
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("app_settings")}
        onClick={() => setIsOpen(true)}
        className="fixed right-4 top-[4.35rem] z-50 flex h-[42px] w-[42px] items-center justify-center overflow-visible rounded-full p-[1px] transition-[color,background-color,border-color,box-shadow,transform,opacity] focus:outline-none group sm:right-8 sm:top-8 sm:h-[46px] sm:w-[46px]"
        style={{
          boxShadow:
            "0 20px 50px -10px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.1)",
        }}
      >
        {/* Animated Liquid Metal Border */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none overflow-hidden"
          style={{
            padding: "1px",
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
          }}
        >
          <div
            ref={settingsBorderRef}
            className="absolute inset-[-50%] w-[200%] h-[200%]"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.1) 60%, transparent 100%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent mix-blend-overlay" />
        </div>

        <div
          className="w-full h-full rounded-full flex items-center justify-center group-hover:bg-white/5 transition-colors relative"
          style={{
            background:
              activeView === "revision"
                ? "rgba(10, 10, 12, 0.85)"
                : "rgba(28, 28, 30, 0.4)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <Settings
            size={20}
            className="relative z-10 transition-[transform,color] group-hover:rotate-45 duration-700 ease-out text-zinc-400 group-hover:text-zinc-200 focus:outline-none"
          />
        </div>
      </button>

      {isOpen && (
        <>
          <div
            ref={modalBackdropRef}
            onClick={() => {
              if (!isValidating) setIsOpen(false);
            }}
            className="fixed inset-0 z-[100] bg-black/64 backdrop-blur-sm"
          />
          <div
            ref={modalFrameRef}
            className="fixed inset-0 z-[101] flex items-center justify-center px-3 py-4 pointer-events-none sm:px-6"
          >
            <div className="pointer-events-auto relative flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-[28px] border border-white/10 bg-[#09090b]/95 p-4 shadow-[0_34px_110px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl sm:gap-5 sm:rounded-[30px] sm:p-6">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),transparent_42%)]" />
              <div className="flex justify-between items-center">
                <h2 className="relative z-10 text-xl font-medium tracking-tight text-white flex items-center gap-2">
                  <Settings size={20} className="text-[#ff6e00]" />
                  {t("app_settings")}
                </h2>
                <button
                  type="button"
                  aria-label="Close settings"
                  onClick={() => {
                    if (!isValidating) setIsOpen(false);
                  }}
                  className="relative z-10 rounded-full p-1 text-zinc-500 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
                  disabled={isValidating}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="relative z-10 overflow-visible rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_11.5rem] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <UserCog size={15} className="text-[#ff6e00]" />
                      Access style
                    </div>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
                      User mode shows plan limits and milestones. Admin keeps
                      the developer controls available.
                    </p>
                  </div>
                  <div className="grid h-9 w-full max-w-[11.5rem] grid-cols-2 gap-0.5 justify-self-stretch overflow-hidden rounded-full border border-white/10 bg-black/35 p-0.5 sm:justify-self-end">
                    {(["user", "admin"] as AccessMode[]).map((mode) => {
                      const selected = accessMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleAccessModeChange(mode)}
                          disabled={Boolean(switchingMode)}
                          className={`relative rounded-full px-1.5 text-[11px] font-semibold capitalize transition-[color,background-color,border-color,box-shadow] disabled:cursor-wait ${
                            selected
                              ? "border border-white/10 bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                              : "text-zinc-500 hover:text-zinc-200"
                          }`}
                        >
                          <span className="relative z-10">{mode}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                ref={settingsTabBarRef}
                className="relative z-10 flex rounded-full border border-white/10 bg-white/[0.05] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              >
                <span
                  ref={settingsTabPillRef}
                  className="pointer-events-none absolute left-0 top-0 z-10 rounded-full border border-white/10 bg-white/[0.09] opacity-0 shadow-[0_10px_24px_rgba(0,0,0,0.25)]"
                />
                <button
                  type="button"
                  ref={(node) => {
                    settingsTabButtonRefs.current.general = node;
                  }}
                  onClick={() => setActiveTab("general")}
                  className={`relative z-20 flex-1 rounded-full px-3 py-2 text-sm font-medium transition-[color,background-color,box-shadow] ${
                    activeTab === "general"
                      ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {t("general")}
                </button>
                <button
                  type="button"
                  ref={(node) => {
                    settingsTabButtonRefs.current.usage = node;
                  }}
                  onClick={() => setActiveTab("usage")}
                  className={`relative z-20 flex-1 rounded-full px-3 py-2 text-sm font-medium transition-[color,background-color,box-shadow] ${
                    activeTab === "usage"
                      ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {t("usage")}
                </button>
                <button
                  type="button"
                  ref={(node) => {
                    settingsTabButtonRefs.current.persona = node;
                  }}
                  onClick={() => setActiveTab("persona")}
                  className={`relative z-20 flex-1 rounded-full px-3 py-2 text-sm font-medium transition-[color,background-color,box-shadow] ${
                    activeTab === "persona"
                      ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                      : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {t("persona_studio")}
                </button>
              </div>

              <div className="custom-scrollbar relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden pr-2">
                {activeTab === "general" && (
                  <div
                    ref={tabPanelRef}
                    key="general"
                    className="flex flex-col gap-5"
                  >
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="settings-language"
                        className="text-sm font-medium text-zinc-300 flex items-center gap-2"
                      >
                        <Globe2 size={14} className="text-zinc-400" />
                        {t("language")}
                      </label>
                      <select
                        id="settings-language"
                        value={inputLanguage}
                        onChange={(e) => setInputLanguage(e.target.value)}
                        disabled={isValidating}
                        className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="en">English (US)</option>
                        <option value="ja">日本語 (Japanese)</option>
                        <option value="ko">한국어 (Korean)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="settings-learner-name"
                        className="text-sm font-medium text-zinc-300 flex items-center gap-2"
                      >
                        <UserRound size={14} className="text-zinc-400" />
                        {t("learner_name")}
                      </label>
                      <input
                        id="settings-learner-name"
                        type="text"
                        value={inputLearnerName}
                        onChange={(e) => setInputLearnerName(e.target.value)}
                        placeholder="Your name"
                        disabled={isValidating}
                        className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] disabled:opacity-50"
                      />
                      <p className="text-xs text-zinc-500 leading-relaxed">
                        Used as the root node of your virtual brain map and
                        DeepSeek trace cards.
                      </p>
                    </div>

                    {accessMode === "user" ? (
                      <UserUsagePanel
                        showPlanSelector={false}
                        showMilestones={false}
                      />
                    ) : (
                      <>
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Key size={14} className="text-zinc-400" />
                            {t("openrouter_key")}
                          </label>
                          <input
                            type="password"
                            value={inputKey}
                            onChange={(e) => setInputKey(e.target.value)}
                            placeholder="sk-or-v1-..."
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] font-mono disabled:opacity-50"
                          />
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            Your key is stored locally in your browser's
                            localStorage and is sent as a bearer key only for
                            your own AI requests. Hosted deployments use this
                            key by default; a server OpenRouter key is used only
                            when the deployment owner explicitly enables the
                            shared fallback.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Globe2 size={14} className="text-zinc-400" />
                            {t("serper_key")}
                          </label>
                          <input
                            type="password"
                            value={inputSerperKey}
                            onChange={(e) => setInputSerperKey(e.target.value)}
                            placeholder="SERPER_API_KEY"
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] font-mono disabled:opacity-50"
                          />
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            Stored locally and sent only to this app's backend
                            when live web search is needed. Server environment
                            keys still work as a fallback.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Mic size={14} className="text-zinc-400" />
                            Voice mode
                          </label>
                          <select
                            value={voiceMode}
                            onChange={(e) =>
                              setVoiceMode(e.target.value as VoiceMode)
                            }
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="deepgram-duplex">
                              Deepgram duplex — two-model (default)
                            </option>
                            <option value="deepgram-agent">
                              Deepgram Voice Agent — single model
                            </option>
                            <option value="openai-realtime">
                              OpenAI Realtime — test / comparison
                            </option>
                          </select>
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            {voiceMode === "deepgram-duplex"
                              ? "Default. A fast foreground model keeps the conversation moving while a background model does the heavy lifting. Needs a Deepgram key plus an OpenAI or OpenRouter key; runs in this app's own server — no separate host."
                              : voiceMode === "deepgram-agent"
                                ? "A single Deepgram Voice Agent handles speech and reasoning end to end."
                                : "Test / comparison only — connects your browser straight to OpenAI's Realtime API over WebRTC for true full-duplex speech. Uses your OpenAI key and is billed at premium realtime rates."}
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Mic size={14} className="text-zinc-400" />
                            {t("deepgram_key")}
                          </label>
                          <input
                            type="password"
                            value={inputDeepgramKey}
                            onChange={(e) =>
                              setInputDeepgramKey(e.target.value)
                            }
                            placeholder="DEEPGRAM_API_KEY"
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] font-mono disabled:opacity-50"
                          />
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            Stored locally and sent only to this app's backend
                            for voice and Deepgram read-aloud requests. Server
                            environment keys still work as a fallback.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Mic size={14} className="text-zinc-400" />
                            {t("tts_voice")}
                          </label>
                          <select
                            value={inputVoice}
                            onChange={(e) => setInputVoice(e.target.value)}
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {TTS_VOICES.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            MisoTTS uses the same Read Aloud button through the
                            local server.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Globe2 size={14} className="text-zinc-400" />
                            MisoTTS API URL
                          </label>
                          <input
                            type="url"
                            value={inputMisoTtsApiUrl}
                            onChange={(e) =>
                              setInputMisoTtsApiUrl(e.target.value)
                            }
                            placeholder="http://127.0.0.1:8080"
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] font-mono disabled:opacity-50"
                          />
                          <p className="text-xs text-zinc-500 leading-relaxed">
                            Use `http://127.0.0.1:8080` for the Vast tunnel, or
                            paste any compatible cloud endpoint. Blank falls
                            back to `MISO_TTS_API_URL` on the server.
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                            <Settings size={14} className="text-zinc-400" />
                            {t("ai_model")}
                          </label>
                          <select
                            value={inputModel}
                            onChange={(e) => setInputModel(e.target.value)}
                            disabled={isValidating}
                            className="bg-[#121214] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff6e00]/45 focus:ring-1 focus:ring-[#ff6e00]/30 transition-[color,background-color,border-color,box-shadow,transform,opacity] appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="gpt-4o-mini">
                              GPT-4o Mini (Fast/Cheap)
                            </option>
                            <option value="gpt-4o">GPT-4o (Smart)</option>
                            <option value="anthropic/claude-3.5-sonnet">
                              Claude 3.5 Sonnet
                            </option>
                            <option value="google/gemini-1.5-pro">
                              Gemini 1.5 Pro
                            </option>
                            <option value="deepseek/deepseek-v4-flash">
                              DeepSeek V4 Flash
                            </option>
                          </select>
                        </div>
                      </>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <Settings size={14} className="text-zinc-400" />
                        {t("ui_animations")}
                      </label>
                      <button
                        type="button"
                        aria-label="Toggle animations"
                        aria-pressed={inputAnimations}
                        onClick={() => setInputAnimations(!inputAnimations)}
                        className={`w-11 h-6 rounded-full transition-colors relative ${inputAnimations ? "bg-[#ff6e00]" : "bg-zinc-700"}`}
                      >
                        <div
                          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${inputAnimations ? "translate-x-5" : "translate-x-0"}`}
                        />
                      </button>
                    </div>

                    {validationError && (
                      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 p-3 rounded-xl border border-red-400/20">
                        <AlertCircle size={16} />
                        <p>{validationError}</p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "usage" && (
                  <div ref={tabPanelRef} key="usage">
                    <div className="mb-4 flex items-center gap-2">
                      <BarChart3 size={16} className="text-[#ff6e00]" />
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {accessMode === "user"
                            ? "Plan and milestones"
                            : "Usage analytics"}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {accessMode === "user"
                            ? "Service time, rate limit left, and simple plan controls."
                            : "Tokens, requests, and cost for this browser."}
                        </div>
                      </div>
                    </div>
                    {accessMode === "user" ? (
                      <UserUsagePanel />
                    ) : (
                      <UsageInsightsPanel />
                    )}
                  </div>
                )}

                {activeTab === "persona" && (
                  <div
                    ref={tabPanelRef}
                    key="persona"
                    className="flex flex-col gap-5"
                  >
                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex flex-col gap-3">
                        <label className="text-sm font-medium text-zinc-200 flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Settings size={14} className="text-zinc-400" />
                            AI Persona Studio
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                            Live prompt
                          </span>
                        </label>
                        <p className="text-xs leading-relaxed text-zinc-500">
                          Describe the tutor you want. The generator writes a
                          professional system prompt, applies the no-emoji tutor
                          style, and saves it when you press Save.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            "Socratic Python mentor",
                            "Concise exam coach",
                            "Research paper tutor",
                          ].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setPersonaDesc(preset)}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-[#ff6e00]/35 hover:text-white"
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <input
                          type="text"
                          value={personaDesc}
                          onChange={(e) => setPersonaDesc(e.target.value)}
                          placeholder="I want an AI tutor specialized in..."
                          className="flex-1 bg-[#121214] border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-[#ff6e00]/45 transition-[color,background-color,border-color,box-shadow,transform,opacity]"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!personaDesc.trim()) return;
                            setIsGeneratingPersona(true);
                            try {
                              const res = await fetch("/api/generate-persona", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                  ...(inputKey.trim()
                                    ? {
                                        Authorization: `Bearer ${inputKey.trim()}`,
                                      }
                                    : {}),
                                },
                                body: JSON.stringify({
                                  description: personaDesc,
                                }),
                              });
                              const data = await res.json();
                              if (!res.ok || data.error) {
                                throw new Error(
                                  data.error || "Persona generation failed.",
                                );
                              }
                              if (data.prompt) {
                                setInputPrompt(data.prompt);
                                setPersonaStatus(
                                  "Persona prompt generated. Press Save to apply it.",
                                );
                              }
                            } catch (e) {
                              console.error(e);
                              setPersonaStatus(
                                e instanceof Error
                                  ? e.message
                                  : "Persona generation failed.",
                              );
                            } finally {
                              setIsGeneratingPersona(false);
                            }
                          }}
                          disabled={isGeneratingPersona}
                          className="px-4 py-2 bg-white/[0.08] text-white hover:bg-white/[0.12] rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2 border border-white/10"
                        >
                          {isGeneratingPersona ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : null}
                          Generate
                        </button>
                      </div>
                      {personaStatus && (
                        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-zinc-400">
                          {personaStatus}
                        </div>
                      )}
                      <textarea
                        value={inputPrompt}
                        onChange={(e) => setInputPrompt(e.target.value)}
                        placeholder="You are a precise, professional tutor. Use clear markdown, ask targeted questions, and do not use emojis unless explicitly requested."
                        className="mt-3 min-h-[170px] w-full resize-y rounded-xl border border-white/10 bg-[#121214] px-4 py-3 font-mono text-sm leading-relaxed text-white transition-[color,background-color,border-color,box-shadow,transform,opacity] focus:border-[#ff6e00]/45 focus:outline-none focus:ring-1 focus:ring-[#ff6e00]/30"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isValidating}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isValidating}
                  className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium bg-white text-black hover:bg-zinc-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)] disabled:opacity-50"
                >
                  {isValidating && (
                    <Loader2 size={16} className="animate-spin" />
                  )}
                  {isValidating ? "Validating..." : t("save_changes")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {switchingMode && (
        <div
          ref={switchingOverlayRef}
          className="fixed inset-0 z-[140] flex items-center justify-center bg-[#030303]/90 backdrop-blur-2xl"
        >
          <div
            ref={switchingCardRef}
            className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.06] px-8 py-6 text-center shadow-[0_30px_100px_rgba(0,0,0,0.55)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,110,0,0.25),transparent_45%)]" />
            <div className="relative text-[10px] font-bold uppercase tracking-[0.22em] text-[#ffb17a]">
              Switching access
            </div>
            <div className="relative mt-2 text-2xl font-semibold capitalize text-white">
              {switchingMode} mode
            </div>
            <div className="relative mt-3 flex justify-center">
              <Loader2 size={22} className="animate-spin text-[#ff6e00]" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
