import React, {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ShikiHighlighter } from "./ShikiHighlighter";
import {
  PendingIcon,
  ProgressIcon,
  SubmittedIcon,
  ReviewIcon,
  SuccessIcon,
  ExpiredIcon,
  StatusBadge,
} from "./StatusBadge";
import {
  ArrowUp,
  Sparkles,
  BookOpen,
  X,
  Check,
  Folder,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Square,
  Zap,
  Mic,
  Activity,
  Plus,
  Minus,
  LoaderCircle,
  RotateCcw,
  Globe2,
  ExternalLink,
  Brain,
  Search,
  FileCode2,
  Copy,
  Play,
  Terminal,
  Image as ImageIcon,
  Code2,
  Clock,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { gsap } from "gsap";
import { useLiveQuery } from "dexie-react-hooks";
import { audio } from "../lib/audio";
import { SiriLiquidGlass } from "./SiriLiquidGlass";
import { useStore, type NormalizedWebSource } from "../store";
import { brainOrchestrator } from "../memory/memory.orchestrator";
import { db, GENERAL_STUDY_BOOK_ID } from "../memory/longterm.memory";
import {
  recordGeneratedFlashcardsArtifact,
  recordUnavailableCitationState,
  recordWebSourceArtifact,
} from "../memory/artifact.records";
import { recordMemoryEvent } from "../memory/memory.events";
import { recordModelRunEvent } from "../memory/model.runs";
import { recordToolJobEvent } from "../memory/tool.jobs";
import { recordEvaluatedAnswerEvidenceBatch } from "../memory/answer.evidence";
import { createFlashcardForStorage } from "../memory/flashcard.concepts";
import type {
  BookChatThread,
  LearningDocument,
  MemoryEvent,
} from "../memory/longterm.memory";
import type { Message } from "../types";
import { FloatingSkillsMenu } from "./FloatingSkillsMenu";
import { useTranslation } from "../lib/translations";
import {
  estimateServiceMinutes,
  formatServiceTime,
  getPlanOption,
  serviceMilestones,
} from "../lib/accessPlans";
import {
  INTERACTION_THINKING_PAUSE_MS,
  type TutorInteractionMode,
} from "../lib/interactionModel";
import { buildBrainContextPacket } from "../memory/brain.context";
import {
  buildVoiceFunctionCallResponse,
  parseVoiceFunctionArguments,
  type VoiceAgentFunctionCall,
} from "../lib/voiceAgentTools";
import {
  chatTitleFromMessageSet,
  flattenChatMessagesForPrompt,
  hasLearnerChatTurn,
  meaningfulChatMessages,
  summarizeChatThreadPersistence,
} from "../lib/chatThreadUtils";
import { learnerRequestHeaders } from "../lib/localLearnerProfile";

type MermaidApi = typeof import("mermaid").default;
type VoiceVisualFocus = NonNullable<
  NonNullable<Message["voiceSession"]>["visualFocuses"]
>[number];
type Variants = Record<string, Record<string, any>>;
type MotionTarget = string | false | null | undefined | Record<string, any>;
type MotionTransition = {
  delay?: number;
  duration?: number;
  ease?: string | number[];
  repeat?: number;
  type?: string;
};
type MotionLikeProps = {
  animate?: MotionTarget;
  exit?: MotionTarget;
  initial?: MotionTarget;
  layout?: boolean | string;
  layoutId?: string;
  transition?: MotionTransition;
  variants?: Variants;
  whileHover?: MotionTarget;
  whileTap?: MotionTarget;
};

const AnimatePresence = ({
  children,
}: {
  children: React.ReactNode;
  initial?: boolean;
  mode?: string;
}) => <>{children}</>;

const toMotionTarget = (target: MotionTarget, variants?: Variants) => {
  if (!target) return undefined;
  if (typeof target === "string") return variants?.[target];
  return target;
};

const normalizeGsapVars = (target?: Record<string, any>) => {
  if (!target) return undefined;
  return Object.entries(target).reduce<Record<string, any>>(
    (acc, [key, value]) => {
      if (value === undefined) return acc;
      acc[key] = Array.isArray(value) ? value[value.length - 1] : value;
      return acc;
    },
    {},
  );
};

const resolveEase = (transition?: MotionTransition) => {
  if (!transition?.ease) return "power3.out";
  if (Array.isArray(transition.ease)) return "power3.out";
  if (transition.ease === "linear") return "none";
  if (transition.ease === "easeInOut") return "power2.inOut";
  if (transition.ease === "easeOut") return "power3.out";
  if (transition.ease === "easeIn") return "power2.in";
  return transition.type === "spring" ? "power3.out" : transition.ease;
};

const transitionToGsap = (transition?: MotionTransition) => ({
  delay: transition?.delay ?? 0,
  duration:
    transition?.duration ?? (transition?.type === "spring" ? 0.34 : 0.24),
  ease: resolveEase(transition),
  repeat: transition?.repeat === Infinity ? -1 : transition?.repeat,
});

function createMotionElement(tag: string) {
  return React.forwardRef<HTMLElement, MotionLikeProps & Record<string, any>>(
    (
      {
        animate,
        children,
        exit: _exit,
        initial,
        layout: _layout,
        layoutId,
        onMouseDown,
        onMouseEnter,
        onMouseLeave,
        onMouseUp,
        transition,
        variants,
        whileHover,
        whileTap,
        ...rest
      }: any,
      forwardedRef,
    ) => {
      const localRef = useRef<HTMLElement | null>(null);
      const animateKey = JSON.stringify({ animate, transition, variants });
      const initialKey = JSON.stringify(initial);

      const assignRef = (node: HTMLElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLElement | null>).current =
            node;
        }
      };

      const animateTo = (target: MotionTarget) => {
        const node = localRef.current;
        if (!node) return;
        const vars = normalizeGsapVars(toMotionTarget(target, variants));
        if (!vars) return;
        gsap.to(node, {
          ...vars,
          ...transitionToGsap(transition),
          overwrite: "auto",
        });
      };

      useLayoutEffect(() => {
        const node = localRef.current;
        if (!node) return;
        const from = normalizeGsapVars(toMotionTarget(initial, variants));
        const to = normalizeGsapVars(toMotionTarget(animate, variants));
        gsap.killTweensOf(node);

        if (from && to) {
          gsap.fromTo(node, from, {
            ...to,
            ...transitionToGsap(transition),
            overwrite: "auto",
          });
          return;
        }

        if (to) {
          gsap.to(node, {
            ...to,
            ...transitionToGsap(transition),
            overwrite: "auto",
          });
        }
      }, [animateKey, initialKey]);

      return React.createElement(
        tag,
        {
          ...rest,
          "data-layout-id": layoutId,
          ref: assignRef,
          onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
            onMouseDown?.(event);
            animateTo(whileTap);
          },
          onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
            onMouseEnter?.(event);
            animateTo(whileHover);
          },
          onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
            onMouseLeave?.(event);
            animateTo(animate || initial);
          },
          onMouseUp: (event: React.MouseEvent<HTMLElement>) => {
            onMouseUp?.(event);
            animateTo(whileHover || animate || initial);
          },
        },
        children,
      );
    },
  );
}

const gsapMotion = {
  a: createMotionElement("a"),
  button: createMotionElement("button"),
  div: createMotionElement("div"),
  span: createMotionElement("span"),
  textarea: createMotionElement("textarea"),
};

type StreamingAssistantDraft = {
  id: string;
  content: string;
  usage?: NonNullable<Message["usage"]>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

const loadMermaid = () => {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        // strict sanitizes model-generated diagram source (DOMPurify) and
        // blocks in-diagram click/javascript directives — the diagram text is
        // influenced by untrusted PDF/web content, so "loose" was an XSS path.
        securityLevel: "strict",
        theme: "base",
        fontFamily:
          "'Geist', 'Geist Sans', Inter, 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', system-ui, sans-serif",
        themeVariables: {
          background: "transparent",
          fontSize: "14px",
          // Calmer zinc family, lifted for legible contrast on the near-black
          // card. Orange stays reserved for the click-to-focus highlight.
          primaryColor: "#26262c",
          primaryTextColor: "#fafafa",
          primaryBorderColor: "#6b6b76",
          secondaryColor: "#2f2f36",
          secondaryTextColor: "#f4f4f5",
          secondaryBorderColor: "#6b6b76",
          tertiaryColor: "#28282e",
          tertiaryTextColor: "#f4f4f5",
          tertiaryBorderColor: "#57575f",
          mainBkg: "#26262c",
          nodeBorder: "#6b6b76",
          nodeTextColor: "#fafafa",
          textColor: "#e7e7ea",
          titleColor: "#fafafa",
          lineColor: "#a8a8b3",
          arrowheadColor: "#a8a8b3",
          edgeLabelBackground: "#18181b",
          clusterBkg: "rgba(42,42,48,0.55)",
          clusterBorder: "#57575f",
          noteBkgColor: "#292524",
          noteTextColor: "#fcd34d",
          noteBorderColor: "#78716c",
          actorBkg: "#26262c",
          actorTextColor: "#fafafa",
          actorBorder: "#6b6b76",
          labelBoxBkgColor: "#26262c",
          labelTextColor: "#fafafa",
        },
        flowchart: {
          curve: "basis",
          padding: 16,
          nodeSpacing: 50,
          rankSpacing: 60,
          htmlLabels: true,
          useMaxWidth: true,
        },
        sequence: { useMaxWidth: true },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
};

const cleanMermaidTourLabel = (value: string | null | undefined) =>
  (value || "")
    .replace(/\s+/g, " ")
    .replace(/\b(node|label)\b/gi, "")
    .trim()
    .slice(0, 80);

const collectMermaidTourNodes = (svg: SVGSVGElement) => {
  const seen = new Set<Element>();
  const preferredCandidates = Array.from(
    svg.querySelectorAll<SVGGElement>(
      [
        "g.node",
        "g[class*='state']",
        "g[class*='entity']",
        "g[class*='relationship']",
        "g[class*='classGroup']",
        "g[id*='flowchart'][class*='node']",
        "g[id*='state'][class*='node']",
        "g[id*='entity']",
      ].join(", "),
    ),
  );
  const candidates = preferredCandidates.length
    ? preferredCandidates
    : Array.from(svg.querySelectorAll<SVGGElement>("g"));
  return candidates
    .filter((node) => {
      if (seen.has(node)) return false;
      seen.add(node);
      const hasShape = Boolean(
        node.querySelector("rect, polygon, path, circle, ellipse"),
      );
      const label = cleanMermaidTourLabel(node.textContent);
      return hasShape && label.length > 0;
    })
    .slice(0, 16);
};

type MermaidViewBox = [number, number, number, number];

const parseMermaidViewBox = (svg: SVGSVGElement): MermaidViewBox | null => {
  const parts = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return parts as MermaidViewBox;
};

const Mermaid = ({
  chart,
  variant = "inline",
}: {
  chart: string;
  variant?: "inline" | "stage";
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const originalViewBoxRef = useRef<MermaidViewBox | null>(null);
  const viewBoxAnimationRef = useRef<number | null>(null);
  const focusNodesRef = useRef<SVGGElement[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const isStage = variant === "stage";

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    let cancelled = false;
    const container = chartRef.current;
    if (!container) return;

    if (viewBoxAnimationRef.current !== null) {
      cancelAnimationFrame(viewBoxAnimationRef.current);
      viewBoxAnimationRef.current = null;
    }
    focusNodesRef.current = [];
    setFocusIndex(null);

    // Debounce so streaming tokens don't render on every keystroke, and only
    // render once the source PARSES cleanly. This is what stops half-finished
    // ```mermaid fences from flashing raw parser errors: while the block is
    // still streaming (or genuinely invalid) we simply leave the last good
    // diagram / skeleton in place instead of dumping an error string.
    const timer = window.setTimeout(() => {
      loadMermaid()
        .then(async (mermaid) => {
          if (cancelled) return;
          let parseable = false;
          try {
            parseable = Boolean(
              await mermaid.parse(chart, { suppressErrors: true }),
            );
          } catch {
            parseable = false;
          }
          if (!parseable) return;
          const res = await mermaid.render(
            `mermaid-${Math.random().toString(36).slice(2)}`,
            chart,
          );
          if (cancelled || !chartRef.current) return;
          chartRef.current.innerHTML = res.svg;
          const svg = chartRef.current.querySelector<SVGSVGElement>("svg");
          if (!svg) return;
          svg.setAttribute("role", "img");
          svg.setAttribute("aria-label", "Diagram");
          svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.style.display = "block";
          svg.style.width = "100%";
          svg.style.maxWidth = "100%";
          svg.style.maxHeight = isStage ? "72vh" : "70dvh";
          svg.style.minWidth = "0";
          svg.style.height = "auto";
          svg.style.margin = "0 auto";
          if (!svg.getAttribute("viewBox")) {
            try {
              const bounds = (svg as unknown as SVGGraphicsElement).getBBox();
              svg.setAttribute(
                "viewBox",
                `${bounds.x} ${bounds.y} ${Math.max(bounds.width, 1)} ${Math.max(bounds.height, 1)}`,
              );
            } catch {}
          }
          originalViewBoxRef.current = parseMermaidViewBox(svg);
          // Optional click-to-focus: clicking a node zooms to it. Nodes stay at
          // full opacity by default — no perpetual dimming, no auto-panning.
          const nodes = collectMermaidTourNodes(svg);
          focusNodesRef.current = nodes;
          nodes.forEach((node, index) => {
            node.setAttribute("data-mermaid-node", "true");
            node.setAttribute("tabindex", "0");
            node.setAttribute("role", "button");
            const label = cleanMermaidTourLabel(node.textContent);
            if (label) node.setAttribute("aria-label", `Focus ${label}`);
            node.style.cursor = "zoom-in";
            const toggleFocus = () =>
              setFocusIndex((current) => (current === index ? null : index));
            node.addEventListener("click", toggleFocus);
            node.addEventListener("keydown", (event) => {
              const key = (event as KeyboardEvent).key;
              if (key === "Enter" || key === " ") {
                event.preventDefault();
                toggleFocus();
              }
            });
          });
          setStatus("ready");
        })
        .catch((error) => {
          console.warn("Mermaid render error", error);
        });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (viewBoxAnimationRef.current !== null) {
        cancelAnimationFrame(viewBoxAnimationRef.current);
        viewBoxAnimationRef.current = null;
      }
    };
  }, [chart, isStage]);

  // Animate the viewBox to the focused node, or back to the full diagram when
  // focus is cleared. Focus is user-initiated (click/enter) only.
  useEffect(() => {
    const container = chartRef.current;
    const svg = container?.querySelector<SVGSVGElement>("svg");
    const original = originalViewBoxRef.current;
    if (!svg || !original) return;

    if (viewBoxAnimationRef.current !== null) {
      cancelAnimationFrame(viewBoxAnimationRef.current);
      viewBoxAnimationRef.current = null;
    }

    const nodes = focusNodesRef.current;
    nodes.forEach((node) => node.removeAttribute("data-mermaid-active"));

    let target: MermaidViewBox = original;
    if (focusIndex !== null && nodes[focusIndex]) {
      const activeNode = nodes[focusIndex];
      activeNode.setAttribute("data-mermaid-active", "true");
      // Focus by animating the SVG viewBox (diagram coordinates) so the pan/zoom
      // lands exactly on the node and the diagram can never escape its frame.
      const current = parseMermaidViewBox(svg) || original;
      const svgRect = svg.getBoundingClientRect();
      const nodeRect = activeNode.getBoundingClientRect();
      if (svgRect.width >= 1 && svgRect.height >= 1) {
        const renderScale = Math.min(
          svgRect.width / current[2],
          svgRect.height / current[3],
        );
        const contentLeft =
          svgRect.left + (svgRect.width - current[2] * renderScale) / 2;
        const contentTop =
          svgRect.top + (svgRect.height - current[3] * renderScale) / 2;
        const nodeX = current[0] + (nodeRect.left - contentLeft) / renderScale;
        const nodeY = current[1] + (nodeRect.top - contentTop) / renderScale;
        const nodeW = nodeRect.width / renderScale;
        const nodeH = nodeRect.height / renderScale;
        const [origX, origY, origW, origH] = original;
        const aspect = origW / origH;
        let targetW = Math.min(
          origW,
          Math.max(nodeW * (isStage ? 2.6 : 3.1), origW * 0.45),
        );
        let targetH = targetW / aspect;
        if (targetH < nodeH * 1.7) {
          targetH = Math.min(origH, nodeH * 1.7);
          targetW = targetH * aspect;
        }
        let targetX = nodeX + nodeW / 2 - targetW / 2;
        let targetY = nodeY + nodeH / 2 - targetH / 2;
        targetX = Math.max(origX, Math.min(origX + origW - targetW, targetX));
        targetY = Math.max(origY, Math.min(origY + origH - targetH, targetY));
        target = [targetX, targetY, targetW, targetH];
      }
    }

    const applyViewBox = (box: MermaidViewBox) =>
      svg.setAttribute("viewBox", box.map((v) => v.toFixed(2)).join(" "));
    const from = parseMermaidViewBox(svg) || original;
    if (prefersReducedMotion()) {
      applyViewBox(target);
      return;
    }
    const durationMs = isStage ? 700 : 560;
    const startedAt = performance.now();
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = easeInOutCubic(progress);
      applyViewBox(
        from.map(
          (value, i) => value + (target[i] - value) * eased,
        ) as MermaidViewBox,
      );
      viewBoxAnimationRef.current =
        progress < 1 ? requestAnimationFrame(tick) : null;
    };
    viewBoxAnimationRef.current = requestAnimationFrame(tick);
  }, [focusIndex, isStage]);

  return (
    <div
      className={`learningai-mermaid relative w-full text-zinc-100 ${
        isStage
          ? "my-0 max-w-none overflow-visible border-0 bg-transparent p-0 shadow-none"
          : "my-4 max-w-none overflow-hidden rounded-2xl border border-white/10 bg-[#121216] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.28)]"
      }`}
      data-mermaid-variant={variant}
    >
      <style>{`
        .learningai-mermaid [data-mermaid-node='true'] {
          transition: filter 320ms ease;
        }
        .learningai-mermaid [data-mermaid-active='true'] {
          filter: drop-shadow(0 0 12px rgba(255, 138, 42, 0.45));
        }
        .learningai-mermaid [data-mermaid-active='true'] rect,
        .learningai-mermaid [data-mermaid-active='true'] polygon,
        .learningai-mermaid [data-mermaid-active='true'] path,
        .learningai-mermaid [data-mermaid-active='true'] circle,
        .learningai-mermaid [data-mermaid-active='true'] ellipse {
          stroke: #ff8a2a !important;
          stroke-width: 2.25px !important;
        }
        .learningai-mermaid .node rect,
        .learningai-mermaid .node polygon { rx: 10px; ry: 10px; }
        .learningai-mermaid .edgeLabel { border-radius: 8px; line-height: 1.25; }
        .learningai-mermaid .edgeLabel p,
        .learningai-mermaid .edgeLabel span {
          background: #18181b !important;
          color: #e7e7ea !important;
          border-radius: 8px;
          padding: 2px 7px;
          font-size: 11.5px;
          font-weight: 500;
        }
        .learningai-mermaid[data-mermaid-variant='stage'] svg {
          background: transparent !important;
        }
        @media (prefers-reduced-motion: reduce) {
          .learningai-mermaid [data-mermaid-node='true'] { transition: none !important; }
        }
      `}</style>
      <div
        ref={chartRef}
        className={`relative flex justify-center ${
          isStage
            ? "min-h-[52vh] items-center overflow-visible p-0 sm:min-h-[72vh]"
            : "min-h-[160px] items-center overflow-hidden rounded-lg p-2"
        }`}
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
            Rendering diagram…
          </div>
        </div>
      )}
      {status === "ready" && focusIndex !== null && !isStage && (
        <button
          type="button"
          onClick={() => setFocusIndex(null)}
          className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur transition-colors hover:border-orange-300/60 hover:text-orange-100"
        >
          Reset view
        </button>
      )}
    </div>
  );
};

type VoiceCaption = {
  role: "user" | "assistant";
  text: string;
} | null;
type VoiceSessionTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  finalContent?: string;
  isRevealing?: boolean;
};
type VoiceStudyContextPayload = {
  userId?: string;
  requestId?: string;
  proofAttemptId?: string;
  studyContext: string;
  studyContextChars: number;
  rawContextChars: number;
  memoryContextChars: number;
  activeBookContextChars: number;
  documentContextChars: number;
  documentCount: number;
  documentIds: string[];
  readyDocumentCount: number;
  readyDocumentIds: string[];
  contextDocumentIds: string[];
  unreadyDocumentCount: number;
  omittedReadyDocumentCount: number;
  contextCompacted: boolean;
};

type NormalizedVoiceTranscript = {
  role: "user" | "assistant";
  content: string;
  rawType: string;
  sourceField: string;
};

type PacedVoiceTurn = {
  turnId: string;
  fullText: string;
  startedAt: number;
  durationMs: number;
};

const voiceTranscriptTypePattern =
  /(ConversationText|Transcript|Transcription|Utterance|UserMessage|AgentMessage|InputText|OutputText|FinalTranscript|InterimTranscript)/i;

const compactTranscriptCandidate = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const extractVoiceTranscriptText = (
  payload: Record<string, any>,
): { content: string; sourceField: string } => {
  const directFields = [
    "content",
    "text",
    "transcript",
    "utterance",
    "message",
  ];
  for (const field of directFields) {
    const content = compactTranscriptCandidate(payload[field]);
    if (content) return { content, sourceField: field };
  }
  const alternatives = [
    payload.channel?.alternatives?.[0],
    payload.alternatives?.[0],
    payload.results?.channels?.[0]?.alternatives?.[0],
    payload.result?.channels?.[0]?.alternatives?.[0],
    payload.speech,
  ].filter(Boolean);
  for (const alternative of alternatives) {
    const content =
      compactTranscriptCandidate(alternative.transcript) ||
      compactTranscriptCandidate(alternative.text) ||
      compactTranscriptCandidate(alternative.content);
    if (content) {
      return {
        content,
        sourceField: "nested_transcript",
      };
    }
  }
  return { content: "", sourceField: "" };
};

const normalizeVoiceTranscriptEvent = (
  payload: unknown,
): NormalizedVoiceTranscript | null => {
  if (!payload || typeof payload !== "object") return null;
  const msg = payload as Record<string, any>;
  const rawType = String(msg.type || "");
  const rawRole = String(msg.role || msg.speaker || msg.participant || "");
  const hasTranscriptType = voiceTranscriptTypePattern.test(rawType);
  const hasTranscriptField =
    "transcript" in msg ||
    "utterance" in msg ||
    Boolean(msg.channel?.alternatives?.[0]?.transcript) ||
    Boolean(msg.results?.channels?.[0]?.alternatives?.[0]?.transcript);
  const roleLooksConversational =
    /\b(user|student|human|agent|assistant|aria)\b/i.test(rawRole) &&
    ("content" in msg || "text" in msg || "message" in msg);
  if (!hasTranscriptType && !hasTranscriptField && !roleLooksConversational) {
    return null;
  }
  const { content, sourceField } = extractVoiceTranscriptText(msg);
  if (!content) return null;
  const roleSeed = `${rawRole} ${rawType}`;
  const role =
    /\b(agent|assistant|aria|output)\b/i.test(roleSeed) &&
    !/\b(user|student|human|input)\b/i.test(roleSeed)
      ? "assistant"
      : "user";
  return {
    role,
    content,
    rawType,
    sourceField,
  };
};

const VOICE_AGENT_CONTEXT_CHAR_LIMIT = 7000;

const createTutorRequestId = (prefix: "chat" | "voice") => {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`
    .replace(/[^A-Za-z0-9_:-]/g, "-")
    .slice(0, 120);
};

const buildBlobPath = (pts: Array<[number, number]>) => {
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
  }
  return `${d}Z`;
};

const chunkCaption = (text: string): string[] => {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  words.forEach((word) => {
    current.push(word);
    const endsSentence = /[.!?,;:]$/.test(word);
    if (current.length >= 13 || (endsSentence && current.length >= 6)) {
      chunks.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) chunks.push(current.join(" "));
  return chunks;
};

const END_INTENT_PATTERNS: RegExp[] = [
  /\b(i'?m|i am|we'?re|we are)\s+(done|finished|good|all set|all done)\b/,
  /\bthat'?s?\s+(all|it|enough)\b/,
  /\bno\s+(more|further)\s+questions\b/,
  /\b(good\s?bye|bye\s?bye|bye|see\s+(you|ya)|talk\s+later|catch\s+you\s+later)\b/,
  /\b(end|close|stop|finish|exit|quit)\s+(the\s+)?(call|conversation|chat|session|audio|voice)\b/,
  /\b(end|stop|close|finish)\s+(it|this|that)\b/,
  /\b(let'?s|let\s+us)\s+(stop|end|finish|wrap\s+(it\s+)?up)\b/,
  /\bwrap\s+(it|this)\s+up\b/,
  /\bi\s+(have\s+to|need\s+to|gotta|got\s+to)\s+go\b/,
  /\b(thanks|thank\s+you)[,!.\s]*(that'?s\s+(all|it)|bye|good\s?bye)\b/,
];
const STOP_COMMAND =
  /^(ok(ay)?|alright|yeah|yep|cool)?[,\s]*(please\s+)?(stop( it| now| talking)?|quiet|silence|enough|that'?s\s+enough)[\s,]*(now|please)?[.!]*$/;

const detectEndIntent = (raw: string): boolean => {
  const text = (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return false;
  return (
    STOP_COMMAND.test(text) || END_INTENT_PATTERNS.some((re) => re.test(text))
  );
};

const deriveFallbackTitle = (turns: VoiceSessionTurn[]): string => {
  const first =
    turns.find((turn) => turn.role === "user")?.content ||
    turns[0]?.content ||
    "";
  const words = first.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return "Voice conversation";
  const title = words.join(" ").replace(/[.,!?;:]+$/, "");
  const capitalized = title.charAt(0).toUpperCase() + title.slice(1);
  return capitalized.length > 48
    ? `${capitalized.slice(0, 48)}...`
    : capitalized;
};

const compactVoiceEventText = (text: string, maxLength = 120) => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
};

const voiceServerWsUrl = () => {
  // A dedicated voice/signaling server (e.g. an Azure VM) can be configured
  // via VITE_VOICE_WS_URL when the web app itself is hosted somewhere that
  // cannot serve WebSockets (e.g. Vercel serverless). Accepts ws(s):// or
  // http(s):// forms; falls back to the page's own host when unset.
  const configured = String(import.meta.env.VITE_VOICE_WS_URL || "").trim();
  if (configured) {
    return configured
      .replace(/^https:/i, "wss:")
      .replace(/^http:/i, "ws:")
      .replace(/\/+$/, "");
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostPort =
    import.meta.env.DEV && /^517\d$/.test(window.location.port)
      ? `${window.location.hostname}:3000`
      : window.location.host;
  return `${wsProtocol}//${hostPort}`;
};

const captureCurrentPdfPageImage = () => {
  const canvas = document.querySelector(
    ".react-pdf__Page__canvas",
  ) as HTMLCanvasElement | null;
  if (!canvas) return null;

  const MAX_SIZE = 1024;
  let width = canvas.width;
  let height = canvas.height;

  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.floor(width * ratio);
    height = Math.floor(height * ratio);
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext("2d");
  if (ctx) {
    ctx.drawImage(canvas, 0, 0, width, height);
    return offscreen.toDataURL("image/jpeg", 0.6);
  }
  return canvas.toDataURL("image/jpeg", 0.5);
};

const RollingSubtitle = ({ caption }: { caption: VoiceCaption }) => {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!caption?.text.trim()) {
      setDisplay("");
      return;
    }
    const chunks = chunkCaption(caption.text);
    if (!chunks.length) {
      setDisplay("");
      return;
    }
    let index = 0;
    setDisplay(chunks[0]);
    if (chunks.length === 1) return;

    let timer: ReturnType<typeof setTimeout>;
    const durationFor = (chunk: string) =>
      Math.max(1400, chunk.split(/\s+/).length * 360);
    const advance = () => {
      index += 1;
      if (index < chunks.length) {
        setDisplay(chunks[index]);
        timer = setTimeout(advance, durationFor(chunks[index]));
      }
    };
    timer = setTimeout(advance, durationFor(chunks[0]));
    return () => clearTimeout(timer);
  }, [caption?.role, caption?.text]);

  if (!display) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[15%] flex justify-center px-8">
      <p
        className={`max-w-xl text-balance text-center text-base font-medium leading-snug transition-opacity ${
          caption?.role === "assistant" ? "text-white" : "text-white/65"
        }`}
        style={{ textShadow: "0 2px 20px rgba(0,0,0,0.9)" }}
      >
        {display}
      </p>
    </div>
  );
};

const MorphBlob = ({ speaking }: { speaking: boolean }) => {
  const pathRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const sheenRef = useRef<SVGPathElement>(null);
  const auraRef = useRef<SVGCircleElement>(null);
  const micRef = useRef(0);
  const ttsRef = useRef(0);
  const levelRef = useRef(0);

  useEffect(() => {
    const onMic = (event: Event) => {
      micRef.current = Math.min(
        1,
        Number((event as CustomEvent<number>).detail || 0),
      );
    };
    const onTts = (event: Event) => {
      ttsRef.current = Math.min(
        1,
        Number((event as CustomEvent<number>).detail || 0),
      );
    };
    window.addEventListener("mic-volume", onMic);
    window.addEventListener("tts-volume", onTts);

    const points = 12;
    const center = 160;
    const baseRadius = 92;
    const seeds = Array.from(
      { length: points },
      (_, index) => index * 1.7 + Math.sin(index) * 2,
    );
    let frame = 0;
    const animate = (timestamp: number) => {
      const target = Math.max(micRef.current, ttsRef.current);
      levelRef.current += (target - levelRef.current) * 0.18;
      const level = levelRef.current;
      const time = timestamp / 1000;
      const amp = 0.07 + level * 0.28;
      const expand = 1 + level * 0.2;
      const pts: Array<[number, number]> = [];
      for (let index = 0; index < points; index += 1) {
        const angle = (index / points) * Math.PI * 2;
        const noise =
          Math.sin(time * 1.1 + seeds[index]) * 0.5 +
          Math.sin(time * 1.9 + seeds[index] * 1.7) * 0.3 +
          Math.sin(time * 0.6 + angle * 3) * 0.2;
        const radius = baseRadius * expand * (1 + noise * amp);
        pts.push([
          center + Math.cos(angle) * radius,
          center + Math.sin(angle) * radius,
        ]);
      }
      const path = buildBlobPath(pts);
      pathRef.current?.setAttribute("d", path);
      glowRef.current?.setAttribute("d", path);
      sheenRef.current?.setAttribute("d", path);
      if (auraRef.current) {
        auraRef.current.setAttribute("r", `${118 * (1 + level * 0.28)}`);
        auraRef.current.setAttribute(
          "opacity",
          `${Math.min(0.95, 0.52 + level * 0.42)}`,
        );
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("mic-volume", onMic);
      window.removeEventListener("tts-volume", onTts);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <svg
      viewBox="0 0 320 320"
      className="h-72 w-72 overflow-visible sm:h-[380px] sm:w-[380px]"
      style={{
        filter:
          "saturate(1.2) brightness(1.06) drop-shadow(0 0 48px rgba(124,92,255,0.55)) drop-shadow(0 0 90px rgba(91,108,240,0.4))",
      }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="voice-blob-aura">
          <stop offset="0%" stopColor="#b18cff" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#6a6cff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#6a6cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="voice-blob-fill" cx="55%" cy="42%" r="72%">
          <stop offset="0%" stopColor="#c45cf2" />
          <stop offset="42%" stopColor="#7c5cff" />
          <stop offset="100%" stopColor="#3f5bf0" />
        </radialGradient>
        <linearGradient id="voice-blob-sheen" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#bcd4ff" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter
          id="voice-aura-blur"
          x="-80%"
          y="-80%"
          width="260%"
          height="260%"
        >
          <feGaussianBlur stdDeviation="20" />
        </filter>
      </defs>
      <circle
        ref={auraRef}
        cx={160}
        cy={160}
        r={118}
        fill="url(#voice-blob-aura)"
        filter="url(#voice-aura-blur)"
      />
      <path
        ref={glowRef}
        fill="url(#voice-blob-fill)"
        opacity={speaking ? 0.84 : 0.66}
        style={{ filter: "blur(26px)" }}
      />
      <path ref={pathRef} fill="url(#voice-blob-fill)" />
      <path
        ref={sheenRef}
        fill="url(#voice-blob-sheen)"
        opacity={0.35}
        style={{ mixBlendMode: "screen" }}
      />
    </svg>
  );
};

const VoiceStageSourceGrid = ({
  sources,
}: {
  sources: NormalizedWebSource[];
}) => {
  if (!sources.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-zinc-400">
        No external image/source cards were returned for this voice visual.
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sources.slice(0, 6).map((source, index) => (
        <a
          key={source.id || source.url || `${source.title}-${index}`}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="group flex min-w-0 gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-3 transition-colors hover:bg-white/[0.1]"
        >
          {(source.thumbnailUrl || source.imageUrl) && (
            <span className="relative block h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
              <img
                src={source.thumbnailUrl || source.imageUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-white">
                image
              </span>
            </span>
          )}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-300/20 bg-blue-400/10 text-blue-100">
            {source.sourceType === "image" ? (
              <ImageIcon size={13} />
            ) : (
              <Globe2 size={13} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              <span className="truncate">{source.domain}</span>
              <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-zinc-400">
                {index + 1}
              </span>
              <span className="rounded-full bg-blue-400/10 px-1.5 py-0.5 text-blue-200">
                {source.sourceType === "image" ? "image" : "source"}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 block text-[12px] font-semibold leading-snug text-zinc-200 group-hover:text-white">
              {source.title}
            </span>
            {source.snippet && (
              <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-zinc-500">
                {source.snippet}
              </span>
            )}
          </span>
          <ExternalLink
            size={12}
            className="mt-1 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-300"
          />
        </a>
      ))}
    </div>
  );
};

const VoiceVisualStage = ({
  focus,
  onDismiss,
}: {
  focus: VoiceVisualFocus;
  onDismiss?: () => void;
}) => {
  const sources = Array.isArray(focus.sources)
    ? (focus.sources as NormalizedWebSource[])
    : [];
  const imageSources = sources.filter(
    (source) => source.imageUrl || source.thumbnailUrl,
  );
  const featuredImage = imageSources[0];
  const isDiagramStage = focus.kind === "diagram" && Boolean(focus.mermaid);

  if (focus.kind === "current_page") return null;

  return (
    <gsapMotion.div
      data-voice-visual-stage
      data-voice-visual-stage-kind={focus.kind}
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.46, ease: "easeOut" }}
      className={`pointer-events-auto absolute flex items-center justify-center ${
        isDiagramStage
          ? "inset-x-2 bottom-16 top-16 sm:bottom-4 sm:left-[6.75rem] sm:right-4 sm:top-4"
          : "inset-x-3 bottom-24 top-[8.75rem] sm:bottom-7 sm:left-[9rem] sm:right-7 sm:top-7"
      }`}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-2 top-2 z-20 rounded-full border border-white/10 bg-black/40 p-2 text-zinc-300 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:border-white/20 hover:text-white"
        aria-label="Return voice blob to center"
      >
        <X size={14} />
      </button>

      {isDiagramStage ? (
        <div
          data-voice-stage-mermaid
          className="flex h-full w-full items-center justify-center"
        >
          <Mermaid chart={focus.mermaid || ""} variant="stage" />
        </div>
      ) : focus.kind === "web_search" ? (
        <div className="custom-scroll max-h-full w-full max-w-6xl overflow-auto rounded-2xl border border-white/10 bg-[#050505]/92 p-4 shadow-[0_28px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
              {featuredImage ? (
                <img
                  src={featuredImage.imageUrl || featuredImage.thumbnailUrl}
                  alt={featuredImage.title || "Voice web image result"}
                  className="max-h-[58vh] w-full object-contain"
                />
              ) : (
                <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center text-zinc-500">
                  <ImageIcon size={30} />
                  <p className="max-w-sm text-sm leading-relaxed">
                    This voice web-search result did not include a renderable
                    image. Source metadata is still visible on the right.
                  </p>
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                <span className="rounded-full bg-white/10 px-2 py-1">
                  {sources.length} source{sources.length === 1 ? "" : "s"}
                </span>
                <span className="rounded-full bg-white/10 px-2 py-1">
                  {imageSources.length} image
                  {imageSources.length === 1 ? "" : "s"}
                </span>
                {focus.query && (
                  <span className="min-w-0 truncate rounded-full bg-blue-400/10 px-2 py-1 text-blue-100">
                    {focus.query}
                  </span>
                )}
              </div>
              <VoiceStageSourceGrid sources={sources} />
            </div>
          </div>
        </div>
      ) : null}
    </gsapMotion.div>
  );
};

const VoiceUniverse = ({
  state,
  caption,
  visualFocus,
  onDismissVisual,
}: {
  state: "listening" | "speaking";
  caption: VoiceCaption;
  visualFocus?: VoiceVisualFocus | null;
  onDismissVisual?: () => void;
}) => {
  const label = state === "speaking" ? "Aria is speaking" : "Listening";
  const visibleVisualFocus =
    visualFocus?.kind === "current_page" ? null : visualFocus;
  const hasVisualStage = Boolean(visibleVisualFocus);
  return (
    <gsapMotion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden bg-[#030303]"
      aria-live="polite"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(124,92,255,0.24),transparent_34%),radial-gradient(circle_at_18%_70%,rgba(59,130,246,0.14),transparent_30%),radial-gradient(circle_at_82%_72%,rgba(255,110,0,0.12),transparent_26%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:26px_26px]" />
      {visibleVisualFocus && (
        <VoiceVisualStage
          focus={visibleVisualFocus}
          onDismiss={onDismissVisual}
        />
      )}
      <div
        className={`absolute flex flex-col items-center transition-[left,top,transform] duration-700 ease-out ${
          hasVisualStage
            ? "-left-4 -top-4 origin-top-left scale-[0.36] sm:-left-6 sm:-top-6 sm:scale-[0.36]"
            : "left-1/2 top-1/2 origin-center -translate-x-1/2 -translate-y-[58%] scale-100"
        }`}
      >
        {!hasVisualStage && (
          <div className="mb-5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/55 backdrop-blur-xl">
            {label}
          </div>
        )}
        <MorphBlob speaking={state === "speaking"} />
      </div>
      <RollingSubtitle caption={caption} />
    </gsapMotion.div>
  );
};

const languageLabels: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  json: "JSON",
  bash: "Shell",
  sh: "Shell",
  html: "HTML",
  css: "CSS",
};

const languageExtensions: Record<string, string> = {
  js: "js",
  javascript: "js",
  ts: "ts",
  typescript: "ts",
  py: "py",
  python: "py",
  json: "json",
  bash: "sh",
  sh: "sh",
  html: "html",
  css: "css",
};

const codeLanguageLabel = (language: string) =>
  languageLabels[language] ||
  (language ? language.charAt(0).toUpperCase() + language.slice(1) : "Text");
const codeFileName = (language: string) =>
  `snippet.${languageExtensions[language] || language || "txt"}`;

const PremiumCodeShell = ({
  language,
  code,
  runnable,
  running = false,
  onRun,
  children,
  output,
  outputTone = "default",
}: {
  language: string;
  code: string;
  runnable?: boolean;
  running?: boolean;
  onRun?: () => void;
  children: React.ReactNode;
  output?: string | null;
  outputTone?: "default" | "error";
}) => {
  const [copied, setCopied] = useState(false);
  const label = codeLanguageLabel(language);

  const copyCode = async () => {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <gsapMotion.div
      initial={{ opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      className="not-prose my-4 overflow-hidden rounded-2xl border border-white/10 bg-[#050505] text-zinc-100 shadow-[0_18px_54px_rgba(0,0,0,0.22)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#18181a] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-400">
            <FileCode2 size={15} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-mono text-[13px] text-zinc-300">
              {codeFileName(language)}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Executable block
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-xl bg-white/[0.07] px-3 py-2 text-[12px] font-medium text-zinc-400 sm:inline-flex">
            {label}
          </span>
          {runnable && (
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#ff6e00]/20 bg-[#ff6e00]/10 px-3 text-[12px] font-semibold text-[#ffb066] transition-colors hover:bg-[#ff6e00]/16 disabled:cursor-wait disabled:opacity-60"
            >
              {running ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              {running ? "Running" : "Run"}
            </button>
          )}
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-white"
            aria-label="Copy code"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#ff6e00]/60 to-transparent" />
        {children}
      </div>
      <AnimatePresence>
        {output !== undefined && output !== null && (
          <gsapMotion.div
            data-reasoning-steps
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/10 bg-[#0c0c0d]"
          >
            <div className="px-4 py-3 font-mono">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                <Terminal size={13} />
                Console output
              </div>
              <pre
                className={`whitespace-pre-wrap text-[12px] leading-relaxed ${outputTone === "error" ? "text-red-300" : "text-zinc-300"}`}
              >
                {output}
              </pre>
            </div>
          </gsapMotion.div>
        )}
      </AnimatePresence>
    </gsapMotion.div>
  );
};

const RunnableJS = ({ code }: { code: string }) => {
  const [output, setOutput] = React.useState<string | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  const runCode = () => {
    setIsRunning(true);
    setHasError(false);
    const logs: any[] = [];
    const customConsole = {
      log: (...args: any[]) => logs.push(args.join(" ")),
      error: (...args: any[]) => logs.push("ERROR: " + args.join(" ")),
      warn: (...args: any[]) => logs.push("WARN: " + args.join(" ")),
    };
    try {
      const func = new Function("console", code);
      func(customConsole);
      setOutput(logs.join("\\n") || "Executed without console output.");
    } catch (e: any) {
      setHasError(true);
      setOutput(e.toString());
    } finally {
      window.setTimeout(() => setIsRunning(false), 260);
    }
  };

  return (
    <PremiumCodeShell
      language="javascript"
      code={code}
      runnable
      running={isRunning}
      onRun={runCode}
      output={output}
      outputTone={hasError ? "error" : "default"}
    >
      <ShikiHighlighter language="javascript" code={code} embedded />
    </PremiumCodeShell>
  );
};

const RunnablePython = ({ code }: { code: string }) => {
  const [output, setOutput] = React.useState<string | null>(null);
  const [isRunning, setIsRunning] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  const runPython = async () => {
    setIsRunning(true);
    setOutput(null);
    setHasError(false);
    try {
      if (!(window as any).loadPyodide) {
        if (!(window as any).pyodideLoadingPromise) {
          (window as any).pyodideLoadingPromise = new Promise<void>(
            (resolve, reject) => {
              const script = document.createElement("script");
              script.src =
                "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
              script.onload = () => resolve();
              script.onerror = reject;
              document.head.appendChild(script);
            },
          );
        }
        await (window as any).pyodideLoadingPromise;
      }

      if (!(window as any).pyodide) {
        (window as any).pyodide = await (window as any).loadPyodide({});
      }

      const pyodide = (window as any).pyodide;

      // Setup stdout/stderr capturing and window.prompt for input
      await pyodide.runPythonAsync(`
import sys
import io
import js
import builtins
import asyncio
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
def custom_input(prompt=""):
    return js.prompt(prompt) or ""
builtins.input = custom_input

# Monkey-patch asyncio.run to just run in the current loop if needed, or we'll regex replace it.
`);

      let processedCode = code;
      // Pyodide's runPythonAsync is already in an event loop, so asyncio.run will fail.
      // We replace asyncio.run(...) with await ...
      processedCode = processedCode.replace(
        /asyncio\.run\(([\s\S]*?)\)/g,
        "await $1",
      );

      await pyodide.runPythonAsync(processedCode);
      const out = await pyodide.runPythonAsync("sys.stdout.getvalue()");
      const err = await pyodide.runPythonAsync("sys.stderr.getvalue()");

      if (out || err) {
        setOutput((out + "\\n" + err).trim());
      } else {
        setOutput("Executed successfully.");
      }
    } catch (e: any) {
      setHasError(true);
      setOutput(e.message || e.toString());
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <PremiumCodeShell
      language="python"
      code={code}
      runnable
      running={isRunning}
      onRun={runPython}
      output={output}
      outputTone={hasError ? "error" : "default"}
    >
      <ShikiHighlighter language="python" code={code} embedded />
    </PremiumCodeShell>
  );
};

const InteractiveCodeBlock = React.memo(
  ({ inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const code = String(children).replace(/\n$/, "");

    if (!inline && language === "mermaid") {
      return <Mermaid chart={code} />;
    }

    // Interactive runnable JS
    if (!inline && language === "javascript") {
      return <RunnableJS code={code} />;
    }

    // Interactive runnable Python
    if (!inline && (language === "python" || language === "py")) {
      return <RunnablePython code={code} />;
    }

    return (
      <gsapMotion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {!inline && match ? (
          <PremiumCodeShell language={language} code={code}>
            <ShikiHighlighter language={language} code={code} embedded />
          </PremiumCodeShell>
        ) : (
          <code
            className="bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded font-mono text-[0.85em]"
            {...props}
          >
            {children}
          </code>
        )}
      </gsapMotion.div>
    );
  },
);

const INITIAL_MESSAGE = `**Hello. I'm your AI Tutor.**

I'm ready to help you explore concepts, discuss code, and break down complex subjects. Here are a few things we can do:
- **Analyze Documents:** Upload a PDF and ask me questions about specific pages.
- **Discuss Code:** Paste code snippets and we can debug or refactor them.
- **Learn Concepts:** Ask me general programming and computer science questions.

What would you like to learn today?`;

type ChatArchive = {
  id: string;
  title: string;
  bookId: string | null;
  bookTitle: string;
  updatedAt: number;
  messages: Message[];
};

const CHAT_ARCHIVE_KEY = "learning_ai_chat_archives_v1";
const RESERVED_LIBRARY_CONTEXT_PATTERN =
  /\b(admin\s*dashboard|app\s*design|system\s*architecture|tutor\s*system\s*architecture)\b/i;

const isReservedLibraryContext = (title?: string | null) =>
  RESERVED_LIBRARY_CONTEXT_PATTERN.test(String(title || ""));

const isGenericLibraryTitle = (title?: string | null) =>
  /^(general study|conversation notes|study session)$/i.test(
    String(title || "").trim(),
  );

const readChatArchives = (): ChatArchive[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_ARCHIVE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
};

const writeChatArchives = (archives: ChatArchive[]) => {
  localStorage.setItem(CHAT_ARCHIVE_KEY, JSON.stringify(archives.slice(0, 20)));
};

const archiveChatSnapshot = (
  items: Message[],
  bookId: string | null,
  bookTitle: string,
) => {
  const archivedMessages = meaningfulChatMessages(items);
  if (!archivedMessages.some(hasLearnerChatTurn)) return [];
  const title = chatTitleFromMessageSet(archivedMessages, bookTitle, 64);
  const snapshot: ChatArchive = {
    id: bookId || `chat:${Date.now()}`,
    title,
    bookId,
    bookTitle: bookTitle || "General Study",
    updatedAt: Date.now(),
    messages: [
      {
        id: "1",
        role: "assistant",
        content: INITIAL_MESSAGE,
      },
      ...archivedMessages,
    ],
  };
  const next = [
    snapshot,
    ...readChatArchives().filter((archive) => archive.id !== snapshot.id),
  ].slice(0, 20);
  writeChatArchives(next);
  return next;
};

const defaultChatMessages = (): Message[] => [
  {
    id: "1",
    role: "assistant",
    content: INITIAL_MESSAGE,
  },
];

const normalizeChatMessages = (items?: Message[] | null): Message[] => {
  if (!Array.isArray(items) || items.length === 0) return defaultChatMessages();
  const hasGreeting = items.some((item) => item.id === "1");
  return hasGreeting ? items : [...defaultChatMessages(), ...items];
};

const chatThreadIdForBook = (bookId: string) => `thread:${bookId}`;

const chatTitleFromMessages = (items: Message[], fallback: string) => {
  return chatTitleFromMessageSet(items, fallback, 72);
};

const shouldRecordBookChatThreadSave = (
  existing: BookChatThread | undefined,
  thread: BookChatThread,
) => {
  const summary = summarizeChatThreadPersistence(thread.messages);
  if (summary.meaningfulMessageCount === 0 || summary.mode === "empty") {
    return null;
  }
  if (existing) {
    const previous = summarizeChatThreadPersistence(existing.messages);
    if (previous.signature === summary.signature) return null;
  }
  return summary;
};

const recordBookChatThreadSaveEvent = async (
  thread: BookChatThread,
  summary: NonNullable<ReturnType<typeof shouldRecordBookChatThreadSave>>,
  proofAttemptId?: string,
) => {
  await recordMemoryEvent({
    eventType: "book_chat_thread_saved",
    status: "completed",
    source: "book_chat_thread_persistence",
    sessionId: summary.mode === "voice" ? summary.lastRequestId : undefined,
    bookId: thread.bookId,
    conversationId: thread.id,
    traceId: summary.lastRequestId || undefined,
    summary: `Saved ${summary.mode} study thread "${thread.title}" with ${summary.meaningfulMessageCount} meaningful messages.`,
    retentionPolicy: "local_indexeddb",
    metadata: {
      mode: summary.mode,
      requestId: summary.lastRequestId || undefined,
      proofAttemptId,
      requestIds: summary.requestIds,
      requestCorrelated: summary.requestCorrelated,
      hasTypedChat: summary.hasTypedChat,
      hasVoiceSession: summary.hasVoiceSession,
      messageCount: summary.messageCount,
      meaningfulMessageCount: summary.meaningfulMessageCount,
      typedTurnCount: summary.typedTurnCount,
      voiceSessionCount: summary.voiceSessionCount,
      voiceTurnCount: summary.voiceTurnCount,
      lastMessageId: summary.lastMessageId,
      persistenceSignature: summary.signature,
      threadId: thread.id,
      threadTitle: thread.title,
      bookTitle: thread.bookTitle,
    },
  });
};

const persistBookChatThread = async (
  bookId: string | null | undefined,
  bookTitle: string,
  items: Message[],
  proofAttemptId?: string,
): Promise<BookChatThread | null> => {
  if (!bookId) return null;
  const now = Date.now();
  const id = chatThreadIdForBook(bookId);
  const existing = await db.bookChatThreads
    .get(id)
    .catch((): undefined => undefined);
  const thread: BookChatThread = {
    id,
    bookId,
    bookTitle: bookTitle || "General Study",
    title: chatTitleFromMessages(items, bookTitle),
    messages: normalizeChatMessages(items),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const persistenceSummary = shouldRecordBookChatThreadSave(existing, thread);
  await db.bookChatThreads.put(thread);
  if (persistenceSummary) {
    await recordBookChatThreadSaveEvent(
      thread,
      persistenceSummary,
      proofAttemptId,
    );
  }
  return thread;
};

// ─── Smooth animated counter ──────────────────────────────────────────────────
function useAnimatedNumber(target: number, duration = 600): number {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayedRef.current;
    const to = target;
    if (from === to) return;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const next = Math.round(from + (to - from) * eased);
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        displayedRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return displayed;
}

const formatCurrency = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  // Always 2 decimal places, no trailing dots
  return `$${value.toFixed(2)}`;
};

const formatCount = (value: number): string => {
  const n = Math.round(value || 0);
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toString();
};

const formatSeconds = (value: number) => {
  if (!value) return "0s";
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
};

const compactModel = (model: string) => {
  if (!model) return "unknown";
  if (
    model === "deepseek/deepseek-v4-flash" ||
    model === "deepseek/deepseek-chat"
  )
    return "DeepSeek V4 Flash";
  const parts = model.split("/");
  return parts[parts.length - 1] || model;
};

const AnimatedNumberText = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <span
    className={`inline-block min-w-[3ch] text-right tabular-nums transition-[color,opacity] duration-200 ${className}`}
    style={{ fontVariantNumeric: "tabular-nums" }}
  >
    {children}
  </span>
);

export const UsageAnalyticsStrip = () => {
  const accessMode = useStore((state) => state.accessMode);
  const planTier = useStore((state) => state.planTier);
  const chatUsage = useStore((state) => state.chatUsage);
  const voiceUsage = useStore((state) => state.voiceUsage);
  const webUsage = useStore((state) => state.webUsage);
  const pricing = useStore((state) => state.pricing);
  const setPricing = useStore((state) => state.setPricing);
  const resetUsageAnalytics = useStore((state) => state.resetUsageAnalytics);
  const isVoiceActive = useStore((state) => state.isVoiceActive);
  const [expanded, setExpanded] = useState(false);

  // Live-animating counters
  const animInputTokens = useAnimatedNumber(chatUsage.inputTokens, 700);
  const animOutputTokens = useAnimatedNumber(chatUsage.outputTokens, 700);
  const animTtsChars = useAnimatedNumber(voiceUsage.ttsCharacters, 700);
  const animWebRequests = useAnimatedNumber(webUsage.requests, 400);
  const animSources = useAnimatedNumber(webUsage.sourcesReviewed, 400);

  // Voice seconds: tick +1 every second while connected (approximated by checking if voiceUsage is changing)
  const [liveVoiceSec, setLiveVoiceSec] = useState(
    voiceUsage.connectionSeconds,
  );
  const liveVoiceRef = useRef(voiceUsage.connectionSeconds);

  // Sync to store value whenever it jumps significantly (more than 2 seconds difference)
  useEffect(() => {
    if (Math.abs(voiceUsage.connectionSeconds - liveVoiceRef.current) > 2) {
      setLiveVoiceSec(voiceUsage.connectionSeconds);
      liveVoiceRef.current = voiceUsage.connectionSeconds;
    }
  }, [voiceUsage.connectionSeconds]);

  // Live ticker
  useEffect(() => {
    if (!isVoiceActive) return;
    const interval = setInterval(() => {
      setLiveVoiceSec((prev) => {
        const next = prev + 1;
        liveVoiceRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isVoiceActive]);

  useEffect(() => {
    if (accessMode !== "admin") return;
    let cancelled = false;
    fetch("/api/pricing")
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error("Pricing unavailable")),
      )
      .then((data) => {
        if (cancelled) return;
        setPricing({
          openRouterModels: data.openRouter?.models || {},
          deepgram: data.deepgram?.pricing || pricing.deepgram,
          fetchedAt:
            data.fetchedAt ||
            data.openRouter?.fetchedAt ||
            new Date().toISOString(),
          source: data.source || "server",
          stale: Boolean(data.stale),
        });
      })
      .catch(() => {
        if (!cancelled) setPricing({ ...pricing, stale: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessMode]);

  const chatTotal = chatUsage.inputTokens + chatUsage.outputTokens;
  const voiceBillable =
    voiceUsage.connectionSeconds + voiceUsage.ttsCharacters / 80;
  const chatWidth = `${Math.max(6, Math.min(100, (chatTotal / 1_000_000) * 100))}%`;
  const voiceWidth = `${Math.max(6, Math.min(100, (voiceBillable / 3600) * 100))}%`;
  const totalCost = chatUsage.cost + voiceUsage.cost + webUsage.cost;
  const plan = getPlanOption(planTier);
  const usedRequests = chatUsage.requests + webUsage.requests;
  const remainingRequests = Math.max(0, plan.dailyRequests - usedRequests);
  const requestWidth = `${Math.max(6, Math.min(100, (usedRequests / plan.dailyRequests) * 100))}%`;
  const serviceMinutes = estimateServiceMinutes({
    chatRequests: chatUsage.requests,
    webRequests: webUsage.requests,
    voiceSeconds: liveVoiceSec,
  });
  const serviceWidth = `${Math.max(6, Math.min(100, (serviceMinutes / 180) * 100))}%`;

  if (accessMode === "user") {
    return (
      <gsapMotion.div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0a0a] text-[#fefefe] shadow-[0_18px_54px_rgba(0,0,0,0.34)]">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_16%_0%,rgba(255,110,0,0.26),transparent_36%),radial-gradient(circle_at_90%_110%,rgba(34,211,238,0.12),transparent_38%)]" />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.14]"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(255,255,255,0.22) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="relative w-full px-4 py-3 text-left focus:outline-none"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#ff6e00]/25 bg-[#ff6e00]/12 text-[#ffb17a]">
                <Clock size={17} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
                  {plan.name} plan
                </div>
                <div className="truncate text-[13px] font-semibold text-white">
                  {formatCount(remainingRequests)} requests left
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:min-w-[390px] sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                  <span>Rate limit</span>
                  <span>
                    {formatCount(usedRequests)} /{" "}
                    {formatCount(plan.dailyRequests)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <gsapMotion.div
                    className="h-full rounded-full bg-[#ff6e00] shadow-[0_0_14px_rgba(255,110,0,0.55)]"
                    animate={{ width: requestWidth }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                  <span>Study time</span>
                  <span>{formatServiceTime(serviceMinutes)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <gsapMotion.div
                    className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.42)]"
                    animate={{ width: serviceWidth }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </button>

        <AnimatePresence>
          {expanded && (
            <gsapMotion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="relative overflow-hidden border-t border-white/10"
            >
              <div className="grid gap-2 p-3 text-[11px] text-white/55 md:grid-cols-3">
                {serviceMilestones.map((milestone) => {
                  const reached = serviceMinutes >= milestone.minutes;
                  return (
                    <div
                      key={milestone.label}
                      className="rounded-xl border border-white/10 bg-white/[0.06] p-3"
                    >
                      <div
                        className={`mb-2 h-2 rounded-full ${
                          reached
                            ? "bg-[#ff6e00] shadow-[0_0_14px_rgba(255,110,0,0.45)]"
                            : "bg-white/10"
                        }`}
                      />
                      <div className="font-semibold text-white">
                        {milestone.label}
                      </div>
                      <div>
                        {reached ? "Milestone reached" : "Keep studying"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </gsapMotion.div>
          )}
        </AnimatePresence>
      </gsapMotion.div>
    );
  }

  return (
    <gsapMotion.div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0a0a] text-[#fefefe] shadow-[0_18px_54px_rgba(0,0,0,0.34)]">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_16%_0%,rgba(255,110,0,0.28),transparent_36%),radial-gradient(circle_at_90%_110%,rgba(255,255,255,0.13),transparent_38%)]" />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.14]"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.22) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="relative w-full px-4 py-3 text-left focus:outline-none"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-bold">
                Usage
              </div>
              <div className="text-[13px] font-semibold text-white truncate">
                {formatCurrency(totalCost)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:min-w-[390px] sm:grid-cols-3">
            {/* Chat Card */}
            <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                <span>Chat</span>
                <span>{formatCurrency(chatUsage.cost)}</span>
              </div>
              <div className="mt-1 grid grid-cols-[minmax(3.5ch,auto)_auto] gap-x-1 text-[12px] font-mono text-white/85 tabular-nums">
                <div className="text-right">
                  <AnimatedNumberText>
                    {formatCount(animInputTokens)}
                  </AnimatedNumberText>
                </div>
                <span>in</span>
                <div className="text-right">
                  <AnimatedNumberText>
                    {formatCount(animOutputTokens)}
                  </AnimatedNumberText>
                </div>
                <span>out</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <gsapMotion.div
                  className="h-full rounded-full bg-[#ff6e00] shadow-[0_0_14px_rgba(255,110,0,0.55)]"
                  animate={{ width: chatWidth }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>
            {/* Voice Card */}
            <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                <span>Voice</span>
                <span>{formatCurrency(voiceUsage.cost)}</span>
              </div>
              <div className="mt-1 text-[12px] font-mono text-white/85 tabular-nums">
                <AnimatedNumberText>
                  {formatSeconds(liveVoiceSec)}
                </AnimatedNumberText>
                {" / "}
                <AnimatedNumberText>
                  {formatCount(animTtsChars)}
                </AnimatedNumberText>
                {" chars"}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <gsapMotion.div
                  className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.42)]"
                  animate={{ width: voiceWidth }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>
            {/* Search Card */}
            <div className="rounded-xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                <span>Search</span>
                <span>
                  <AnimatedNumberText>
                    {formatCount(animWebRequests)}
                  </AnimatedNumberText>{" "}
                  / 2500
                </span>
              </div>
              <div className="mt-1 text-[12px] font-mono text-white/85 tabular-nums">
                <AnimatedNumberText>
                  {formatCount(animSources)}
                </AnimatedNumberText>
                {" sources"}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <gsapMotion.div
                  className="h-full rounded-full bg-white/60 shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                  animate={{
                    width: `${Math.max(6, Math.min(100, (webUsage.requests / 2500) * 100))}%`,
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <gsapMotion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden border-t border-white/10"
          >
            <div className="grid gap-2 p-3 text-[11px] text-white/55 md:grid-cols-3">
              <div className="rounded-xl bg-white/[0.06] p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">
                  Chat · OpenRouter
                </div>
                <div>
                  Model:{" "}
                  <span className="font-mono text-white/85">
                    {compactModel(chatUsage.model)}
                  </span>
                </div>
                <div>
                  Requests:{" "}
                  <AnimatedNumberText>
                    {formatCount(chatUsage.requests)}
                  </AnimatedNumberText>
                </div>
                <div>
                  Tokens:{" "}
                  <AnimatedNumberText>
                    {formatCount(animInputTokens)}
                  </AnimatedNumberText>{" "}
                  input,{" "}
                  <AnimatedNumberText>
                    {formatCount(animOutputTokens)}
                  </AnimatedNumberText>{" "}
                  output
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">
                  Voice · Deepgram
                </div>
                <div>
                  Agent:{" "}
                  <span className="font-mono text-white/85">
                    {voiceUsage.voiceAgentModel}
                  </span>
                </div>
                <div>
                  Listen/Speak: {voiceUsage.listenModel} /{" "}
                  {voiceUsage.speakModel}
                </div>
                <div>
                  TTS: {voiceUsage.ttsModel},{" "}
                  <AnimatedNumberText>
                    {formatCount(animTtsChars)}
                  </AnimatedNumberText>{" "}
                  chars
                </div>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">
                  Search · Serper
                </div>
                <div>
                  Requests:{" "}
                  <AnimatedNumberText>
                    {formatCount(animWebRequests)}
                  </AnimatedNumberText>
                </div>
                <div>
                  Search/News:{" "}
                  <AnimatedNumberText>
                    {formatCount(webUsage.searchRequests)}
                  </AnimatedNumberText>{" "}
                  /{" "}
                  <AnimatedNumberText>
                    {formatCount(webUsage.newsRequests)}
                  </AnimatedNumberText>
                </div>
                <div>
                  Sources reviewed:{" "}
                  <AnimatedNumberText>
                    {formatCount(animSources)}
                  </AnimatedNumberText>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={resetUsageAnalytics}
              className="mx-3 mb-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/55 hover:text-white hover:bg-white/[0.1] transition-colors"
            >
              <RotateCcw size={12} /> Reset usage
            </button>
          </gsapMotion.div>
        )}
      </AnimatePresence>
    </gsapMotion.div>
  );
};

const GeminiVoicePill = ({
  state,
}: {
  state: "listening" | "speaking" | "idle";
}) => {
  const [vol, setVol] = useState(0);

  useEffect(() => {
    if (state !== "listening") {
      setVol(0);
      return;
    }
    const handler = (e: any) => {
      setVol((prev) => prev + (e.detail - prev) * 0.3);
    };
    window.addEventListener("mic-volume", handler);
    return () => window.removeEventListener("mic-volume", handler);
  }, [state]);

  useEffect(() => {
    if (state === "speaking") {
      const interval = setInterval(() => {
        setVol(0.3 + Math.random() * 0.4);
      }, 150);
      return () => clearInterval(interval);
    }
  }, [state]);

  return (
    <gsapMotion.div
      initial={{ y: 50, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 50, opacity: 0, scale: 0.9 }}
      className="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center justify-center overflow-hidden rounded-[28px] border border-zinc-200/70 bg-[#faf9f6]/95 shadow-[0_24px_70px_rgba(24,24,27,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-3xl z-[100]"
      style={{
        width: state === "speaking" ? "300px" : "240px",
        height: "64px",
        transition: "width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      }}
    >
      <div className="absolute inset-0 overflow-hidden blur-[10px] opacity-70">
        <gsapMotion.div
          className="absolute w-[200%] h-[200%] top-[-50%] left-[-50%]"
          animate={{ rotate: 360 }}
          transition={{
            duration: state === "speaking" ? 3 : 8,
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <gsapMotion.div
            className="absolute top-[10%] right-[30%] w-[40%] h-[40%] bg-[#0a84ff] rounded-full mix-blend-screen"
            animate={{ scale: 1 + vol * 1.5, x: vol * 10, y: vol * 10 }}
            transition={{ type: "spring", bounce: 0.5 }}
          />
          <gsapMotion.div
            className="absolute bottom-[30%] right-[10%] w-[45%] h-[45%] bg-[#bf5af2] rounded-full mix-blend-screen"
            animate={{ scale: 1 + vol * 1.2, x: -(vol * 10) }}
            transition={{ type: "spring", bounce: 0.5 }}
          />
          <gsapMotion.div
            className="absolute bottom-[10%] left-[30%] w-[50%] h-[50%] bg-[#ff375f] rounded-full mix-blend-screen"
            animate={{ scale: 1 + vol * 1.4, y: -(vol * 15) }}
            transition={{ type: "spring", bounce: 0.5 }}
          />
        </gsapMotion.div>
      </div>

      <div className="relative z-10 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/80 px-6 py-2 font-medium tracking-wide text-zinc-950 shadow-[0_12px_34px_rgba(24,24,27,0.12)] backdrop-blur-md">
        {state === "speaking" ? (
          <>
            <Activity size={18} className="text-blue-400 animate-pulse" />
            <span>Aria is speaking...</span>
          </>
        ) : (
          <>
            <Mic size={18} className="text-emerald-400 animate-pulse" />
            <span>Listening...</span>
          </>
        )}
      </div>
    </gsapMotion.div>
  );
};

const sourceToneForDomain = (domain = "") => {
  const value = domain.toLowerCase();
  if (value.includes("youtube"))
    return {
      label: "YT",
      className: "bg-[#ff0033] text-white",
      icon: Play,
    };
  if (value.includes("reddit"))
    return { label: "R", className: "bg-[#ff4500] text-white", icon: null };
  if (value.includes("ncbi") || value.includes("nih") || value.includes("pmc"))
    return {
      label: "P",
      className: "bg-slate-800 text-white",
      icon: BookOpen,
    };
  if (value.includes("investopedia"))
    return {
      label: "I",
      className: "bg-[#29364f] text-white",
      icon: Activity,
    };
  return {
    label: (domain || "?").slice(0, 1).toUpperCase(),
    className: "bg-zinc-900 text-white",
    icon: Globe2,
  };
};

const SourceGlyph = ({
  domain,
  className = "h-5 w-5",
}: {
  domain: string;
  className?: string;
}) => {
  const tone = sourceToneForDomain(domain);
  const Icon = tone.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md text-[10px] font-black shadow-sm ${tone.className} ${className}`}
      aria-hidden="true"
    >
      {Icon ? <Icon size={12} strokeWidth={2.5} /> : tone.label}
    </span>
  );
};

const SearchProgressIndicator = ({
  active,
  error,
}: {
  active: boolean;
  error?: boolean;
}) => (
  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-[0_10px_24px_rgba(0,0,0,0.08)]">
    {active ? (
      <LoaderCircle
        size={15}
        className="relative z-10 animate-spin text-[#ff6e00]"
      />
    ) : error ? (
      <X size={15} className="relative z-10 text-red-500" />
    ) : (
      <Check size={15} className="relative z-10 text-[#36AA55]" />
    )}
    {active && (
      <gsapMotion.div
        className="absolute inset-[-3px] rounded-[18px] border border-[#ff6e00]/55"
        animate={{ rotate: 360, opacity: [0.25, 0.8, 0.25] }}
        transition={{
          rotate: { repeat: Infinity, duration: 2.4, ease: "linear" },
          opacity: { repeat: Infinity, duration: 1.6 },
        }}
      />
    )}
  </div>
);

const SourceCards = ({
  sources,
  compact = false,
  tone = "light",
}: {
  sources: NormalizedWebSource[];
  compact?: boolean;
  tone?: "light" | "dark";
}) => {
  if (!sources.length) return null;
  const dark = tone === "dark";
  return (
    <div className={`grid gap-2 ${compact ? "sm:grid-cols-2" : ""}`}>
      {sources.slice(0, compact ? 6 : 4).map((source, index) => (
        <gsapMotion.a
          key={source.id || source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.25 }}
          className={`group block rounded-xl p-3 transition-colors ${dark ? "border border-white/10 bg-white/[0.06] hover:bg-white/[0.09]" : "border border-black/5 bg-white/80 shadow-[0_10px_24px_rgba(0,0,0,0.06)] hover:bg-white"}`}
        >
          <div className="flex items-start gap-2.5">
            {(source.thumbnailUrl || source.imageUrl) && (
              <span
                className={`relative mt-0.5 block h-14 w-16 shrink-0 overflow-hidden rounded-lg border ${dark ? "border-white/10 bg-white/5" : "border-zinc-200 bg-zinc-100"}`}
              >
                <img
                  src={source.thumbnailUrl || source.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-white">
                  image
                </span>
              </span>
            )}
            <SourceGlyph domain={source.domain} className="mt-0.5 h-5 w-5" />
            <div className="min-w-0 flex-1">
              <div
                className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${dark ? "text-zinc-500" : "text-zinc-400"}`}
              >
                <span className="truncate">{source.domain}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] ${dark ? "bg-white/10 text-zinc-400" : "bg-zinc-950/[0.06] text-zinc-500"}`}
                >
                  {index + 1}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] ${dark ? "bg-blue-400/10 text-blue-200" : "bg-blue-50 text-blue-600"}`}
                >
                  {source.sourceType === "image"
                    ? "image source"
                    : "citation checking"}
                </span>
              </div>
              <div
                className={`mt-1 line-clamp-2 text-[12px] font-semibold leading-snug ${dark ? "text-zinc-200 group-hover:text-white" : "text-zinc-800 group-hover:text-zinc-950"}`}
              >
                {source.title}
              </div>
              {source.snippet && (
                <div
                  className={`mt-1.5 line-clamp-2 text-[11px] leading-snug ${dark ? "text-zinc-500" : "text-zinc-500"}`}
                >
                  {source.snippet}
                </div>
              )}
            </div>
            <ExternalLink
              size={12}
              className={`mt-0.5 shrink-0 ${dark ? "text-zinc-600 group-hover:text-zinc-300" : "text-zinc-300 group-hover:text-zinc-500"}`}
            />
          </div>
        </gsapMotion.a>
      ))}
    </div>
  );
};

const SearchActivityPanel = ({
  webSearch,
}: {
  webSearch?: Message["webSearch"];
}) => {
  if (
    !webSearch ||
    (!webSearch.query && webSearch.sources.length === 0 && !webSearch.status)
  )
    return null;
  const completed = !webSearch.active && !webSearch.error;
  const status =
    webSearch.error ||
    (completed
      ? webSearch.status ||
        `Reviewed ${webSearch.sources.length} source${webSearch.sources.length === 1 ? "" : "s"}`
      : webSearch.status || "Searching web...");
  return (
    <gsapMotion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 shadow-[0_12px_34px_rgba(0,0,0,0.05)]"
    >
      <div className="flex items-start gap-3">
        <SearchProgressIndicator
          active={webSearch.active}
          error={Boolean(webSearch.error)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#ff6e00]">
              Web Search
            </span>
            {webSearch.mode && (
              <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
                {webSearch.mode}
              </span>
            )}
            {completed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                <Check size={11} /> Done
              </span>
            )}
          </div>
          {webSearch.query && (
            <div className="mt-1 text-[13px] font-semibold leading-snug text-zinc-800">
              "{webSearch.query}"
            </div>
          )}
          {webSearch.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {webSearch.sources.slice(0, 4).map((source) => (
                <gsapMotion.a
                  key={`chip-${source.id || source.url}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-950"
                >
                  <SourceGlyph domain={source.domain} className="h-4 w-4" />
                  <span className="truncate">{source.domain}</span>
                </gsapMotion.a>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-[12px] text-zinc-500">
            {webSearch.active ? (
              <LoaderCircle size={12} className="animate-spin text-[#ff6e00]" />
            ) : completed ? (
              <Check size={12} className="text-[#36AA55]" />
            ) : null}
            <span>{status}</span>
          </div>
          {webSearch.sources.length > 0 && (
            <div className="mt-3">
              <SourceCards sources={webSearch.sources} tone="light" />
            </div>
          )}
        </div>
      </div>
    </gsapMotion.div>
  );
};

const FinalSourcesPanel = ({ sources }: { sources: NormalizedWebSource[] }) => {
  const [expanded, setExpanded] = useState(false);
  if (!sources.length) return null;
  const imageSources = sources
    .filter(
      (source) =>
        source.sourceType === "image" &&
        (source.imageUrl || source.thumbnailUrl),
    )
    .slice(0, 4);
  return (
    <div className="not-prose mt-5 overflow-hidden rounded-2xl border border-black/5 bg-zinc-50/80">
      {imageSources.length > 0 && (
        <div
          className={`grid gap-2 p-3 pb-0 ${imageSources.length === 1 ? "" : "grid-cols-2"}`}
          data-web-image-strip
        >
          <style>{`
            /* Genmoji-style materialize: each image condenses out of a blur
               with a soft overshoot, then a light sweep passes over it. */
            @keyframes webImageMaterialize {
              0% {
                opacity: 0;
                transform: scale(0.55) rotate(-3deg);
                filter: blur(16px) saturate(0.2) brightness(1.6);
              }
              55% {
                opacity: 1;
                filter: blur(2px) saturate(0.85) brightness(1.12);
              }
              78% {
                transform: scale(1.035) rotate(0.4deg);
              }
              100% {
                opacity: 1;
                transform: scale(1) rotate(0deg);
                filter: blur(0) saturate(1) brightness(1);
              }
            }
            @keyframes webImageSweep {
              0% { transform: translateX(-130%) skewX(-14deg); opacity: 0; }
              35% { opacity: 0.9; }
              100% { transform: translateX(160%) skewX(-14deg); opacity: 0; }
            }
            @keyframes webImageHalo {
              0% { opacity: 0.85; transform: scale(0.6); }
              100% { opacity: 0; transform: scale(1.25); }
            }
            [data-web-image-spawn] {
              opacity: 0;
              animation: webImageMaterialize 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            }
            [data-web-image-spawn] .web-image-sweep {
              animation: webImageSweep 1.1s ease-out forwards;
              animation-delay: inherit;
            }
            [data-web-image-spawn] .web-image-halo {
              animation: webImageHalo 1.15s ease-out forwards;
              animation-delay: inherit;
            }
            @media (prefers-reduced-motion: reduce) {
              [data-web-image-spawn],
              [data-web-image-spawn] .web-image-sweep,
              [data-web-image-spawn] .web-image-halo {
                animation: none !important;
                opacity: 1 !important;
              }
              [data-web-image-spawn] .web-image-sweep,
              [data-web-image-spawn] .web-image-halo {
                display: none;
              }
            }
          `}</style>
          {imageSources.map((source, index) => (
            <a
              key={`strip-${source.id || source.url}`}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              data-web-image-spawn
              style={{ animationDelay: `${index * 140}ms` }}
              className={`group relative block overflow-hidden rounded-2xl border border-black/5 bg-zinc-100 shadow-[0_14px_36px_rgba(24,24,27,0.14)] ${
                imageSources.length === 3 && index === 0 ? "col-span-2" : ""
              }`}
            >
              <img
                src={source.imageUrl || source.thumbnailUrl}
                alt={source.title || "Web image result"}
                loading="lazy"
                className={`w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] ${
                  imageSources.length === 1 ||
                  (imageSources.length === 3 && index === 0)
                    ? "h-44 sm:h-52"
                    : "h-32 sm:h-36"
                }`}
              />
              <span
                className="web-image-halo pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  background:
                    "radial-gradient(ellipse at center, rgba(255,255,255,0.55) 0%, rgba(255,170,80,0.18) 45%, transparent 72%)",
                }}
              />
              <span className="web-image-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6">
                <span className="block truncate text-[11px] font-semibold text-white">
                  {source.title}
                </span>
                <span className="block truncate text-[9px] font-bold uppercase tracking-[0.12em] text-white/70">
                  {source.imageSource || source.domain}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold text-zinc-700">
          <Globe2 size={14} className="text-indigo-500" />
          {sources.length} source{sources.length === 1 ? "" : "s"} reviewed
        </span>
        <gsapMotion.span animate={{ rotate: expanded ? 180 : 0 }}>
          <ChevronDown size={14} className="text-zinc-400" />
        </gsapMotion.span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <gsapMotion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-black/5 p-3"
          >
            <SourceCards sources={sources} compact />
          </gsapMotion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const VoiceVisualFocusPanel = ({
  focuses,
}: {
  focuses?: VoiceVisualFocus[];
}) => {
  const visibleFocuses = (focuses || []).filter(
    (focus) => focus.kind !== "current_page",
  );
  if (!visibleFocuses.length) return null;
  return (
    <div
      data-voice-visual-focus-panel
      className="space-y-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-700">
          <ImageIcon size={11} /> Voice visual focus
        </span>
        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
          {visibleFocuses.length} visual event
          {visibleFocuses.length === 1 ? "" : "s"}
        </span>
      </div>
      {visibleFocuses.slice(-3).map((focus) => (
        <div
          key={focus.id}
          data-voice-visual-focus-kind={focus.kind}
          className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-[0_10px_24px_rgba(59,130,246,0.08)]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                focus.status === "ready"
                  ? "border-green-200 bg-green-50 text-green-700"
                  : focus.status === "blocked" || focus.status === "failed"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {focus.status}
            </span>
            <span className="text-[12px] font-semibold text-zinc-900">
              {focus.title}
            </span>
            {focus.focusedTarget && (
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-blue-700">
                focus {focus.focusedTarget}
              </span>
            )}
            {typeof focus.imageCount === "number" && (
              <span className="rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-purple-700">
                {focus.imageCount} image{focus.imageCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {focus.query && (
            <div className="mt-1 text-[11px] font-medium leading-snug text-zinc-500">
              Query: {focus.query}
            </div>
          )}
          {focus.summary && (
            <div className="mt-2 text-[12px] leading-relaxed text-zinc-700">
              {focus.summary}
            </div>
          )}
          {focus.kind === "diagram" && focus.mermaid ? (
            <div className="mt-3" data-voice-mermaid-diagram>
              <Mermaid chart={focus.mermaid} />
            </div>
          ) : null}
          {focus.sources?.length ? (
            <div className="mt-3">
              <SourceCards
                sources={focus.sources as NormalizedWebSource[]}
                compact
                tone="light"
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

const thoughtStepMeta = (content: string, phase: string) => {
  const value = content.toLowerCase();
  if (
    value.includes("web") ||
    value.includes("source") ||
    value.includes("search")
  )
    return {
      icon: ProgressIcon,
      label: "Search",
      bg: "bg-[#E7F3FF]",
      text: "text-[#0A7DFF]",
    };
  if (
    value.includes("page") ||
    value.includes("screen") ||
    value.includes("screenshot") ||
    value.includes("visual")
  )
    return {
      icon: SubmittedIcon,
      label: "Vision",
      bg: "bg-[#F1EAFC]",
      text: "text-[#6929F4]",
    };
  if (value.includes("tool") || value.includes("execut"))
    return {
      icon: SuccessIcon,
      label: "Tool",
      bg: "bg-[#E6F8EA]",
      text: "text-[#36AA55]",
    };
  if (value.includes("graph") || value.includes("concept"))
    return {
      icon: PendingIcon,
      label: "Graph",
      bg: "bg-[#FDF1E8]",
      text: "text-[#D87A2C]",
    };
  if (value.includes("flashcard") || value.includes("revision"))
    return {
      icon: ReviewIcon,
      label: "Recall",
      bg: "bg-[#FDF4DD]",
      text: "text-[#D49B23]",
    };
  if (value.includes("synth") || phase === "synthesizing")
    return {
      icon: SubmittedIcon,
      label: "Synthesis",
      bg: "bg-[#F1EAFC]",
      text: "text-[#6929F4]",
    };
  return {
    icon: ExpiredIcon,
    label: "Reasoning",
    bg: "bg-[#F3F3F3]",
    text: "text-[#6A6A6A]",
  };
};

const getStatusBadge = (
  phase: string,
  isComplete: boolean,
  hasError?: boolean,
) => {
  if (hasError) return "failed";
  if (isComplete) return "success";
  if (phase === "retrieving" || phase === "web_search") return "review";
  if (phase === "idle" && !isComplete) return "pending";
  return "progress";
};

const reasoningTraceEase: [number, number, number, number] = [0.16, 1, 0.3, 1];
const reasoningTraceStepGap = 0.48;
const reasoningTraceDelay = (index: number, offset = 0) =>
  index * reasoningTraceStepGap + offset;

const reasoningStepVariants: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(6px)" },
  show: (index: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.24,
      ease: reasoningTraceEase,
      delay: reasoningTraceDelay(index),
    },
  }),
};

const reasoningIconVariants: Variants = {
  hidden: { opacity: 0, scale: 0.34, rotate: -16, y: 2 },
  show: (index: number) => ({
    opacity: 1,
    scale: 0.6,
    rotate: [-14, 9, -3, 0],
    y: [1, -1, 0],
    transition: {
      opacity: {
        duration: 0.14,
        delay: reasoningTraceDelay(index, 0.02),
      },
      scale: {
        type: "spring",
        stiffness: 560,
        damping: 21,
        delay: reasoningTraceDelay(index, 0.02),
      },
      rotate: {
        duration: 0.42,
        ease: "easeOut",
        delay: reasoningTraceDelay(index, 0.03),
      },
      y: {
        duration: 0.3,
        ease: "easeOut",
        delay: reasoningTraceDelay(index, 0.03),
      },
    },
  }),
};

const reasoningLineVariants: Variants = {
  hidden: { scaleY: 0, opacity: 0 },
  show: (index: number) => ({
    scaleY: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: reasoningTraceEase,
      delay: reasoningTraceDelay(index, 0.18),
    },
  }),
};

const reasoningTextVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -3,
    backgroundPosition: "155% 50%",
  },
  show: (index: number) => ({
    opacity: 1,
    x: 0,
    backgroundPosition: ["155% 50%", "45% 50%", "-70% 50%"],
    transition: {
      opacity: {
        duration: 0.16,
        delay: reasoningTraceDelay(index, 0.11),
      },
      x: {
        duration: 0.22,
        ease: reasoningTraceEase,
        delay: reasoningTraceDelay(index, 0.11),
      },
      backgroundPosition: {
        duration: 0.72,
        ease: "easeInOut",
        delay: reasoningTraceDelay(index, 0.12),
      },
    },
  }),
};

const reasoningShimmerTextStyle: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(100deg, #52525b 0%, #52525b 34%, #111827 45%, #a1a1aa 52%, #52525b 66%, #52525b 100%)",
  backgroundSize: "240% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const ThinkingPanel = ({
  phase,
  steps,
  isComplete,
  webSearch,
  hasError,
}: {
  phase: string;
  steps: any[];
  isComplete: boolean;
  webSearch?: Message["webSearch"];
  hasError?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);

  if (phase === "idle" && steps.length === 0) return null;
  const { t } = useTranslation();
  const visibleSteps = isComplete
    ? steps.filter(
        (step) => !/synthesizing\s+(final\s+)?answer/i.test(step.content),
      )
    : steps;
  const latestStep = visibleSteps[visibleSteps.length - 1] || steps[0];
  const latestMeta = thoughtStepMeta(latestStep?.content || phase, phase);
  const LatestIcon = latestMeta.icon;
  const activeLabel = isComplete
    ? "Complete"
    : phase === "retrieving"
      ? "Searching"
      : phase === "web_search"
        ? "Reviewing"
        : phase === "tool_execution"
          ? "Running"
          : phase === "synthesizing"
            ? "Synthesizing"
            : t("thinking_process");
  const traceKey = `${visibleSteps.map((step) => step.id).join("-")}-${webSearch?.sources.length || 0}`;
  const previewText = isComplete
    ? webSearch?.status && webSearch.sources.length > 0
      ? webSearch.status
      : "Answer ready."
    : latestStep?.content ||
      webSearch?.status ||
      "Preparing the reasoning trace...";

  return (
    <div
      data-reasoning-dropdown
      className="not-prose mb-5 mt-2 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white/90 font-sans shadow-[0_18px_45px_rgba(0,0,0,0.06)]"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-zinc-50"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${latestMeta.bg} ${latestMeta.text}`}
          >
            <gsapMotion.div
              animate={
                !isComplete
                  ? { rotate: [0, -6, 6, 0], y: [0, -1, 0] }
                  : { rotate: 0, y: 0 }
              }
              transition={{
                repeat: !isComplete ? Infinity : 0,
                duration: 1.45,
                ease: "easeInOut",
              }}
              className="scale-[0.68]"
            >
              <LatestIcon />
            </gsapMotion.div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-zinc-900">
                Reasoning trace
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                {activeLabel}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[12px] leading-snug text-zinc-500">
              {previewText}
            </div>
          </div>
        </div>
        <gsapMotion.span animate={{ rotate: expanded ? 180 : 0 }}>
          <ChevronDown size={16} className="text-zinc-400" />
        </gsapMotion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <gsapMotion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-zinc-100"
          >
            <gsapMotion.div
              key={`reasoning-trace-open-${traceKey}`}
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: {} }}
              className="space-y-1 px-3 py-3 text-[13px] text-zinc-500"
            >
              {visibleSteps.map((step, idx) => {
                const meta = thoughtStepMeta(step.content, phase);
                const active =
                  !isComplete &&
                  idx === visibleSteps.length - 1 &&
                  phase !== "complete";
                return (
                  <gsapMotion.div
                    key={step.id}
                    custom={idx}
                    variants={reasoningStepVariants}
                    className="group/step relative flex flex-col items-start gap-1.5 rounded-2xl px-2 py-3 transition-colors hover:bg-zinc-50"
                  >
                    {idx < visibleSteps.length - 1 && (
                      <gsapMotion.div
                        custom={idx}
                        variants={reasoningLineVariants}
                        className="absolute bottom-[-12px] left-[26px] top-10 w-px origin-top bg-black/10"
                      />
                    )}

                    <div className="flex items-center gap-2">
                      <div
                        className={`inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-[11px] font-medium tracking-tight ${meta.bg} ${meta.text}`}
                      >
                        <gsapMotion.div
                          custom={idx}
                          variants={reasoningIconVariants}
                          className="-mx-1 flex origin-center items-center justify-center"
                        >
                          <meta.icon />
                        </gsapMotion.div>
                        {meta.label}
                      </div>
                      {active && (
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 shadow-sm animate-pulse" />
                      )}
                    </div>

                    <gsapMotion.div
                      custom={idx}
                      variants={reasoningTextVariants}
                      style={reasoningShimmerTextStyle}
                      className="mt-1 pl-[32px] text-[12px] leading-relaxed tracking-tight transition-colors"
                    >
                      {step.content}
                    </gsapMotion.div>
                  </gsapMotion.div>
                );
              })}
              {webSearch && (
                <gsapMotion.div
                  custom={steps.length}
                  variants={reasoningStepVariants}
                >
                  <SearchActivityPanel webSearch={webSearch} />
                </gsapMotion.div>
              )}

              {!isComplete && (
                <gsapMotion.div
                  custom={steps.length}
                  variants={reasoningStepVariants}
                  className="group/step relative flex flex-col items-start gap-1.5 rounded-2xl px-2 py-3 transition-colors hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#E7F3FF] px-3 py-1.5 text-[11px] font-medium tracking-tight text-[#0A7DFF]">
                      <gsapMotion.div
                        custom={steps.length}
                        variants={reasoningIconVariants}
                        className="-mx-1 flex origin-center items-center justify-center"
                      >
                        <ProgressIcon />
                      </gsapMotion.div>
                      {activeLabel}
                    </div>
                  </div>

                  <gsapMotion.div
                    custom={steps.length}
                    variants={reasoningTextVariants}
                    style={reasoningShimmerTextStyle}
                    className="mt-1 pl-[32px] text-[12px] italic tracking-tight"
                  >
                    Loading...
                  </gsapMotion.div>
                </gsapMotion.div>
              )}
            </gsapMotion.div>
          </gsapMotion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const markdownComponents = {
  p: ({ children, ...props }: any) => (
    <div className="mb-2 last:mb-0" {...props}>
      {children}
    </div>
  ),
  li: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
  h2: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
  h3: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  blockquote: ({ children, ...props }: any) => (
    <blockquote {...props}>{children}</blockquote>
  ),
  code: InteractiveCodeBlock,
};

function useSmoothStreamingText(
  rawContent: string,
  isStreaming: boolean,
): string {
  const [displayedContent, setDisplayedContent] = useState(
    isStreaming ? "" : rawContent,
  );
  const queueRef = useRef<string>(rawContent);
  const displayedRef = useRef<string>(isStreaming ? "" : rawContent);
  const rafRef = useRef<number | null>(null);

  const wasStreamingRef = useRef(isStreaming);
  if (isStreaming) {
    wasStreamingRef.current = true;
  }

  useEffect(() => {
    queueRef.current = rawContent;

    if (!wasStreamingRef.current) {
      displayedRef.current = rawContent;
      setDisplayedContent(rawContent);
      return;
    }

    if (!isStreaming) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      displayedRef.current = rawContent;
      setDisplayedContent(rawContent);
      return;
    }

    if (rafRef.current === null) {
      // Markdown is parsed on every committed update, so batch keystrokes into
      // ~20fps state commits (3 frames) with proportionally larger chunks —
      // same visual typing speed, a third of the parse work.
      let frameSkip = 0;
      const tick = () => {
        const target = queueRef.current;
        const current = displayedRef.current;

        if (current !== target) {
          if (frameSkip > 0) {
            frameSkip -= 1;
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          frameSkip = 2;
          let nextContent = target;
          if (target.startsWith(current) && target.length > current.length) {
            const diff = target.length - current.length;
            // Base speed ~180 chars/sec; if lagging, speed up but cap at
            // ~720 chars/sec so it always looks like smooth typing and never
            // jumps in huge blocks.
            const speed = diff > 90 ? Math.min(36, Math.ceil(diff / 15)) : 9;
            const charsToAdd = Math.min(diff, speed);
            nextContent = target.slice(0, current.length + charsToAdd);
          } else {
            nextContent = target;
          }
          displayedRef.current = nextContent;
          setDisplayedContent(nextContent);
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [rawContent, isStreaming]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return displayedContent;
}

const AnimatedMarkdown = React.memo(
  ({
    content,
    isVoice,
    animationsEnabled = true,
    isStreaming = false,
  }: {
    content: string;
    isVoice?: boolean;
    animationsEnabled?: boolean;
    isStreaming?: boolean;
  }) => {
    const smoothContent =
      animationsEnabled && !isVoice
        ? useSmoothStreamingText(content, isStreaming)
        : content;

    const showCursor =
      animationsEnabled && !isVoice && isStreaming && smoothContent.length > 0;

    return (
      <div className={`streaming-text ${showCursor ? "typing-active" : ""}`}>
        <style>{`
        .streaming-text {
          overflow-wrap: anywhere;
          text-rendering: geometricPrecision;
          contain: content;
        }
        /* Blinking caret rides the last rendered block so streamed markdown
           keeps its real formatting instead of flashing raw syntax first. */
        .streaming-text.typing-active > :last-child > :last-child::after,
        .streaming-text.typing-active > p:last-child::after {
          content: '';
          display: inline-block;
          width: 6px;
          height: 18px;
          background-color: #a1a1aa; /* zinc-400 */
          vertical-align: text-bottom;
          margin-left: 4px;
          border-radius: 1px;
          animation: terminalBlink 1s step-start infinite;
          transition: opacity 0.2s ease;
        }
        @keyframes terminalBlink {
          50% { opacity: 0; }
        }
      `}</style>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {smoothContent}
        </ReactMarkdown>
      </div>
    );
  },
);

const MessageUsageFooter = ({
  usage,
}: {
  usage: NonNullable<Message["usage"]>;
}) => {
  const input = Math.max(0, Math.round(usage.inputTokens || 0));
  const output = Math.max(0, Math.round(usage.outputTokens || 0));
  const total = input + output;
  const animatedTotal = useAnimatedNumber(total, 1100);

  return (
    <gsapMotion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="not-prose mt-2 flex justify-end text-[10px] font-medium tracking-tight text-zinc-400"
      aria-live="polite"
    >
      <span className="flex min-w-[10.25rem] items-center justify-end gap-1 rounded-full bg-zinc-50/95 px-2 py-1 tabular-nums">
        <AnimatedNumberText className="min-w-[4.5ch]">
          {formatCount(animatedTotal)}
        </AnimatedNumberText>{" "}
        tokens · {formatCurrency(usage.cost || 0)}
      </span>
    </gsapMotion.div>
  );
};

const READ_ALOUD_VOICE_LABELS: Record<string, string> = {
  "miso-tts-8b": "MisoTTS 8B",
  "gpt-4o-mini-tts": "OpenAI TTS",
  "aura-asteria-en": "Asteria",
  "aura-luna-en": "Luna",
  "aura-stella-en": "Stella",
  "aura-athena-en": "Athena",
};

const getReadAloudVoiceLabel = (voice?: string) => {
  return READ_ALOUD_VOICE_LABELS[voice || ""] || voice || "Asteria";
};

const getReadAloudVoiceTooltip = (voice?: string) => {
  const label = getReadAloudVoiceLabel(voice);
  if (voice === "miso-tts-8b") {
    return "Read Aloud voice: MisoTTS 8B via local HTTP TTS. Custom Live Voice uses Deepgram Aura streaming TTS when configured.";
  }
  return `Read Aloud voice: ${label}.`;
};

const MessageItem = React.memo(
  ({
    msg,
    sendState,
    isLast,
    animationsEnabled,
    isPlayingTTS,
    ttsVoice,
    onSendMessage,
    onHandleTTS,
    onSetActiveView,
    setMessages,
    apiKey,
    activeBookId,
    activeBookTitle,
  }: {
    msg: any;
    sendState: string;
    isLast?: boolean;
    animationsEnabled: boolean;
    isPlayingTTS: string | null;
    ttsVoice: string;
    onSendMessage: (msg: string) => void;
    onHandleTTS: (id: string, content: string) => void;
    onSetActiveView: (view: string) => void;
    setMessages: React.Dispatch<React.SetStateAction<any[]>>;
    apiKey: string;
    activeBookId: string | null;
    activeBookTitle: string;
  }) => {
    const [isGeneratingFlashcards, setIsGeneratingFlashcards] =
      React.useState(false);
    const [isVoiceSessionOpen, setIsVoiceSessionOpen] = React.useState(false);
    const readAloudVoiceLabel = getReadAloudVoiceLabel(ttsVoice);
    const readAloudVoiceTooltip = getReadAloudVoiceTooltip(ttsVoice);
    const isMisoReadAloudVoice = ttsVoice === "miso-tts-8b";

    const handleGenerateFlashcards = async () => {
      setIsGeneratingFlashcards(true);
      try {
        const openRouterKey =
          apiKey ||
          localStorage.getItem("openrouter_api_key") ||
          localStorage.getItem("api_key") ||
          "";
        const response = await fetch("/api/generate-flashcards", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: openRouterKey ? `Bearer ${openRouterKey}` : "",
          },
          body: JSON.stringify({ content: msg.content }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Flashcard generation failed");
        }
        const data = await response.json();

        const cards = Array.isArray(data.cards) ? data.cards : [];
        const validCards = cards.filter(
          (card: any) => card?.front && card?.back,
        );
        if (validCards.length > 0) {
          const storedFlashcards = await Promise.all(
            validCards.map(async (card: any) => {
              const { flashcard } = await createFlashcardForStorage(card, {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                bookId: activeBookId || undefined,
                bookTitle: activeBookTitle || undefined,
              });
              await db.flashcards.add(flashcard);
              return flashcard;
            }),
          );
          void recordGeneratedFlashcardsArtifact({
            batchId: `${msg.id}:manual-flashcards`,
            cards: storedFlashcards,
            source: "manual_message_flashcard_generation",
            sourceMessageId: msg.id,
            messageId: msg.id,
            conversationId: activeBookId
              ? chatThreadIdForBook(activeBookId)
              : undefined,
            bookId: activeBookId || undefined,
            bookTitle: activeBookTitle || undefined,
            metadata: {
              generationPath: "message_action",
              sourceRole: msg.role,
            },
          });

          setMessages((prev) => {
            const newM = [...prev];
            const idx = newM.findIndex((m) => m.id === msg.id);
            if (idx !== -1) {
              newM[idx] = { ...newM[idx], hasFlashcards: true };
            }
            return newM;
          });
        } else {
          throw new Error("No flashcards were returned.");
        }
      } catch (e) {
        console.warn("Flashcard generation failed:", e);
      } finally {
        setIsGeneratingFlashcards(false);
      }
    };

    if (msg.voiceSession) {
      const session = msg.voiceSession as NonNullable<Message["voiceSession"]>;
      const turns = session.turns || [];
      const seconds = Math.max(0, Math.round(session.durationSeconds || 0));
      const elapsed = `${Math.floor(seconds / 60)}:${(seconds % 60)
        .toString()
        .padStart(2, "0")}`;
      return (
        <gsapMotion.div
          data-message-id={msg.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, type: "spring", bounce: 0.15 }}
          className="flex w-full flex-col items-start"
        >
          <div className="w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <button
              type="button"
              onClick={() => setIsVoiceSessionOpen((open) => !open)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 focus:outline-none"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-500/20 bg-blue-500/10 text-blue-500">
                <Mic size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-zinc-800">
                  {session.title || "Voice conversation"}
                </span>
                <span className="block text-[11px] text-zinc-500">
                  Voice · {turns.length} message
                  {turns.length === 1 ? "" : "s"} · {elapsed}
                </span>
              </span>
              <ChevronDown
                size={16}
                className={`shrink-0 text-zinc-400 transition-transform duration-300 ${
                  isVoiceSessionOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            <AnimatePresence initial={false}>
              {isVoiceSessionOpen && (
                <gsapMotion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="overflow-hidden border-t border-black/5"
                >
                  <div className="space-y-3 px-4 py-3.5">
                    <VoiceVisualFocusPanel
                      focuses={session.visualFocuses || []}
                    />
                    {turns.length === 0 && (
                      <div className="text-[12px] text-zinc-400">
                        No transcript captured.
                      </div>
                    )}
                    {turns.map((turn) => (
                      <div
                        key={turn.id}
                        className={`flex flex-col ${
                          turn.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <span className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                          {turn.role === "user" ? "You" : "Aria"}
                        </span>
                        <div
                          className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] font-medium leading-relaxed ${
                            turn.role === "user"
                              ? "rounded-br-sm bg-[#1C1C1E] text-white"
                              : "rounded-bl-sm bg-zinc-100 text-zinc-800"
                          }`}
                        >
                          {turn.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </gsapMotion.div>
              )}
            </AnimatePresence>
          </div>
        </gsapMotion.div>
      );
    }

    return (
      <gsapMotion.div
        data-message-id={msg.id}
        initial={{
          opacity: 0,
          y: msg.role === "user" ? 15 : 10,
          scale: msg.role === "user" ? 0.98 : 1,
        }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, type: "spring", bounce: 0.15, mass: 0.8 }}
        className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} w-full`}
      >
        <div
          className={`${msg.role === "user" ? "max-w-[85%] bg-[#1C1C1E] text-white border border-[#2c2c2e] px-4 py-2.5 rounded-2xl rounded-br-sm" : "w-full max-w-full"}`}
        >
          {msg.role === "assistant" && msg.isVoice && (
            <div className="flex items-center gap-3 mb-2">
              <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] uppercase tracking-wider font-bold flex items-center gap-1">
                <Mic size={8} /> Voice
              </span>
            </div>
          )}
          {msg.role === "user" && msg.isVoice && (
            <div className="flex items-center justify-end gap-1 mb-2">
              <span className="px-1.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] uppercase tracking-wider font-bold flex items-center gap-1">
                <Mic size={8} /> Voice
              </span>
            </div>
          )}

          <div
            className={`prose max-w-none text-[13px] font-medium leading-relaxed tracking-tight ${msg.role === "user" ? "prose-p:leading-snug prose-p:my-0" : "prose-p:leading-[1.6] prose-p:mb-4 prose-p:last:mb-0"} prose-headings:tracking-tight prose-headings:leading-tight prose-headings:font-medium prose-pre:my-2 prose-pre:border prose-code:text-blue-500 ${msg.role === "user" ? "prose-invert text-white prose-pre:bg-[#0A0A0A] prose-pre:border-white/5" : "text-[#050505] prose-headings:text-zinc-900 prose-pre:bg-zinc-100 prose-pre:border-black/5"}`}
          >
            {msg.role === "assistant" &&
              msg.reasoningSteps &&
              msg.reasoningSteps.length > 0 && (
                <ThinkingPanel
                  phase={msg.phase || "idle"}
                  steps={msg.reasoningSteps}
                  isComplete={
                    sendState === "success" ||
                    (msg.phase !== undefined &&
                      msg.phase === "complete" &&
                      msg.content.length > 0)
                  }
                  webSearch={msg.webSearch}
                  hasError={!!msg.error}
                />
              )}
            <AnimatedMarkdown
              content={msg.content}
              isVoice={msg.isVoice}
              animationsEnabled={animationsEnabled}
              isStreaming={
                isLast && sendState !== "success" && sendState !== "idle"
              }
            />
            {msg.role === "assistant" && (
              <FinalSourcesPanel sources={msg.sources || []} />
            )}
          </div>
          {msg.role === "assistant" && msg.usage && (
            <MessageUsageFooter usage={msg.usage} />
          )}

          {msg.hasFlashcards && (
            <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2 text-purple-400">
                <Zap size={14} />
                <span className="text-xs font-medium">
                  Flashcards successfully generated!
                </span>
              </div>
              <button
                onClick={() => {
                  if (activeBookId) {
                    localStorage.setItem("revision_open_book_id", activeBookId);
                  }
                  onSetActiveView("revision");
                }}
                className="text-xs font-semibold px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(168,85,247,0.4)]"
              >
                View Book
              </button>
            </div>
          )}
        </div>
        {msg.role === "assistant" && (
          <div className="mt-4 flex flex-wrap gap-2 w-full">
            {msg.phase === "complete" && !msg.hasFlashcards && (
              <button
                onClick={handleGenerateFlashcards}
                disabled={isGeneratingFlashcards}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-zinc-50 text-zinc-600 hover:text-zinc-900 transition-colors text-xs font-medium border border-black/10 rounded-lg shadow-sm disabled:opacity-50"
              >
                {isGeneratingFlashcards ? (
                  <Activity size={13} className="animate-spin" />
                ) : (
                  <BookOpen size={13} />
                )}
                {isGeneratingFlashcards ? "Generating..." : "Create Flashcard"}
              </button>
            )}

            <button
              onClick={() => onHandleTTS(msg.id, msg.content)}
              aria-label={
                isPlayingTTS === msg.id
                  ? `Stop reading with ${readAloudVoiceLabel}`
                  : `Read aloud with ${readAloudVoiceLabel}`
              }
              title={readAloudVoiceTooltip}
              className={`ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors ${
                isPlayingTTS === msg.id
                  ? "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100"
                  : "text-zinc-600 hover:text-zinc-900 bg-white hover:bg-zinc-50 border-black/10"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {isPlayingTTS === msg.id ? (
                  <>
                    <Square size={12} className="fill-current" /> Stop Reading
                  </>
                ) : (
                  <>
                    <Volume2 size={12} /> Read Aloud
                  </>
                )}
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  isMisoReadAloudVoice
                    ? "border-orange-200 bg-orange-50 text-orange-600"
                    : "border-black/5 bg-zinc-50 text-zinc-400"
                }`}
              >
                {readAloudVoiceLabel}
              </span>
            </button>
          </div>
        )}
      </gsapMotion.div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.msg === nextProps.msg &&
      prevProps.sendState === nextProps.sendState &&
      prevProps.animationsEnabled === nextProps.animationsEnabled &&
      prevProps.isPlayingTTS === nextProps.isPlayingTTS &&
      prevProps.ttsVoice === nextProps.ttsVoice &&
      prevProps.apiKey === nextProps.apiKey &&
      prevProps.activeBookId === nextProps.activeBookId &&
      prevProps.activeBookTitle === nextProps.activeBookTitle
    );
  },
);

export function ChatPanel({
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
}: {
  onClose?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const { t } = useTranslation();
  const language = useStore((state) => state.language);
  const apiKey = useStore((state) => state.apiKey);
  const serperApiKey = useStore((state) => state.serperApiKey);
  const deepgramApiKey = useStore((state) => state.deepgramApiKey);
  const learnerName = useStore((state) => state.learnerName);
  const activeUserId = useStore((state) => state.activeUserId);
  const askTutorQuery = useStore((state) => state.askTutorQuery);
  const setAskTutorQuery = useStore((state) => state.setAskTutorQuery);
  const activeProject = useStore((state) => state.activeProject);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const activeLearningBookId = useStore((state) => state.activeLearningBookId);
  const setActiveLearningBookId = useStore(
    (state) => state.setActiveLearningBookId,
  );
  const activeBetaProofAttemptId = useStore(
    (state) => state.activeBetaProofAttemptId,
  );
  const betaProofTrafficApproval = useStore(
    (state) => state.betaProofTrafficApproval,
  );
  const activeDocumentId = useStore((state) => state.activeDocumentId);
  const pdfPage = useStore((state) => state.pdfPage);
  const pdfTotalPages = useStore((state) => state.pdfTotalPages);
  const ttsVoice = useStore((state) => state.ttsVoice);
  const misoTtsApiUrl = useStore((state) => state.misoTtsApiUrl);
  const setActiveView = useStore((state) => state.setActiveView);
  const aiModel = useStore((state) => state.aiModel);
  const animationsEnabled = useStore((state) => state.animationsEnabled);
  const systemPrompt = useStore((state) => state.systemPrompt);
  const brainRuntimeSettings = useStore((state) => state.brainRuntimeSettings);
  const recordChatUsage = useStore((state) => state.recordChatUsage);
  const recordVoiceUsage = useStore((state) => state.recordVoiceUsage);
  const recordVoiceAgentEvent = useStore(
    (state) => state.recordVoiceAgentEvent,
  );
  const recordWebUsage = useStore((state) => state.recordWebUsage);
  const recordWebSearchEvent = useStore((state) => state.recordWebSearchEvent);
  const cacheWebSources = useStore((state) => state.cacheWebSources);
  const selectedTextContext = useStore((state) => state.selectedTextContext);
  const setSelectedTextContext = useStore(
    (state) => state.setSelectedTextContext,
  );
  const setPdfUrl = useStore((state) => state.setPdfUrl);
  const setPdfPage = useStore((state) => state.setPdfPage);
  const setPdfTotalPages = useStore((state) => state.setPdfTotalPages);
  const messages = useStore((state) => state.messages);
  const setMessages = useStore((state) => state.setMessages);
  const setIsVoiceActive = useStore((state) => state.setIsVoiceActive);
  const [streamingAssistant, setStreamingAssistant] =
    useState<StreamingAssistantDraft | null>(null);
  const streamingAssistantRef = useRef<StreamingAssistantDraft | null>(null);
  const streamingFrameRef = useRef<number | null>(null);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [interactionMode, setInteractionMode] =
    useState<TutorInteractionMode>("idle");
  const lastInputAtRef = useRef<number | null>(null);
  const lastSubmitAtRef = useRef<number | null>(null);
  const thinkingPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isTyping, setIsTyping] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isSearchSkillActive, setIsSearchSkillActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isHoveringContainer, setIsHoveringContainer] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [sendState, setSendState] = useState<"idle" | "sending" | "success">(
    "idle",
  );
  const [isPlayingTTS, setIsPlayingTTS] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsRequestIdRef = useRef(0);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [serverOpenRouterReady, setServerOpenRouterReady] = useState(false);
  const [serverDeepgramReady, setServerDeepgramReady] = useState(false);
  const voiceBrokerMode =
    import.meta.env.VITE_VOICE_BROKER_MODE === "custom" ? "custom" : "deepgram";
  const usesCustomVoiceBroker = voiceBrokerMode === "custom";
  const voiceBrokerTtsModel =
    import.meta.env.VITE_VOICE_BROKER_TTS_MODEL || "aura-2-thalia-en";
  const usesBrowserVoiceTts =
    usesCustomVoiceBroker &&
    import.meta.env.VITE_VOICE_BROKER_BROWSER_TTS === "true";
  const voiceBrokerTtsProviderRef = useRef<
    "deepgram" | "browser" | "miso" | "deepgram_voice_agent"
  >(usesCustomVoiceBroker ? "deepgram" : "deepgram_voice_agent");
  const hasOpenRouterRuntimeKey =
    Boolean(apiKey.trim()) || serverOpenRouterReady;
  const hasDeepgramRuntimeKey =
    Boolean(deepgramApiKey.trim()) || serverDeepgramReady;
  const [chatArchives, setChatArchives] = useState<ChatArchive[]>(() =>
    readChatArchives(),
  );
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollPaused = useRef(false);
  const [isSkillsMenuOpen, setIsSkillsMenuOpen] = useState(false);
  const loadedThreadBookIdRef = useRef<string | null>(null);
  const latestMessagesRef = useRef<Message[]>(messages);
  const latestBookTitleRef = useRef(activeProject);

  useEffect(() => {
    let cancelled = false;
    const refreshProviderMeters = async () => {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setServerOpenRouterReady(Boolean(payload?.providers?.openRouter));
        setServerDeepgramReady(Boolean(payload?.providers?.deepgram));
      } catch {
        if (!cancelled) {
          setServerOpenRouterReady(false);
          setServerDeepgramReady(false);
        }
      }
    };
    void refreshProviderMeters();
    const intervalId = window.setInterval(refreshProviderMeters, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const flushStreamingAssistant = useCallback(() => {
    streamingFrameRef.current = null;
    setStreamingAssistant(streamingAssistantRef.current);
  }, []);

  const scheduleStreamingAssistant = useCallback(
    (draft: StreamingAssistantDraft) => {
      streamingAssistantRef.current = draft;
      if (streamingFrameRef.current !== null) return;
      if (typeof requestAnimationFrame === "undefined") {
        flushStreamingAssistant();
        return;
      }
      streamingFrameRef.current = requestAnimationFrame(
        flushStreamingAssistant,
      );
    },
    [flushStreamingAssistant],
  );

  const clearStreamingAssistant = useCallback(() => {
    if (streamingFrameRef.current !== null) {
      cancelAnimationFrame(streamingFrameRef.current);
      streamingFrameRef.current = null;
    }
    streamingAssistantRef.current = null;
    setStreamingAssistant(null);
  }, []);

  useEffect(() => clearStreamingAssistant, [clearStreamingAssistant]);

  const displayMessages = React.useMemo(() => {
    if (!streamingAssistant) return messages;
    return messages.map((message) =>
      message.id === streamingAssistant.id
        ? {
            ...message,
            content: streamingAssistant.content,
            usage: streamingAssistant.usage || message.usage,
          }
        : message,
    );
  }, [messages, streamingAssistant]);

  const [voiceState, setVoiceState] = useState<
    "idle" | "listening" | "speaking"
  >("idle");
  const [voiceCaption, setVoiceCaption] = useState<VoiceCaption>(null);
  const [voiceStageFocus, setVoiceStageFocus] =
    useState<VoiceVisualFocus | null>(null);
  const [dismissedVoiceStageFocusId, setDismissedVoiceStageFocusId] = useState<
    string | null
  >(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const browserVoiceUtteranceRef = useRef<SpeechSynthesisUtterance | null>(
    null,
  );
  const outputGainRef = useRef<GainNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputRafRef = useRef<number | null>(null);
  const bargeInFramesRef = useRef(0);
  const noiseFloorRef = useRef(0.06);
  const endingRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const voiceStartedAtRef = useRef<number | null>(null);
  const voiceSessionCountedRef = useRef(false);
  const voiceSessionErrorRef = useRef<string | null>(null);
  const voiceTurnsRef = useRef<VoiceSessionTurn[]>([]);
  const voiceStudyContextRef = useRef<VoiceStudyContextPayload | null>(null);
  const voiceProofAttemptIdRef = useRef<string | null>(null);
  const pendingVoiceProofScriptRef = useRef<string | null>(null);
  const micSignalAnnouncedRef = useRef(false);
  const voiceInputSampleRateRef = useRef(48000);
  const lastVoicePointerDownRef = useRef(0);
  const voiceStageFocusRef = useRef<VoiceVisualFocus | null>(null);
  const voiceStageReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pacedVoiceRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pacedVoiceTurnRef = useRef<PacedVoiceTurn | null>(null);
  const getVoiceProofAttemptId = useCallback(() => {
    return (
      voiceStudyContextRef.current?.proofAttemptId ||
      voiceProofAttemptIdRef.current ||
      activeBetaProofAttemptId ||
      undefined
    );
  }, [activeBetaProofAttemptId]);

  const clearVoiceStageReturnTimer = useCallback(() => {
    if (voiceStageReturnTimerRef.current) {
      clearTimeout(voiceStageReturnTimerRef.current);
      voiceStageReturnTimerRef.current = null;
    }
  }, []);

  const dismissVoiceStageFocus = useCallback(
    (focusId?: string | null) => {
      clearVoiceStageReturnTimer();
      const id = focusId || voiceStageFocusRef.current?.id || null;
      if (id) {
        setDismissedVoiceStageFocusId(id);
      }
      setVoiceStageFocus((current) =>
        !id || current?.id === id ? null : current,
      );
    },
    [clearVoiceStageReturnTimer],
  );

  const scheduleVoiceStageReturn = useCallback(() => {
    clearVoiceStageReturnTimer();
    const focusId = voiceStageFocusRef.current?.id;
    if (!focusId) return;
    voiceStageReturnTimerRef.current = setTimeout(() => {
      dismissVoiceStageFocus(focusId);
    }, 6500);
  }, [clearVoiceStageReturnTimer, dismissVoiceStageFocus]);

  useEffect(() => {
    voiceStageFocusRef.current = voiceStageFocus;
  }, [voiceStageFocus]);

  const latestVoiceVisualFocus = React.useMemo(() => {
    if (voiceState === "idle") return null;
    const activeVoiceMessage =
      (voiceSessionIdRef.current
        ? messages.find((message) => message.id === voiceSessionIdRef.current)
        : null) ||
      [...messages].reverse().find((message) => Boolean(message.voiceSession));
    const focuses = activeVoiceMessage?.voiceSession?.visualFocuses || [];
    const latestFocus =
      [...focuses]
        .reverse()
        .find((focus) =>
          ["ready", "blocked", "empty", "failed"].includes(focus.status),
        ) || null;
    return latestFocus?.kind === "current_page" ? null : latestFocus;
  }, [messages, voiceState]);

  useEffect(() => {
    if (voiceState === "idle") {
      clearVoiceStageReturnTimer();
      setVoiceStageFocus(null);
      setDismissedVoiceStageFocusId(null);
      return;
    }
    if (
      latestVoiceVisualFocus &&
      latestVoiceVisualFocus.id !== dismissedVoiceStageFocusId
    ) {
      clearVoiceStageReturnTimer();
      setVoiceStageFocus((current) =>
        current?.id === latestVoiceVisualFocus.id
          ? current
          : latestVoiceVisualFocus,
      );
      return;
    }
    if (!latestVoiceVisualFocus) {
      setVoiceStageFocus(null);
    }
  }, [
    clearVoiceStageReturnTimer,
    dismissedVoiceStageFocusId,
    latestVoiceVisualFocus,
    voiceState,
  ]);

  const forceScrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      requestAnimationFrame(() => {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior,
        });
      });
    },
    [],
  );

  useEffect(() => {
    setIsVoiceActive(voiceState !== "idle" || isPlayingTTS !== null);
  }, [voiceState, isPlayingTTS, setIsVoiceActive]);
  const lastVoiceUserMessageRef = useRef("");
  const pendingVoiceUserMessagesRef = useRef<string[]>([]);
  const learningBooks =
    useLiveQuery(
      () => db.learningBooks.orderBy("updatedAt").reverse().toArray(),
      [],
    ) || [];
  const scopedLearningBooks = React.useMemo(() => {
    const matches = learningBooks.filter((book) =>
      book.userId
        ? book.userId === activeUserId
        : book.userName === learnerName,
    );
    return matches.length > 0 ? matches : learningBooks;
  }, [activeUserId, learnerName, learningBooks]);
  const dedupedLearningBooks = React.useMemo(() => {
    const general =
      scopedLearningBooks.find((book) =>
        book.id.startsWith(GENERAL_STUDY_BOOK_ID),
      ) ||
      scopedLearningBooks.find((book) =>
        /^general study$/i.test(book.title.trim()),
      );
    const seen = new Set<string>();
    const result = [];
    if (general) {
      result.push(general);
      seen.add(general.id);
    }
    scopedLearningBooks.forEach((book) => {
      if (seen.has(book.id)) return;
      if (/^general study$/i.test(book.title.trim())) return;
      result.push(book);
      seen.add(book.id);
    });
    return result;
  }, [scopedLearningBooks]);
  const libraryContextBooks = React.useMemo(
    () =>
      dedupedLearningBooks.filter(
        (book) => !isReservedLibraryContext(book.title),
      ),
    [dedupedLearningBooks],
  );
  const generalStudyBook =
    libraryContextBooks.find((book) =>
      book.id.startsWith(GENERAL_STUDY_BOOK_ID),
    ) ||
    libraryContextBooks.find(
      (book) => book.title.toLowerCase() === "general study",
    );
  const activeLearningBook = activeLearningBookId
    ? libraryContextBooks.find((book) => book.id === activeLearningBookId)
    : generalStudyBook;
  const activeLearningBookTitle = activeLearningBook?.title || activeProject;
  const canonicalActiveBookId = activeLearningBook?.id || activeLearningBookId;
  const activeBookDocuments = useLiveQuery(
    () =>
      canonicalActiveBookId
        ? db.learningDocuments
            .where("bookId")
            .equals(canonicalActiveBookId)
            .toArray()
        : Promise.resolve([]),
    [canonicalActiveBookId],
  );
  const orderedBookDocuments = React.useMemo(() => {
    const documents = [...(activeBookDocuments || [])].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    if (!activeDocumentId) return documents;
    return documents.sort((a, b) =>
      a.id === activeDocumentId ? -1 : b.id === activeDocumentId ? 1 : 0,
    );
  }, [activeBookDocuments, activeDocumentId]);
  const hydrateDocumentsForBrainContext = useCallback(
    async (documents: LearningDocument[]) => {
      if (typeof fetch !== "function") return documents;
      return Promise.all(
        documents.map(async (document) => {
          if (document.extractedText?.trim() || !document.textUrl) {
            return document;
          }
          try {
            const response = await fetch(document.textUrl, {
              headers: learnerRequestHeaders(activeUserId),
            });
            if (!response.ok) return document;
            const extractedText = await response.text();
            if (!extractedText.trim()) return document;
            return {
              ...document,
              extractedText,
              textPreview:
                document.textPreview ||
                extractedText.replace(/\s+/g, " ").slice(0, 6000),
            };
          } catch (error) {
            console.warn(
              "[ChatPanel] Server document text hydration failed:",
              error,
            );
            return document;
          }
        }),
      );
    },
    [activeUserId],
  );
  const readyProofDocuments = React.useMemo(
    () =>
      orderedBookDocuments.filter(
        (document) =>
          document.processingStatus === "ready" &&
          Boolean(
            document.extractedText?.trim() ||
            document.textPreview?.trim() ||
            document.textUrl,
          ),
      ),
    [orderedBookDocuments],
  );
  const activeProofTrafficApprovalEvents =
    useLiveQuery(
      () =>
        activeBetaProofAttemptId
          ? db.memoryEvents
              .where("eventType")
              .equals("beta_provider_traffic_approved")
              .toArray()
          : Promise.resolve([]),
      [activeBetaProofAttemptId],
    ) || [];
  const hasDurableActiveProofTrafficApproval = React.useMemo(
    () =>
      Boolean(
        activeBetaProofAttemptId &&
        activeProofTrafficApprovalEvents.some((event: MemoryEvent) => {
          const metadata = event.metadata || {};
          return (
            event.status === "completed" &&
            metadata.proofAttemptId === activeBetaProofAttemptId
          );
        }),
      ),
    [activeBetaProofAttemptId, activeProofTrafficApprovalEvents],
  );
  const hasLoadedProofPrompt = Boolean(
    activeBetaProofAttemptId && /Provider-key proof turn/i.test(input),
  );
  const hasLoadedVoiceProofScript = Boolean(
    activeBetaProofAttemptId && /Provider-key voice proof turn/i.test(input),
  );
  const isActiveProofTrafficApproved = Boolean(
    activeBetaProofAttemptId &&
    betaProofTrafficApproval?.attemptId === activeBetaProofAttemptId &&
    hasDurableActiveProofTrafficApproval,
  );
  const hasPendingProofTrafficApproval = Boolean(
    activeBetaProofAttemptId &&
    betaProofTrafficApproval?.attemptId === activeBetaProofAttemptId &&
    !hasDurableActiveProofTrafficApproval,
  );
  const activeBetaProofTrafficLocked = Boolean(
    activeBetaProofAttemptId && !isActiveProofTrafficApproved,
  );
  const alertProofTrafficApprovalNeeded = useCallback(() => {
    alert(
      "Approve provider traffic for this proof attempt in Admin and wait for the local approval event before running provider-key chat or live voice proof.",
    );
  }, []);
  const buildVoiceStudyContext = useCallback(async () => {
    const contextQuery = [
      `Voice tutoring session for ${activeLearningBookTitle || activeProject}.`,
      activeDocumentId ? `Active document id: ${activeDocumentId}.` : "",
      selectedTextContext ? `Selected text: ${selectedTextContext}` : "",
      orderedBookDocuments[0]?.title
        ? `Current document: ${orderedBookDocuments[0].title}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const voiceRequestId = voiceSessionIdRef.current || undefined;
    const hydratedDocuments =
      await hydrateDocumentsForBrainContext(orderedBookDocuments);
    const packet = await buildBrainContextPacket({
      userId: activeUserId,
      requestId: voiceRequestId,
      proofAttemptId:
        voiceProofAttemptIdRef.current || activeBetaProofAttemptId || undefined,
      mode: "voice",
      agentLayer: "voice_realtime",
      query: contextQuery,
      getRelevantContext:
        brainOrchestrator.getRelevantContext.bind(brainOrchestrator),
      activeBookId: canonicalActiveBookId,
      activeBookTitle: activeLearningBookTitle || activeProject,
      activeProject,
      activeDocumentId,
      documents: hydratedDocuments,
      runtimeSettings: brainRuntimeSettings,
      maxContextChars: VOICE_AGENT_CONTEXT_CHAR_LIMIT,
      interaction: {
        mode: "listening",
        text: contextQuery,
        selectedTextAttached: Boolean(selectedTextContext),
        webSearchSelected: false,
        voiceState: "listening",
        sendState: "idle",
        lastInputAt: lastInputAtRef.current,
        lastSubmitAt: lastSubmitAtRef.current,
      },
    });
    return {
      userId: packet.userId,
      requestId: packet.requestId,
      proofAttemptId: packet.proofAttemptId,
      studyContext: packet.context,
      studyContextChars: packet.contextChars,
      rawContextChars: packet.rawContextChars,
      memoryContextChars: packet.memoryContextChars,
      activeBookContextChars: packet.activeBookContextChars,
      documentContextChars: packet.documentContextChars,
      documentCount: packet.documentCount,
      documentIds: packet.documentIds,
      readyDocumentCount: packet.readyDocumentCount,
      readyDocumentIds: packet.readyDocumentIds,
      contextDocumentIds: packet.contextDocumentIds,
      unreadyDocumentCount: packet.unreadyDocumentCount,
      omittedReadyDocumentCount: packet.omittedReadyDocumentCount,
      contextCompacted: packet.compacted,
    };
  }, [
    activeDocumentId,
    activeUserId,
    activeBetaProofAttemptId,
    activeLearningBookTitle,
    activeProject,
    brainRuntimeSettings,
    canonicalActiveBookId,
    hydrateDocumentsForBrainContext,
    orderedBookDocuments,
    selectedTextContext,
  ]);

  const recordLearnerBackgroundTask = useCallback(
    (payload: Record<string, unknown>) => {
      void fetch("/api/learner/background-tasks", {
        method: "POST",
        headers: learnerRequestHeaders(activeUserId, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(payload),
      }).catch((error) => {
        console.warn(
          "[ChatPanel] Learner background task write failed:",
          error,
        );
      });
    },
    [activeUserId],
  );

  const visibleChatArchives = chatArchives.filter(
    (archive) =>
      archive.bookId === canonicalActiveBookId &&
      !isReservedLibraryContext(archive.bookTitle) &&
      !isReservedLibraryContext(archive.title),
  );

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    latestBookTitleRef.current = activeLearningBookTitle;
  }, [activeLearningBookTitle]);

  const clearStudyDocumentContext = useCallback(() => {
    const currentPdfUrl = useStore.getState().pdfUrl;
    if (currentPdfUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(currentPdfUrl);
    }
    setPdfUrl(null);
    setPdfPage(1);
    setPdfTotalPages(0);
    setSelectedTextContext("");
  }, [setPdfPage, setPdfTotalPages, setPdfUrl, setSelectedTextContext]);

  const saveCurrentChatArchive = useCallback(() => {
    const currentMessages = useStore.getState().messages;
    void persistBookChatThread(
      useStore.getState().activeLearningBookId || canonicalActiveBookId,
      activeLearningBookTitle,
      currentMessages,
      activeBetaProofAttemptId || undefined,
    ).catch((error) =>
      console.warn("[ChatPanel] Book chat archive failed:", error),
    );
    const next = archiveChatSnapshot(
      currentMessages,
      useStore.getState().activeLearningBookId || canonicalActiveBookId || null,
      activeLearningBookTitle,
    );
    if (next.length) setChatArchives(next);
  }, [
    activeBetaProofAttemptId,
    activeLearningBookTitle,
    canonicalActiveBookId,
  ]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      archiveChatSnapshot(
        useStore.getState().messages,
        useStore.getState().activeLearningBookId ||
          canonicalActiveBookId ||
          null,
        activeLearningBookTitle,
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeLearningBookTitle, canonicalActiveBookId]);

  useEffect(() => {
    if (libraryContextBooks.length === 0) return;
    const selectedBook = activeLearningBookId
      ? libraryContextBooks.find((book) => book.id === activeLearningBookId)
      : undefined;
    if (selectedBook) return;

    const matchingBook = libraryContextBooks.find(
      (book) => book.title.toLowerCase() === activeProject.toLowerCase(),
    );
    const nextBook = matchingBook || generalStudyBook || libraryContextBooks[0];
    setActiveLearningBookId(nextBook.id);
    setActiveProject(nextBook.title);
  }, [
    activeLearningBookId,
    activeProject,
    generalStudyBook,
    libraryContextBooks,
    setActiveLearningBookId,
    setActiveProject,
  ]);

  useEffect(() => {
    const handleLearningBookUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string; title?: string }>)
        .detail;
      if (!detail?.bookId || !detail?.title) return;
      setActiveLearningBookId(detail.bookId);
      setActiveProject(detail.title);
    };
    window.addEventListener("learning-book-updated", handleLearningBookUpdate);
    return () =>
      window.removeEventListener(
        "learning-book-updated",
        handleLearningBookUpdate,
      );
  }, [setActiveLearningBookId, setActiveProject]);

  useEffect(() => {
    if (!canonicalActiveBookId) return;
    let cancelled = false;
    const previousBookId = loadedThreadBookIdRef.current;
    if (previousBookId && previousBookId !== canonicalActiveBookId) {
      void persistBookChatThread(
        previousBookId,
        latestBookTitleRef.current,
        latestMessagesRef.current,
        activeBetaProofAttemptId || undefined,
      ).catch((error) =>
        console.warn("[ChatPanel] Previous book chat save failed:", error),
      );
    }

    setIsThreadLoading(true);
    clearStreamingAssistant();
    void db.bookChatThreads
      .get(chatThreadIdForBook(canonicalActiveBookId))
      .then((thread) => {
        if (cancelled) return;
        loadedThreadBookIdRef.current = canonicalActiveBookId;
        setMessages(normalizeChatMessages(thread?.messages));
        requestAnimationFrame(() => forceScrollToBottom("auto"));
      })
      .catch((error) => {
        console.warn("[ChatPanel] Book chat load failed:", error);
        if (!cancelled) {
          loadedThreadBookIdRef.current = canonicalActiveBookId;
          setMessages(defaultChatMessages());
        }
      })
      .finally(() => {
        if (!cancelled) setIsThreadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeBetaProofAttemptId,
    canonicalActiveBookId,
    clearStreamingAssistant,
    forceScrollToBottom,
    setMessages,
  ]);

  useEffect(() => {
    if (!canonicalActiveBookId || isThreadLoading) return;
    const timeout = window.setTimeout(() => {
      void persistBookChatThread(
        canonicalActiveBookId,
        activeLearningBookTitle,
        messages,
        activeBetaProofAttemptId || undefined,
      ).catch((error) =>
        console.warn("[ChatPanel] Book chat save failed:", error),
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    activeLearningBookTitle,
    activeBetaProofAttemptId,
    canonicalActiveBookId,
    isThreadLoading,
    messages,
  ]);

  const stopReadAloud = useCallback(() => {
    ttsRequestIdRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.onerror = null;
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current);
      ttsObjectUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => stopReadAloud, [stopReadAloud]);

  const isProjectDropdownOpenState = useState(false);
  const isProjectDropdownOpen = isProjectDropdownOpenState[0];
  const setIsProjectDropdownOpen = isProjectDropdownOpenState[1];

  const isValid =
    input.length === 0 || /^[a-zA-Z0-9\s.,!?'"()\-:;\n]*$/.test(input);
  const isActive = input.length > 0;

  const clearThinkingPauseTimer = useCallback(() => {
    if (thinkingPauseTimerRef.current) {
      clearTimeout(thinkingPauseTimerRef.current);
      thinkingPauseTimerRef.current = null;
    }
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      lastInputAtRef.current = Date.now();
      clearThinkingPauseTimer();

      if (!value.trim()) {
        setInteractionMode("idle");
        return;
      }

      setInteractionMode("composing");
      thinkingPauseTimerRef.current = setTimeout(() => {
        setInteractionMode((current) =>
          current === "composing" ? "thinking_pause" : current,
        );
      }, INTERACTION_THINKING_PAUSE_MS);
    },
    [clearThinkingPauseTimer],
  );

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 150;
    textarea.style.height = "0px";
    const nextHeight = Math.min(maxHeight, Math.max(52, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input, isSearchSkillActive]);

  const thinkingSteps = [
    "Reading context...",
    "Linking concepts...",
    "Synthesizing answer...",
  ];

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (sendState === "sending") {
      setThinkingStep(0);
      interval = setInterval(() => {
        setThinkingStep((s) => (s + 1) % 3);
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [sendState]);

  useEffect(() => () => clearThinkingPauseTimer(), [clearThinkingPauseTimer]);

  useEffect(() => {
    if (voiceState === "listening") {
      setInteractionMode("listening");
    } else if (voiceState === "speaking") {
      setInteractionMode("speaking");
    } else if (sendState === "sending") {
      setInteractionMode("awaiting_response");
    } else if (!input.trim()) {
      setInteractionMode("idle");
    }
  }, [input, sendState, voiceState]);

  const generateVoiceTitle = async (sessionId: string, transcript: string) => {
    try {
      const response = await fetch("/api/title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ text: transcript }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const title = (data?.title || "").trim();
      if (!title) return;
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === sessionId);
        if (index === -1 || !prev[index].voiceSession) return prev;
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          voiceSession: { ...copy[index].voiceSession, title },
        };
        return copy;
      });
    } catch (error) {
      console.warn("[ChatPanel] Voice title generation failed:", error);
    }
  };

  const updateDisplayedVoiceTurn = (
    turnId: string,
    role: "user" | "assistant",
    content: string,
    options: { finalContent?: string; isRevealing?: boolean } = {},
  ) => {
    const cleanContent = content.trim();
    const sessionId = voiceSessionIdRef.current;
    if (!sessionId || !turnId || !cleanContent) return;
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === sessionId);
      if (index === -1) return prev;
      const session = prev[index].voiceSession || {
        turns: [],
        startedAt: Date.now(),
        durationSeconds: 0,
      };
      const nextTurn = {
        id: turnId,
        role,
        content: cleanContent,
        finalContent: options.finalContent,
        isRevealing: options.isRevealing,
      };
      const existingIndex = session.turns.findIndex(
        (turn) => turn.id === turnId,
      );
      const turns =
        existingIndex === -1
          ? [...session.turns, nextTurn]
          : session.turns.map((turn, turnIndex) =>
              turnIndex === existingIndex ? { ...turn, ...nextTurn } : turn,
            );
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        voiceSession: {
          ...session,
          turns,
          durationSeconds: Math.max(
            session.durationSeconds,
            Math.round((Date.now() - session.startedAt) / 1000),
          ),
        },
      };
      return copy;
    });
  };

  const appendVoiceTurn = (
    role: "user" | "assistant",
    content: string,
    turnId = Date.now().toString() + Math.random(),
  ) => {
    const cleanContent = content.trim();
    const sessionId = voiceSessionIdRef.current;
    if (!sessionId || !cleanContent) return "";
    const last = voiceTurnsRef.current[voiceTurnsRef.current.length - 1];
    if (last && last.role === role && last.content === cleanContent) {
      return last.id;
    }
    voiceTurnsRef.current = [
      ...voiceTurnsRef.current,
      { id: turnId, role, content: cleanContent },
    ];
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === sessionId);
      if (index === -1) return prev;
      const session = prev[index].voiceSession || {
        turns: [],
        startedAt: Date.now(),
        durationSeconds: 0,
      };
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        voiceSession: {
          ...session,
          turns: [
            ...session.turns,
            {
              id: turnId,
              role,
              content: cleanContent,
            },
          ],
          durationSeconds: Math.max(
            session.durationSeconds,
            Math.round((Date.now() - session.startedAt) / 1000),
          ),
        },
      };
      return copy;
    });
    return turnId;
  };

  const clearPacedVoiceReveal = useCallback(() => {
    if (pacedVoiceRevealTimerRef.current) {
      clearTimeout(pacedVoiceRevealTimerRef.current);
      pacedVoiceRevealTimerRef.current = null;
    }
  }, []);

  const visibleVoicePrefix = (text: string, charCount: number) => {
    const target = text.slice(0, Math.max(1, charCount));
    const naturalBreak = Math.max(
      target.lastIndexOf(" "),
      target.lastIndexOf(","),
      target.lastIndexOf("."),
      target.lastIndexOf(";"),
    );
    const value =
      naturalBreak > 18 && naturalBreak < text.length - 1
        ? target.slice(0, naturalBreak)
        : target;
    return value.trim() || text.slice(0, Math.min(text.length, charCount));
  };

  const finalizePacedVoiceTurn = useCallback(
    (showCaption = true) => {
      const paced = pacedVoiceTurnRef.current;
      clearPacedVoiceReveal();
      if (!paced) return;
      updateDisplayedVoiceTurn(paced.turnId, "assistant", paced.fullText, {
        finalContent: paced.fullText,
        isRevealing: false,
      });
      if (showCaption) {
        setVoiceCaption({ role: "assistant", text: paced.fullText });
      }
      pacedVoiceTurnRef.current = null;
    },
    [clearPacedVoiceReveal],
  );

  const startPacedAssistantTurn = useCallback(
    (content: string, options: { turnId?: string; durationMs?: number }) => {
      const fullText = content.trim();
      if (!fullText) return "";
      clearPacedVoiceReveal();
      const turnId =
        options.turnId || `voice-assistant-${Date.now()}-${Math.random()}`;
      const durationMs = Math.min(
        24_000,
        Math.max(
          1_800,
          Number(options.durationMs || 0) ||
            fullText.split(/\s+/).filter(Boolean).length * 340,
        ),
      );
      pacedVoiceTurnRef.current = {
        turnId,
        fullText,
        startedAt: Date.now(),
        durationMs,
      };
      const existingTurn = voiceTurnsRef.current.find(
        (turn) => turn.id === turnId,
      );
      if (!existingTurn) {
        voiceTurnsRef.current = [
          ...voiceTurnsRef.current,
          { id: turnId, role: "assistant", content: fullText },
        ];
      }
      const tick = () => {
        const paced = pacedVoiceTurnRef.current;
        if (!paced || paced.turnId !== turnId) return;
        const elapsed = Date.now() - paced.startedAt;
        const progress = Math.min(1, elapsed / paced.durationMs);
        const visibleLength = Math.max(
          12,
          Math.ceil(paced.fullText.length * progress),
        );
        const visibleText =
          progress >= 1
            ? paced.fullText
            : `${visibleVoicePrefix(paced.fullText, visibleLength)}...`;
        updateDisplayedVoiceTurn(turnId, "assistant", visibleText, {
          finalContent: paced.fullText,
          isRevealing: progress < 1,
        });
        setVoiceCaption({ role: "assistant", text: visibleText });
        if (progress >= 1) {
          pacedVoiceTurnRef.current = null;
          pacedVoiceRevealTimerRef.current = null;
          if (activeAudioNodesRef.current.length === 0 && !endingRef.current) {
            scheduleVoiceStageReturn();
            setVoiceState("listening");
          }
          return;
        }
        pacedVoiceRevealTimerRef.current = setTimeout(tick, 120);
      };
      tick();
      return turnId;
    },
    [clearPacedVoiceReveal, scheduleVoiceStageReturn],
  );

  const appendVoiceVisualFocus = (
    focus: Omit<VoiceVisualFocus, "timestamp">,
  ) => {
    const sessionId = voiceSessionIdRef.current;
    if (!sessionId) return;
    const visualFocus: VoiceVisualFocus = {
      ...focus,
      timestamp: Date.now(),
    };
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === sessionId);
      if (index === -1) return prev;
      const session = prev[index].voiceSession || {
        turns: [],
        startedAt: Date.now(),
        durationSeconds: 0,
      };
      const existing = session.visualFocuses || [];
      const nextFocuses = [
        ...existing.filter((item) => item.id !== visualFocus.id),
        visualFocus,
      ].slice(-8);
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        voiceSession: {
          ...session,
          visualFocuses: nextFocuses,
          durationSeconds: Math.max(
            session.durationSeconds,
            Math.round((Date.now() - session.startedAt) / 1000),
          ),
        },
      };
      return copy;
    });
  };

  const recordVoiceModelRun = (
    status: "started" | "completed" | "failed",
    sessionId: string,
    metadata: Record<string, unknown> = {},
  ) => {
    const context = voiceStudyContextRef.current;
    const startedAt = voiceStartedAtRef.current;
    void recordModelRunEvent({
      status,
      provider: "deepgram",
      source: "voice_agent",
      requestId: sessionId,
      requestedModel: "Deepgram Voice Agent",
      usedModel: "Deepgram Voice Agent",
      estimated: true,
      durationMs:
        status === "started" || !startedAt ? undefined : Date.now() - startedAt,
      memoryContextChars: context?.studyContextChars,
      iterations: voiceTurnsRef.current.length,
      error:
        status === "failed"
          ? voiceSessionErrorRef.current || undefined
          : undefined,
      runtimeSettings: { ...brainRuntimeSettings },
      metadata: {
        activeBookId: canonicalActiveBookId || undefined,
        activeBookTitle: activeLearningBookTitle || activeProject,
        activeDocumentId: activeDocumentId || undefined,
        proofAttemptId: getVoiceProofAttemptId(),
        channel: "websocket",
        documentCount: context?.documentCount,
        memoryContextChars: context?.memoryContextChars,
        activeBookContextChars: context?.activeBookContextChars,
        documentContextChars: context?.documentContextChars,
        ...metadata,
      },
    }).catch((error) => {
      console.warn("[ChatPanel] Voice model run write failed:", error);
    });
  };

  const cancelBrowserVoiceSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      browserVoiceUtteranceRef.current = null;
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {}
    browserVoiceUtteranceRef.current = null;
  }, []);

  const speakBrowserVoiceText = useCallback(
    (text: string) => {
      const safeText = compactVoiceEventText(text, 1200);
      if (
        !usesBrowserVoiceTts ||
        !safeText ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window) ||
        typeof window.SpeechSynthesisUtterance === "undefined"
      ) {
        return false;
      }

      cancelBrowserVoiceSpeech();
      const utterance = new window.SpeechSynthesisUtterance(safeText);
      utterance.rate = 1.08;
      utterance.pitch = 1;
      utterance.volume = 1;
      browserVoiceUtteranceRef.current = utterance;
      utterance.onstart = () => {
        setVoiceState("speaking");
        recordVoiceAgentEvent({
          type: "agent_started_speaking",
          status: "running",
          sessionId: voiceSessionIdRef.current || undefined,
          summary: "Browser realtime TTS started speaking.",
          metadata: {
            voiceBrokerMode,
            proofAttemptId: getVoiceProofAttemptId(),
            characterCount: safeText.length,
          },
        });
      };
      utterance.onend = () => {
        if (browserVoiceUtteranceRef.current === utterance) {
          browserVoiceUtteranceRef.current = null;
          scheduleVoiceStageReturn();
        }
      };
      utterance.onerror = () => {
        if (browserVoiceUtteranceRef.current === utterance) {
          browserVoiceUtteranceRef.current = null;
        }
      };
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [
      cancelBrowserVoiceSpeech,
      getVoiceProofAttemptId,
      scheduleVoiceStageReturn,
      usesBrowserVoiceTts,
      voiceBrokerMode,
    ],
  );

  const stopVoice = () => {
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    cancelBrowserVoiceSpeech();
    clearVoiceStageReturnTimer();
    endingRef.current = false;
    if (outputRafRef.current !== null) {
      cancelAnimationFrame(outputRafRef.current);
      outputRafRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    outputGainRef.current = null;
    outputAnalyserRef.current = null;
    activeAudioNodesRef.current = [];
    window.dispatchEvent(new CustomEvent("mic-volume", { detail: 0 }));
    window.dispatchEvent(new CustomEvent("tts-volume", { detail: 0 }));
    setVoiceCaption(null);
    finalizePacedVoiceTurn(false);

    const sessionId = voiceSessionIdRef.current;
    if (sessionId) {
      const turns = voiceTurnsRef.current;
      const durationSeconds = Math.max(
        0,
        Math.round(
          (Date.now() - (voiceStartedAtRef.current || Date.now())) / 1000,
        ),
      );
      recordVoiceAgentEvent({
        type: "session_ended",
        status: voiceSessionErrorRef.current ? "failed" : "completed",
        sessionId,
        summary: voiceSessionErrorRef.current
          ? `Voice session ended after an error: ${compactVoiceEventText(voiceSessionErrorRef.current)}`
          : turns.length > 0
            ? `Voice session ended with ${turns.length} transcript turn${turns.length === 1 ? "" : "s"}.`
            : "Voice session ended before transcript turns were captured.",
        metadata: {
          durationSeconds,
          turnCount: turns.length,
          proofAttemptId: getVoiceProofAttemptId(),
          error: voiceSessionErrorRef.current || undefined,
        },
      });
      recordVoiceModelRun(
        voiceSessionErrorRef.current ? "failed" : "completed",
        sessionId,
        {
          phase: "session_ended",
          durationSeconds,
          turnCount: turns.length,
        },
      );
      if (!voiceSessionCountedRef.current) {
        recordVoiceUsage({ sessions: 1 });
        voiceSessionCountedRef.current = true;
      }
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === sessionId);
        if (index === -1) return prev;
        const session = prev[index].voiceSession;
        if (!session || session.turns.length === 0) {
          return prev.filter((message) => message.id !== sessionId);
        }
        const persistedDurationSeconds = Math.max(
          session.durationSeconds,
          durationSeconds,
        );
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          voiceSession: {
            ...session,
            durationSeconds: persistedDurationSeconds,
            title: session.title || deriveFallbackTitle(turns),
          },
        };
        return copy;
      });

      if (turns.length > 0) {
        const transcript = turns
          .map(
            (turn) =>
              `${turn.role === "user" ? "Student" : "Tutor"}: ${turn.finalContent || turn.content}`,
          )
          .join("\n");
        void generateVoiceTitle(sessionId, transcript);
      }
      voiceSessionIdRef.current = null;
    }
    voiceStartedAtRef.current = null;
    voiceStudyContextRef.current = null;
    voiceProofAttemptIdRef.current = null;
    pendingVoiceProofScriptRef.current = null;
    micSignalAnnouncedRef.current = false;
    voiceInputSampleRateRef.current = 48000;
    voiceSessionCountedRef.current = false;
    voiceSessionErrorRef.current = null;
    voiceTurnsRef.current = [];
    pendingVoiceUserMessagesRef.current = [];
    clearPacedVoiceReveal();
    pacedVoiceTurnRef.current = null;
    setVoiceStageFocus(null);
    setDismissedVoiceStageFocusId(null);
    setVoiceState("idle");
  };

  // Ensure a live voice session is fully torn down if ChatPanel unmounts while
  // it is active — otherwise the mic MediaStream, AudioContext, ScriptProcessor
  // node and voice WebSocket leak, and the microphone stays hot. stopVoice is
  // not memoized, so route the unmount call through a ref to always invoke the
  // latest version without re-registering this effect on every render.
  const stopVoiceRef = useRef(stopVoice);
  stopVoiceRef.current = stopVoice;
  useEffect(() => {
    return () => {
      stopVoiceRef.current?.();
    };
  }, []);

  const sendVoiceText = (text: string) => {
    const trimmed = text.trim();
    const ws = wsRef.current;
    if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return;
    appendVoiceTurn("user", trimmed);
    lastVoiceUserMessageRef.current = trimmed;
    pendingVoiceUserMessagesRef.current.push(trimmed);
    setVoiceCaption({ role: "user", text: trimmed });
    recordVoiceAgentEvent({
      type: "user_turn",
      status: "running",
      sessionId: voiceSessionIdRef.current || undefined,
      summary: `Typed voice turn injected: ${compactVoiceEventText(trimmed)}`,
      metadata: {
        source: "typed",
        characterCount: trimmed.length,
        proofAttemptId: getVoiceProofAttemptId(),
      },
    });
    if (!endingRef.current && detectEndIntent(trimmed)) {
      endingRef.current = true;
      activeAudioNodesRef.current.forEach((node) => {
        try {
          node.stop();
        } catch {}
      });
      activeAudioNodesRef.current = [];
      setVoiceCaption(null);
      endTimerRef.current = setTimeout(() => stopVoice(), 250);
      return;
    }
    ws.send(JSON.stringify({ type: "InjectUserMessage", content: trimmed }));
  };

  const handleVoiceFunctionCallRequest = useCallback(
    async (msg: { functions?: VoiceAgentFunctionCall[] }, ws: WebSocket) => {
      const functionCalls = Array.isArray(msg.functions) ? msg.functions : [];
      const sessionId = voiceSessionIdRef.current || `voice-${Date.now()}`;
      const proofAttemptId = getVoiceProofAttemptId();

      for (const call of functionCalls) {
        const toolName = call.name || "unknown_tool";
        const toolCallId = call.id || `${toolName}-${Date.now()}`;
        const startedAt = Date.now();
        const rawArgs = call.arguments ?? call.input ?? "{}";
        const inputSummary = compactVoiceEventText(
          `${toolName}: ${rawArgs}`,
          180,
        );

        if (call.client_side === false) {
          recordVoiceAgentEvent({
            type: "tool_call",
            status: "completed",
            sessionId,
            summary: `Voice tool handled by provider: ${toolName}`,
            metadata: {
              toolCallId,
              clientSide: false,
              proofAttemptId,
            },
          });
          continue;
        }

        recordVoiceAgentEvent({
          type: "tool_call",
          status: "running",
          sessionId,
          summary: `Voice tool requested: ${toolName}`,
          metadata: {
            toolCallId,
            inputSummary,
            proofAttemptId,
          },
        });
        await recordToolJobEvent({
          toolName,
          status: "running",
          requestId: sessionId,
          source: "voice_agent",
          inputSummary,
          metadata: {
            toolCallId,
            voiceSessionId: sessionId,
            proofAttemptId,
          },
        });

        try {
          const args = parseVoiceFunctionArguments(call);
          let result: Record<string, unknown>;
          let toolCompletionStatus: "completed" | "blocked" = "completed";

          if (toolName === "look_at_study_context") {
            const contextPayload =
              voiceStudyContextRef.current || (await buildVoiceStudyContext());
            voiceStudyContextRef.current = contextPayload;
            result = {
              status: "ready",
              question: String(args.question || "").slice(0, 500),
              activeBookId: canonicalActiveBookId || "",
              activeBookTitle: activeLearningBookTitle || activeProject,
              activeDocumentId: activeDocumentId || "",
              documentCount: contextPayload.documentCount,
              contextChars: contextPayload.studyContextChars,
              context: contextPayload.studyContext,
            };
          } else if (toolName === "update_graph") {
            const name = String(args.name || "").trim();
            const description = String(args.description || "").trim();
            if (!name || !description) {
              throw new Error("update_graph requires name and description.");
            }
            const understandingDelta = Math.max(
              -0.2,
              Math.min(0.2, Number(args.understandingDelta || 0)),
            );
            await brainOrchestrator.addOrUpdateConcept(
              name,
              description,
              understandingDelta,
              undefined,
              {
                userId: activeUserId,
                requestId: sessionId,
                proofAttemptId,
                mode: "voice",
                agentLayer: "voice_realtime",
                bookId: canonicalActiveBookId,
                conversationId: canonicalActiveBookId
                  ? chatThreadIdForBook(canonicalActiveBookId)
                  : undefined,
                documentId: activeDocumentId,
                toolCallId,
                source: "voice_graph_update",
              },
            );
            result = {
              status: "stored",
              concept: name,
              understandingDelta,
              activeBookId: canonicalActiveBookId || "",
            };
          } else if (toolName === "generate_flashcards") {
            const cards = Array.isArray(args.cards)
              ? args.cards
                  .filter((card: any) => card?.front && card?.back)
                  .slice(0, 8)
              : [];
            if (!cards.length) {
              throw new Error(
                "generate_flashcards requires at least one card.",
              );
            }
            const storedFlashcards = await Promise.all(
              cards.map(async (card: any) => {
                const { flashcard } = await createFlashcardForStorage(card, {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                  bookId: canonicalActiveBookId || undefined,
                  bookTitle:
                    activeLearningBookTitle || activeProject || undefined,
                });
                await db.flashcards.add(flashcard);
                return flashcard;
              }),
            );
            await recordGeneratedFlashcardsArtifact({
              batchId: `${sessionId}:${toolCallId}:voice-flashcards`,
              cards: storedFlashcards,
              source: "voice_tool_flashcard_generation",
              sourceMessageId: sessionId,
              messageId: sessionId,
              conversationId: canonicalActiveBookId
                ? chatThreadIdForBook(canonicalActiveBookId)
                : undefined,
              bookId: canonicalActiveBookId || undefined,
              bookTitle: activeLearningBookTitle || activeProject || undefined,
              metadata: {
                generationPath: "voice_agent_function_call",
                toolCallId,
                voiceSessionId: sessionId,
                proofAttemptId,
              },
            });
            setMessages((prev) =>
              prev.map((message) =>
                message.id === sessionId
                  ? { ...message, hasFlashcards: true }
                  : message,
              ),
            );
            result = {
              status: "stored",
              cardCount: storedFlashcards.length,
              activeBookId: canonicalActiveBookId || "",
            };
          } else if (toolName === "evaluate_answer") {
            const results = await recordEvaluatedAnswerEvidenceBatch([args], {
              userId: activeUserId,
              bookId: canonicalActiveBookId || undefined,
              bookTitle: activeLearningBookTitle || activeProject || undefined,
              conversationId: canonicalActiveBookId
                ? chatThreadIdForBook(canonicalActiveBookId)
                : undefined,
              requestId: sessionId,
              sourceId: toolCallId,
              source: "voice_tool_evaluate_answer",
              evaluator: "model_rubric",
              metadata: {
                userId: activeUserId,
                toolCallId,
                voiceSessionId: sessionId,
                agentLayer: "voice_realtime",
                mode: "voice",
                proofAttemptId,
                runtimeSettings: brainRuntimeSettings,
              },
            });
            const recordedCount = results.filter(
              (item) => item.status === "recorded",
            ).length;
            if (recordedCount === 0) {
              toolCompletionStatus = "blocked";
            }
            result = {
              status: recordedCount > 0 ? "stored" : "skipped",
              recordedCount,
              evaluations: results,
              activeBookId: canonicalActiveBookId || "",
            };
          } else if (toolName === "look_at_current_page") {
            const query = String(
              args.query ||
                lastVoiceUserMessageRef.current ||
                "Describe this page.",
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 500);
            let image: string | null = null;
            try {
              image = captureCurrentPdfPageImage();
            } catch (visionErr) {
              console.warn("Could not extract voice vision image:", visionErr);
            }
            if (!image) {
              toolCompletionStatus = "blocked";
              result = {
                status: "blocked",
                query,
                reason:
                  "No rendered PDF page image was available for voice current-page inspection.",
                activeDocumentId: activeDocumentId || "",
              };
            } else {
              const response = await fetch("/api/voice-current-page", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify({
                  requestId: sessionId,
                  query,
                  image,
                }),
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(
                  payload.error || "Voice current-page vision unavailable.",
                );
              }
              result = {
                status: "ready",
                query,
                model: payload.model || "openai/gpt-4o-mini",
                result: payload.result || "",
                activeDocumentId: activeDocumentId || "",
              };
            }
            const focusSummary =
              typeof result.result === "string"
                ? result.result
                : typeof result.reason === "string"
                  ? result.reason
                  : "Voice current-page inspection finished.";
            appendVoiceVisualFocus({
              id: `${sessionId}:${toolCallId}:current-page`,
              kind: "current_page",
              status:
                result.status === "blocked" || result.status === "failed"
                  ? result.status
                  : "ready",
              title: "Current page or diagram inspected",
              query,
              summary: compactVoiceEventText(focusSummary, 320),
              focusedTarget: "current PDF page",
              activeDocumentId: activeDocumentId || "",
              toolCallId,
            });
            window.dispatchEvent(
              new CustomEvent("learningai:voice-visual-focus", {
                detail: {
                  source: "voice_look_at_current_page",
                  status: result.status,
                  query,
                  summary: compactVoiceEventText(focusSummary, 220),
                  activeDocumentId: activeDocumentId || "",
                  proofAttemptId,
                  toolCallId,
                },
              }),
            );
          } else if (toolName === "render_diagram") {
            const title = String(args.title || "Voice diagram")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120);
            const mermaid = String(args.mermaid || args.chart || "")
              .replace(/\r\n/g, "\n")
              .trim();
            const explanation = String(args.explanation || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 400);
            if (!mermaid) {
              throw new Error("render_diagram requires Mermaid content.");
            }
            appendVoiceVisualFocus({
              id: `${sessionId}:${toolCallId}:diagram`,
              kind: "diagram",
              status: "ready",
              title,
              query: title,
              summary:
                explanation ||
                "Rendered a local Mermaid diagram for the voice explanation.",
              focusedTarget: "chat diagram surface",
              toolCallId,
              mermaid,
            });
            window.dispatchEvent(
              new CustomEvent("learningai:voice-visual-focus", {
                detail: {
                  source: "voice_render_diagram",
                  status: "ready",
                  query: title,
                  summary:
                    explanation ||
                    "Rendered a local Mermaid diagram for the voice explanation.",
                  proofAttemptId,
                  toolCallId,
                },
              }),
            );
            result = {
              status: "ready",
              title,
              rendered: true,
              focusTour: "enabled",
              explanation,
            };
          } else if (toolName === "web_search") {
            const query = String(args.query || "")
              .replace(/\s+/g, " ")
              .trim();
            if (!query) {
              throw new Error("web_search requires a query.");
            }
            const mode = args.mode === "news" ? "news" : "search";
            const maxResults = Math.min(
              Math.max(Number(args.maxResults || 6) || 6, 1),
              10,
            );
            const intentText = `${lastVoiceUserMessageRef.current} ${query}`;
            const explicitWebIntent =
              /\b(web|internet|online|search|google|look up|browse)\b/i.test(
                intentText,
              );
            const externalImageIntent =
              /\b(external|online|web|internet)\b/i.test(intentText) &&
              /\b(image|images|diagram|diagrams|flowchart|flowcharts|figure|figures|visual example)\b/i.test(
                intentText,
              );
            const freshnessIntent =
              /\b(latest|current|recent|today|yesterday|news|price|pricing|release|ranking|rankings|weather|score|schedule|trend|trending)\b/i.test(
                intentText,
              );
            const sourceLocalIntent =
              /\b(current page|this page|screen|document|pdf|selected text|uploaded|active book|study context|chapter)\b/i.test(
                intentText,
              );
            const allowed =
              explicitWebIntent ||
              externalImageIntent ||
              (freshnessIntent && !sourceLocalIntent) ||
              (brainRuntimeSettings.webSearchPolicy !== "manual_only" &&
                freshnessIntent);

            if (!allowed) {
              toolCompletionStatus = "blocked";
              result = {
                status: "blocked",
                query,
                reason:
                  "Voice web search stayed local because the turn looked like a source-material or memory-context question.",
                policy: brainRuntimeSettings.webSearchPolicy,
              };
            } else {
              const searchStartedAt = Date.now();
              const response = await fetch("/api/voice-web-search", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(serperApiKey ? { "X-Serper-API-Key": serperApiKey } : {}),
                },
                body: JSON.stringify({
                  requestId: sessionId,
                  query,
                  mode,
                  maxResults,
                  serperApiKey: serperApiKey || undefined,
                }),
              });
              const payload = await response.json().catch(() => ({}));
              const searchId =
                typeof payload.searchId === "string"
                  ? payload.searchId
                  : `voice_web_${Date.now()}`;
              const sources = Array.isArray(payload.sources)
                ? (payload.sources as NormalizedWebSource[])
                : [];

              recordWebSearchEvent({
                type: "started",
                searchId,
                query,
                mode,
              });
              recordWebUsage({
                provider: "serper",
                requests: 1,
                searchRequests: mode === "news" ? 0 : 1,
                newsRequests: mode === "news" ? 1 : 0,
                estimated: true,
              });

              if (!response.ok) {
                recordWebSearchEvent({
                  type: "error",
                  searchId,
                  status: payload.error || "Voice web search unavailable.",
                });
                recordWebUsage({
                  provider: "serper",
                  failures: 1,
                  estimated: true,
                });
                await recordUnavailableCitationState({
                  searchId,
                  query,
                  reason: payload.error || "Voice web search unavailable.",
                  source: "voice_web_search",
                  metadata: {
                    toolCallId,
                    voiceSessionId: sessionId,
                    proofAttemptId,
                  },
                });
                throw new Error(
                  payload.error || "Voice web search unavailable.",
                );
              }

              if (sources.length) {
                cacheWebSources(sources);
              }
              recordWebSearchEvent({
                type: "complete",
                searchId,
                sources,
                status: `Reviewed ${sources.length} source${sources.length === 1 ? "" : "s"}`,
              });
              recordWebUsage({
                provider: "serper",
                sourcesReviewed: sources.length,
                estimated: true,
              });
              sources.forEach(
                (source) =>
                  void recordWebSourceArtifact({
                    webSource: source,
                    searchId,
                    query,
                    eventSource: "voice_web_search",
                    messageId: sessionId,
                    conversationId: canonicalActiveBookId
                      ? chatThreadIdForBook(canonicalActiveBookId)
                      : undefined,
                    bookId: canonicalActiveBookId || undefined,
                    metadata: {
                      toolCallId,
                      voiceSessionId: sessionId,
                      durationMs: Date.now() - searchStartedAt,
                      proofAttemptId,
                    },
                  }),
              );
              if (!sources.length) {
                await recordUnavailableCitationState({
                  searchId,
                  query,
                  reason: "No web sources returned.",
                  source: "voice_web_search",
                  metadata: {
                    toolCallId,
                    voiceSessionId: sessionId,
                    proofAttemptId,
                  },
                });
              }
              result = {
                status: sources.length ? "ready" : "empty",
                query,
                mode,
                sourceCount: sources.length,
                sources: sources.slice(0, 6).map((source) => ({
                  id: source.id,
                  type: source.type,
                  sourceType: source.sourceType,
                  title: source.title,
                  url: source.url,
                  domain: source.domain,
                  faviconUrl: source.faviconUrl,
                  snippet: source.snippet,
                  date: source.date,
                  position: source.position,
                  imageUrl: source.imageUrl,
                  thumbnailUrl: source.thumbnailUrl,
                  imageWidth: source.imageWidth,
                  imageHeight: source.imageHeight,
                  imageSource: source.imageSource,
                })),
              };
            }
            const visibleSources = Array.isArray(result.sources)
              ? (result.sources as NormalizedWebSource[])
              : [];
            appendVoiceVisualFocus({
              id: `${sessionId}:${toolCallId}:web-search`,
              kind: "web_search",
              status:
                result.status === "blocked" || result.status === "empty"
                  ? result.status
                  : "ready",
              title: "Voice web image/source retrieval",
              query,
              summary:
                result.status === "blocked"
                  ? String(result.reason || "Voice web search was blocked.")
                  : `${visibleSources.length} web source${visibleSources.length === 1 ? "" : "s"} returned through the voice web-search path.`,
              focusedTarget: "chat tool surface",
              toolCallId,
              imageCount: visibleSources.filter(
                (source) => source.imageUrl || source.thumbnailUrl,
              ).length,
              sources: visibleSources,
            });
          } else {
            throw new Error(`Unsupported voice tool: ${toolName}`);
          }

          ws.send(JSON.stringify(buildVoiceFunctionCallResponse(call, result)));
          recordVoiceAgentEvent({
            type: "tool_call",
            status: "completed",
            sessionId,
            summary: `Voice tool ${toolCompletionStatus}: ${toolName}`,
            metadata: {
              toolCallId,
              result,
              proofAttemptId,
            },
          });
          await recordToolJobEvent({
            toolName,
            status: toolCompletionStatus,
            requestId: sessionId,
            source: "voice_agent",
            inputSummary,
            outputSummary:
              typeof result.status === "string"
                ? String(result.status)
                : "Voice tool completed.",
            durationMs: Date.now() - startedAt,
            metadata: {
              toolCallId,
              voiceSessionId: sessionId,
              proofAttemptId,
              result,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          ws.send(
            JSON.stringify(
              buildVoiceFunctionCallResponse(call, {
                status: "failed",
                error: message,
              }),
            ),
          );
          recordVoiceAgentEvent({
            type: "tool_call",
            status: "failed",
            sessionId,
            summary: `Voice tool failed: ${toolName}`,
            metadata: {
              toolCallId,
              error: message,
              proofAttemptId,
            },
          });
          await recordToolJobEvent({
            toolName,
            status: "failed",
            requestId: sessionId,
            source: "voice_agent",
            inputSummary,
            error: message,
            durationMs: Date.now() - startedAt,
            metadata: {
              toolCallId,
              voiceSessionId: sessionId,
              proofAttemptId,
            },
          });
        }
      }
    },
    [
      activeDocumentId,
      activeLearningBookTitle,
      activeProject,
      apiKey,
      brainRuntimeSettings.webSearchPolicy,
      buildVoiceStudyContext,
      cacheWebSources,
      canonicalActiveBookId,
      getVoiceProofAttemptId,
      recordVoiceAgentEvent,
      recordWebSearchEvent,
      recordWebUsage,
      serperApiKey,
      setMessages,
    ],
  );

  const startVoice = async () => {
    if (!usesCustomVoiceBroker && !hasDeepgramRuntimeKey) {
      alert(
        "Please configure your Deepgram API Key in settings or expose the local server fallback before using Voice features.",
      );
      return;
    }
    if (activeBetaProofTrafficLocked) {
      alertProofTrafficApprovalNeeded();
      return;
    }
    if (window.location.hostname.endsWith(".vercel.app")) {
      alert(
        "Live Voice uses a WebSocket backend, which cannot run inside this Vercel deployment. Read Aloud still works through the HTTP TTS route; deploy the Node server separately for live voice.",
      );
      return;
    }

    try {
      endingRef.current = false;
      voiceTurnsRef.current = [];
      const sessionId = `voice-${Date.now()}`;
      voiceSessionIdRef.current = sessionId;
      voiceProofAttemptIdRef.current = activeBetaProofAttemptId || null;
      voiceStartedAtRef.current = Date.now();
      voiceSessionCountedRef.current = false;
      voiceSessionErrorRef.current = null;
      micSignalAnnouncedRef.current = false;
      recordVoiceAgentEvent({
        type: "session_started",
        status: "started",
        sessionId,
        summary: usesCustomVoiceBroker
          ? `Local voice broker session starting for ${activeLearningBookTitle}.`
          : `Voice session starting for ${activeLearningBookTitle}.`,
        metadata: {
          language,
          bookId: canonicalActiveBookId,
          documentId: activeDocumentId,
          voiceBrokerMode,
          proofAttemptId: getVoiceProofAttemptId(),
        },
      });
      recordVoiceModelRun("started", sessionId, {
        phase: "session_started",
        language,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: sessionId,
          requestId: sessionId,
          role: "assistant",
          content: "",
          isVoice: true,
          voiceSession: {
            turns: [],
            startedAt: Date.now(),
            durationSeconds: 0,
          },
        },
      ]);
      setVoiceState("listening");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone capture is not available in this browser context.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioContextCtor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Microphone audio processing is not available here.");
      }
      let audioContext: AudioContext;
      try {
        audioContext = new AudioContextCtor({ sampleRate: 48000 });
      } catch {
        audioContext = new AudioContextCtor();
      }
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      const inputSampleRate = Math.max(
        8000,
        Math.round(audioContext.sampleRate || 48000),
      );
      voiceInputSampleRateRef.current = inputSampleRate;
      const audioTrackSettings = (stream.getAudioTracks()[0]?.getSettings?.() ||
        {}) as Record<string, unknown>;
      recordVoiceAgentEvent({
        type: "mic_signal",
        status: "started",
        sessionId,
        summary: `Microphone stream opened at ${inputSampleRate} Hz; waiting for speech.`,
        metadata: {
          inputSampleRate,
          requestedSampleRate: 48000,
          trackSampleRate: audioTrackSettings.sampleRate,
          channelCount: audioTrackSettings.channelCount,
          proofAttemptId: getVoiceProofAttemptId(),
        },
      });

      let ws: WebSocket | null = null;
      let hasSentVoiceAuth = false;
      const pendingVoiceAudioFrames: ArrayBuffer[] = [];
      const flushPendingVoiceAudio = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !hasSentVoiceAuth) {
          return;
        }
        const frames = pendingVoiceAudioFrames.splice(
          0,
          pendingVoiceAudioFrames.length,
        );
        frames.forEach((frame) => ws?.send(frame));
      };

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const outputGain = audioContext.createGain();
      const outputAnalyser = audioContext.createAnalyser();
      outputAnalyser.fftSize = 256;
      outputAnalyser.smoothingTimeConstant = 0.6;
      outputGain.connect(outputAnalyser);
      outputAnalyser.connect(audioContext.destination);
      outputGainRef.current = outputGain;
      outputAnalyserRef.current = outputAnalyser;

      const outputBuffer = new Uint8Array(outputAnalyser.fftSize);
      const sampleOutput = () => {
        const analyser = outputAnalyserRef.current;
        if (analyser) {
          analyser.getByteTimeDomainData(outputBuffer);
          let sum = 0;
          for (let i = 0; i < outputBuffer.length; i++) {
            const value = (outputBuffer[i] - 128) / 128;
            sum += value * value;
          }
          const rms = Math.sqrt(sum / outputBuffer.length);
          window.dispatchEvent(
            new CustomEvent("tts-volume", { detail: Math.min(1, rms * 3.5) }),
          );
        }
        outputRafRef.current = requestAnimationFrame(sampleOutput);
      };
      outputRafRef.current = requestAnimationFrame(sampleOutput);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const volume = Math.min(1, rms * 8); // Scale
        window.dispatchEvent(new CustomEvent("mic-volume", { detail: volume }));

        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7fff;
        }
        const pcmFrame = pcm16.buffer.slice(0);

        if (
          !micSignalAnnouncedRef.current &&
          volume > 0.035 &&
          ((ws?.readyState === WebSocket.OPEN && hasSentVoiceAuth) ||
            pendingVoiceAudioFrames.length > 0)
        ) {
          micSignalAnnouncedRef.current = true;
          recordVoiceAgentEvent({
            type: "mic_signal",
            status: "running",
            sessionId: voiceSessionIdRef.current || undefined,
            summary:
              "Microphone signal detected; audio frames are queued for the voice websocket.",
            metadata: {
              volume: volume.toFixed(3),
              inputSampleRate: voiceInputSampleRateRef.current,
              pendingFrames: pendingVoiceAudioFrames.length,
              proofAttemptId: getVoiceProofAttemptId(),
            },
          });
        }

        if (volume < 0.28) {
          noiseFloorRef.current = noiseFloorRef.current * 0.95 + volume * 0.05;
        }

        const bargeThreshold = Math.max(
          0.46,
          noiseFloorRef.current * 2.5 + 0.24,
        );
        if (activeAudioNodesRef.current.length > 0) {
          if (volume > bargeThreshold) {
            bargeInFramesRef.current += 1;
            if (bargeInFramesRef.current >= 6) {
              activeAudioNodesRef.current.forEach((node) => {
                try {
                  node.stop();
                } catch {}
              });
              cancelBrowserVoiceSpeech();
              activeAudioNodesRef.current = [];
              clearPacedVoiceReveal();
              pacedVoiceTurnRef.current = null;
              if (audioContextRef.current) {
                nextPlayTimeRef.current = audioContextRef.current.currentTime;
              }
              setVoiceCaption(null);
              setVoiceState("listening");
              bargeInFramesRef.current = 0;
            }
          } else {
            bargeInFramesRef.current = 0;
          }
        } else {
          bargeInFramesRef.current = 0;
        }

        if (ws?.readyState === WebSocket.OPEN && hasSentVoiceAuth) {
          flushPendingVoiceAudio();
          ws.send(pcmFrame);
        } else if (pendingVoiceAudioFrames.length < 120) {
          pendingVoiceAudioFrames.push(pcmFrame);
        } else {
          pendingVoiceAudioFrames.shift();
          pendingVoiceAudioFrames.push(pcmFrame);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      const voiceContextPayload = await buildVoiceStudyContext().catch(
        (error: unknown): null => {
          console.warn("[ChatPanel] Voice study context failed:", error);
          recordVoiceAgentEvent({
            type: "context_attached",
            status: "failed",
            sessionId,
            summary:
              "Voice context injection failed; continuing with base voice prompt.",
            metadata: {
              error: error instanceof Error ? error.message : String(error),
              bookId: canonicalActiveBookId,
              documentId: activeDocumentId,
              proofAttemptId: getVoiceProofAttemptId(),
            },
          });
          return null;
        },
      );
      voiceStudyContextRef.current = voiceContextPayload;
      if (voiceContextPayload?.studyContext) {
        recordVoiceAgentEvent({
          type: "context_attached",
          status: "completed",
          sessionId,
          summary: `Attached ${voiceContextPayload.studyContextChars.toLocaleString()} chars of local book, memory, and document context to voice mode.`,
          metadata: {
            bookId: canonicalActiveBookId,
            activeBookTitle: activeLearningBookTitle,
            documentId: activeDocumentId,
            documentCount: voiceContextPayload.documentCount,
            documentIds: voiceContextPayload.documentIds,
            readyDocumentCount: voiceContextPayload.readyDocumentCount,
            readyDocumentIds: voiceContextPayload.readyDocumentIds,
            contextDocumentIds: voiceContextPayload.contextDocumentIds,
            unreadyDocumentCount: voiceContextPayload.unreadyDocumentCount,
            omittedReadyDocumentCount:
              voiceContextPayload.omittedReadyDocumentCount,
            memoryContextChars: voiceContextPayload.memoryContextChars,
            activeBookContextChars: voiceContextPayload.activeBookContextChars,
            documentContextChars: voiceContextPayload.documentContextChars,
            rawContextChars: voiceContextPayload.rawContextChars,
            contextCompacted: voiceContextPayload.contextCompacted,
            proofAttemptId:
              voiceContextPayload.proofAttemptId || getVoiceProofAttemptId(),
          },
        });
        recordVoiceModelRun("started", sessionId, {
          phase: "context_attached",
          language,
          contextAttached: true,
          rawContextChars: voiceContextPayload.rawContextChars,
        });
      }

      const voiceSocketPath = usesCustomVoiceBroker
        ? "/api/voice-broker"
        : "/api/voice-agent";
      const wsUrl = `${voiceServerWsUrl()}${voiceSocketPath}?language=${encodeURIComponent(language)}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(
          usesCustomVoiceBroker
            ? "Connected to local voice broker"
            : "Connected to Deepgram proxy",
        );
        const proofAttemptId = getVoiceProofAttemptId();
        ws.send(
          JSON.stringify({
            type: "voice_auth",
            userId: activeUserId,
            voiceSessionId: sessionId,
            requestId: sessionId,
            proofAttemptId,
            deepgramKey: deepgramApiKey,
            foregroundApiKey: apiKey,
            backgroundApiKey: apiKey,
            ...(usesCustomVoiceBroker ? {} : { serperApiKey }),
            inputSampleRate,
            language,
            voiceBrokerMode,
            foregroundModel: "openai/gpt-4o-mini",
            backgroundModel: "openai/gpt-5.5",
            ttsModel: voiceBrokerTtsModel,
            browserTts: usesBrowserVoiceTts,
            misoTtsApiUrl:
              usesCustomVoiceBroker && misoTtsApiUrl.trim()
                ? misoTtsApiUrl.trim()
                : "",
            studyContext: voiceContextPayload?.studyContext || "",
            activeBookId: canonicalActiveBookId || "",
            activeBookTitle: activeLearningBookTitle || activeProject,
            activeDocumentId: activeDocumentId || "",
            documentIds: voiceContextPayload?.documentIds || [],
            documentCount: voiceContextPayload?.documentCount || 0,
            readyDocumentIds: voiceContextPayload?.readyDocumentIds || [],
            readyDocumentCount: voiceContextPayload?.readyDocumentCount || 0,
            contextDocumentIds: voiceContextPayload?.contextDocumentIds || [],
            unreadyDocumentCount:
              voiceContextPayload?.unreadyDocumentCount || 0,
            omittedReadyDocumentCount:
              voiceContextPayload?.omittedReadyDocumentCount || 0,
            studyContextChars: voiceContextPayload?.studyContextChars || 0,
            studyContextMetadata: {
              userId: activeUserId,
              mode: "voice",
              agentLayer: "voice_realtime",
              voiceBrokerMode,
              foregroundModel: "openai/gpt-4o-mini",
              backgroundModel: "openai/gpt-5.5",
              ttsModel: voiceBrokerTtsModel,
              proofAttemptId,
              documentIds: voiceContextPayload?.documentIds || [],
              readyDocumentIds: voiceContextPayload?.readyDocumentIds || [],
              contextDocumentIds: voiceContextPayload?.contextDocumentIds || [],
              readyDocumentCount: voiceContextPayload?.readyDocumentCount || 0,
              unreadyDocumentCount:
                voiceContextPayload?.unreadyDocumentCount || 0,
              omittedReadyDocumentCount:
                voiceContextPayload?.omittedReadyDocumentCount || 0,
              contextCompacted: voiceContextPayload?.contextCompacted || false,
              rawContextChars: voiceContextPayload?.rawContextChars || 0,
              memoryContextChars: voiceContextPayload?.memoryContextChars || 0,
              activeBookContextChars:
                voiceContextPayload?.activeBookContextChars || 0,
              documentContextChars:
                voiceContextPayload?.documentContextChars || 0,
            },
          }),
        );
        hasSentVoiceAuth = true;
        flushPendingVoiceAudio();
        const pendingVoiceProofScript = pendingVoiceProofScriptRef.current;
        if (pendingVoiceProofScript) {
          pendingVoiceProofScriptRef.current = null;
          sendVoiceText(pendingVoiceProofScript);
          handleInputChange("");
        }
        // Settings config is sent by the proxy after auth. We just stream audio now.
      };

      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            const proofAttemptId = getVoiceProofAttemptId();
            const transcriptEvent = normalizeVoiceTranscriptEvent(msg);

            if (msg.type === "usage" && msg.usage) {
              if (Number(msg.usage.sessions || 0) > 0) {
                voiceSessionCountedRef.current = true;
              }
              recordVoiceUsage(msg.usage);
            } else if (msg.type === "SettingsApplied") {
              console.log(
                usesCustomVoiceBroker
                  ? "Local voice broker settings applied"
                  : "Deepgram SettingsApplied",
              );
              recordVoiceAgentEvent({
                type: "settings_applied",
                status: "completed",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: usesCustomVoiceBroker
                  ? "Local voice broker settings applied."
                  : "Deepgram voice-agent settings applied.",
                metadata: {
                  language,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
            } else if (msg.type === "VoiceBrokerReady") {
              const brokerTtsProvider =
                msg.ttsProvider === "browser" ||
                msg.ttsProvider === "miso" ||
                msg.ttsProvider === "deepgram"
                  ? msg.ttsProvider
                  : "deepgram";
              voiceBrokerTtsProviderRef.current = brokerTtsProvider;
              recordVoiceAgentEvent({
                type: "broker_ready",
                status: "completed",
                sessionId: voiceSessionIdRef.current || undefined,
                summary:
                  "Local voice broker is ready with foreground, TTS, and background model adapters staged.",
                metadata: {
                  provider: msg.provider,
                  foregroundModel: msg.foregroundModel,
                  backgroundModel: msg.backgroundModel,
                  ttsModel: msg.ttsModel,
                  ttsProvider: brokerTtsProvider,
                  sttModel: msg.sttModel,
                  contextChars: msg.contextChars,
                  language: msg.language || language,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
            } else if (msg.type === "BackgroundJobStarted") {
              recordLearnerBackgroundTask({
                taskId: msg.jobId,
                requestId: voiceSessionIdRef.current || undefined,
                source: "voice_broker",
                taskType: "async_tool_or_research",
                status: "running",
                inputSummary: String(msg.query || msg.intent || "tool task"),
                metadata: {
                  model: msg.model,
                  intent: msg.intent,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
              recordVoiceAgentEvent({
                type: "background_job",
                status: "running",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: `Background ${msg.model || "model"} job staged: ${compactVoiceEventText(String(msg.query || msg.intent || "tool task"), 120)}`,
                metadata: {
                  jobId: msg.jobId,
                  model: msg.model,
                  intent: msg.intent,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
            } else if (msg.type === "BackgroundJobResult") {
              recordLearnerBackgroundTask({
                taskId: msg.jobId,
                requestId: voiceSessionIdRef.current || undefined,
                source: "voice_broker",
                taskType: "async_tool_or_research",
                status:
                  msg.status === "pending_provider_key" ||
                  msg.status === "failed"
                    ? "failed"
                    : "completed",
                outputSummary: String(
                  msg.summary || "Background job update received.",
                ),
                error:
                  msg.status === "pending_provider_key" ||
                  msg.status === "failed"
                    ? String(msg.summary || msg.status)
                    : undefined,
                metadata: {
                  jobId: msg.jobId,
                  status: msg.status,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
              recordVoiceAgentEvent({
                type: "background_job",
                status:
                  msg.status === "pending_provider_key"
                    ? "failed"
                    : "completed",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: compactVoiceEventText(
                  String(msg.summary || "Background job update received."),
                  180,
                ),
                metadata: {
                  jobId: msg.jobId,
                  status: msg.status,
                  voiceBrokerMode,
                  proofAttemptId,
                },
              });
            } else if (transcriptEvent) {
              const transcriptContent = transcriptEvent.content;
              if (transcriptContent) {
                setVoiceCaption({
                  role: transcriptEvent.role,
                  text: transcriptContent,
                });
              }
              if (transcriptEvent.role === "user") {
                const isInterimTranscript = /InterimTranscript/i.test(
                  transcriptEvent.rawType,
                );
                if (!isInterimTranscript) {
                  lastVoiceUserMessageRef.current = transcriptContent;
                  pendingVoiceUserMessagesRef.current.push(transcriptContent);
                  appendVoiceTurn("user", transcriptContent);
                  recordVoiceAgentEvent({
                    type: "user_turn",
                    status: "running",
                    sessionId: voiceSessionIdRef.current || undefined,
                    summary: `Student said: ${compactVoiceEventText(transcriptContent)}`,
                    metadata: {
                      source: "microphone",
                      characterCount: transcriptContent.length,
                      rawType: transcriptEvent.rawType,
                      sourceField: transcriptEvent.sourceField,
                      proofAttemptId,
                    },
                  });
                }
                if (
                  !isInterimTranscript &&
                  !endingRef.current &&
                  detectEndIntent(transcriptContent)
                ) {
                  endingRef.current = true;
                  activeAudioNodesRef.current.forEach((node) => {
                    try {
                      node.stop();
                    } catch {}
                  });
                  cancelBrowserVoiceSpeech();
                  activeAudioNodesRef.current = [];
                  setVoiceCaption(null);
                  endTimerRef.current = setTimeout(() => stopVoice(), 250);
                  return;
                }
              } else if (transcriptEvent.role === "assistant") {
                const pacedDisplay =
                  msg.displayMode === "paced" ||
                  Number(msg.estimatedSpeechMs || 0) > 0;
                if (pacedDisplay) {
                  startPacedAssistantTurn(transcriptContent, {
                    turnId:
                      typeof msg.turnId === "string" ? msg.turnId : undefined,
                    durationMs: Number(msg.estimatedSpeechMs || 0),
                  });
                } else {
                  appendVoiceTurn("assistant", transcriptContent);
                }
                const shouldUseBrowserVoiceTts =
                  usesBrowserVoiceTts &&
                  voiceBrokerTtsProviderRef.current === "browser";
                const browserTtsStarted = shouldUseBrowserVoiceTts
                  ? speakBrowserVoiceText(transcriptContent)
                  : false;
                recordVoiceAgentEvent({
                  type: "assistant_turn",
                  status: "completed",
                  sessionId: voiceSessionIdRef.current || undefined,
                  summary: `Aria replied: ${compactVoiceEventText(transcriptContent)}`,
                  metadata: {
                    characterCount: transcriptContent.length,
                    rawType: transcriptEvent.rawType,
                    sourceField: transcriptEvent.sourceField,
                    displayMode: msg.displayMode,
                    turnId: msg.turnId,
                    ttsProvider: voiceBrokerTtsProviderRef.current,
                    browserTtsStarted,
                    proofAttemptId,
                  },
                });
                if (
                  msg.source !== "background" &&
                  pendingVoiceUserMessagesRef.current.length > 0 &&
                  transcriptContent
                ) {
                  const userMessage =
                    pendingVoiceUserMessagesRef.current.shift() || "";
                  lastVoiceUserMessageRef.current =
                    pendingVoiceUserMessagesRef.current[0] || "";
                  brainOrchestrator.trackInteraction(
                    userMessage,
                    transcriptContent,
                    undefined,
                    {
                      userId: activeUserId,
                      bookId: canonicalActiveBookId,
                      conversationId: canonicalActiveBookId
                        ? chatThreadIdForBook(canonicalActiveBookId)
                        : undefined,
                      documentId: activeDocumentId,
                      requestId: voiceSessionIdRef.current || undefined,
                      proofAttemptId,
                      mode: "voice",
                      agentLayer: "voice_realtime",
                    },
                  );
                  void brainOrchestrator
                    .updateLearningBookFromConversation({
                      userId: activeUserId,
                      userName: learnerName,
                      activeProject,
                      activeBookId: canonicalActiveBookId,
                      activeDocumentId,
                      requestId: voiceSessionIdRef.current || undefined,
                      proofAttemptId,
                      mode: "voice",
                      agentLayer: "voice_realtime",
                      conversationId: canonicalActiveBookId
                        ? chatThreadIdForBook(canonicalActiveBookId)
                        : undefined,
                      documentContexts: orderedBookDocuments,
                      userMessage,
                      assistantMessage: transcriptContent,
                      apiKey,
                    })
                    .catch((error) => {
                      console.warn(
                        "[ChatPanel] Voice learning book update failed:",
                        error,
                      );
                    });
                }
              }
            } else if (msg.type === "FunctionCallRequest") {
              await handleVoiceFunctionCallRequest(msg, ws);
            } else if (msg.type === "UserStartedSpeaking") {
              // Interrupt playing
              recordVoiceAgentEvent({
                type: "barge_in",
                status: "running",
                sessionId: voiceSessionIdRef.current || undefined,
                summary:
                  "Student started speaking; current playback was interrupted.",
                metadata: {
                  activeAudioNodes: activeAudioNodesRef.current.length,
                  proofAttemptId,
                },
              });
              activeAudioNodesRef.current.forEach((node) => {
                try {
                  node.stop();
                } catch (e) {}
              });
              cancelBrowserVoiceSpeech();
              activeAudioNodesRef.current = [];
              clearPacedVoiceReveal();
              pacedVoiceTurnRef.current = null;
              if (audioContextRef.current) {
                nextPlayTimeRef.current = audioContextRef.current.currentTime;
              }
              setVoiceCaption(null);
              setVoiceState("listening");
            } else if (msg.type === "AgentStartedSpeaking") {
              clearVoiceStageReturnTimer();
              recordVoiceAgentEvent({
                type: "agent_started_speaking",
                status: "running",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: "Aria started speaking.",
                metadata: {
                  proofAttemptId,
                },
              });
              setVoiceState("speaking");
            } else if (
              msg.type === "AgentFinishedSpeaking" ||
              msg.type === "AgentAudioDone"
            ) {
              const browserSpeechActive =
                usesBrowserVoiceTts &&
                voiceBrokerTtsProviderRef.current === "browser" &&
                Boolean(browserVoiceUtteranceRef.current);
              const brokerAudioActive = activeAudioNodesRef.current.length > 0;
              const pacedDisplayActive = Boolean(pacedVoiceTurnRef.current);
              if (
                !browserSpeechActive &&
                !brokerAudioActive &&
                !pacedDisplayActive
              ) {
                scheduleVoiceStageReturn();
                setVoiceState("listening");
              }
              recordVoiceAgentEvent({
                type: "agent_finished_speaking",
                status: "completed",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: "Aria finished speaking; listening resumed.",
                metadata: {
                  rawType: msg.type,
                  ttsProvider: voiceBrokerTtsProviderRef.current,
                  activeAudioNodes: activeAudioNodesRef.current.length,
                  pacedDisplayActive,
                  proofAttemptId,
                },
              });
            } else if (msg.type === "Error") {
              console.error("Deepgram Error", msg);
              voiceSessionErrorRef.current = compactVoiceEventText(
                String(msg.message || msg.error || "unknown error"),
              );
              recordVoiceAgentEvent({
                type: "error",
                status: "failed",
                sessionId: voiceSessionIdRef.current || undefined,
                summary: `Deepgram voice-agent error: ${voiceSessionErrorRef.current}`,
                metadata: {
                  rawType: msg.type,
                  proofAttemptId,
                },
              });
              stopVoice();
            }
          } catch (e) {
            console.log("Non-JSON message from Deepgram:", event.data);
          }
        } else if (event.data instanceof Blob) {
          // Binary playback can be raw PCM from Deepgram or WAV from the local Miso broker.
          const arrayBuffer = await event.data.arrayBuffer();
          if (audioContextRef.current) {
            const header = new Uint8Array(arrayBuffer.slice(0, 4));
            const isWav =
              header[0] === 0x52 &&
              header[1] === 0x49 &&
              header[2] === 0x46 &&
              header[3] === 0x46;
            let audioBuffer: AudioBuffer;
            if (isWav) {
              audioBuffer =
                await audioContextRef.current.decodeAudioData(arrayBuffer);
            } else {
              const buffer = new Int16Array(arrayBuffer);
              const float32Data = new Float32Array(buffer.length);
              for (let i = 0; i < buffer.length; i++) {
                float32Data[i] = buffer[i] / 0x7fff;
              }
              audioBuffer = audioContextRef.current.createBuffer(
                1,
                float32Data.length,
                48000,
              );
              audioBuffer.copyToChannel(float32Data, 0);
            }

            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(
              outputGainRef.current || audioContextRef.current.destination,
            );

            activeAudioNodesRef.current.push(source);
            source.onended = () => {
              activeAudioNodesRef.current = activeAudioNodesRef.current.filter(
                (n) => n !== source,
              );
              if (
                activeAudioNodesRef.current.length === 0 &&
                !endingRef.current
              ) {
                scheduleVoiceStageReturn();
                setVoiceState("listening");
              }
            };

            if (
              nextPlayTimeRef.current <
              audioContextRef.current.currentTime + 0.05
            ) {
              nextPlayTimeRef.current =
                audioContextRef.current.currentTime + 0.15;
            }

            source.start(nextPlayTimeRef.current);
            nextPlayTimeRef.current += audioBuffer.duration;
          }
        }
      };

      ws.onclose = (event) => {
        if (event.code !== 1000 && event.reason) {
          console.warn("Voice connection closed:", event.reason);
          voiceSessionErrorRef.current = compactVoiceEventText(event.reason);
          recordVoiceAgentEvent({
            type: "error",
            status: "failed",
            sessionId: voiceSessionIdRef.current || undefined,
            summary: `Voice websocket closed: ${voiceSessionErrorRef.current}`,
            metadata: {
              code: event.code,
              proofAttemptId: getVoiceProofAttemptId(),
            },
          });
          window.alert(event.reason);
        }
        stopVoice();
      };

      ws.onerror = (e) => {
        console.error("WS error: ", e);
        voiceSessionErrorRef.current = "Voice websocket could not connect.";
        recordVoiceAgentEvent({
          type: "error",
          status: "failed",
          sessionId: voiceSessionIdRef.current || undefined,
          summary: "Voice websocket could not connect.",
          metadata: {
            proofAttemptId: getVoiceProofAttemptId(),
          },
        });
        window.alert(
          "Voice mode could not connect. Check the voice service keys and try again.",
        );
        stopVoice();
      };
    } catch (err) {
      voiceSessionErrorRef.current = compactVoiceEventText(
        err instanceof Error ? err.message : String(err),
      );
      const voiceStartErrorMessage =
        voiceSessionErrorRef.current || "Voice mode could not start.";
      const isMicPermissionError =
        /notallowed|permission|denied|microphone/i.test(voiceStartErrorMessage);
      if (isMicPermissionError) {
        console.warn("Voice microphone permission blocked", err);
      } else {
        console.error("Voice start error", err);
      }
      recordVoiceAgentEvent({
        type: "error",
        status: "failed",
        sessionId: voiceSessionIdRef.current || undefined,
        summary: `Voice start failed: ${voiceStartErrorMessage}`,
        metadata: {
          proofAttemptId: getVoiceProofAttemptId(),
        },
      });
      stopVoice();
      setMessages((prev) => [
        ...prev,
        {
          id: `voice-start-error-${Date.now()}`,
          role: "assistant",
          content: isMicPermissionError
            ? "**Microphone permission is blocked.** Allow microphone access for this app/browser, then tap the mic again. Voice mode needs that permission before it can send your speech."
            : `**Voice mode could not start.** ${voiceStartErrorMessage}`,
          phase: "complete",
        },
      ]);
    }
  };

  const toggleVoice = () => {
    if (voiceState === "idle") {
      startVoice();
    } else {
      stopVoice();
    }
  };

  const handleVoiceButtonPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    lastVoicePointerDownRef.current = Date.now();
    toggleVoice();
  };

  const handleVoiceButtonClick = () => {
    if (Date.now() - lastVoicePointerDownRef.current < 650) return;
    toggleVoice();
  };

  useEffect(() => {
    return () => {
      stopVoice();
    };
  }, []);

  // Free browser speech is the safety net: server TTS needs a provider key
  // (OpenAI env key or the user's Deepgram key) and the Deepgram Aura voices
  // are English-only, so without this fallback Read Aloud silently did
  // nothing for missing keys and for Japanese/Korean answers.
  const speakWithBrowserTts = (msgId: string, text: string, lang: string) =>
    new Promise<boolean>((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve(false);
        return;
      }
      const requestId = ttsRequestIdRef.current;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voices = window.speechSynthesis.getVoices();
      const voiceMatch =
        voices.find((voice) => voice.lang === lang && voice.localService) ||
        voices.find((voice) => voice.lang === lang) ||
        voices.find((voice) => voice.lang.startsWith(lang.split("-")[0]));
      if (voiceMatch) utterance.voice = voiceMatch;
      utterance.rate = 1.02;
      utterance.onend = () => {
        if (requestId === ttsRequestIdRef.current) setIsPlayingTTS(null);
        resolve(true);
      };
      utterance.onerror = (event) => {
        if (requestId === ttsRequestIdRef.current) setIsPlayingTTS(null);
        resolve(event.error === "canceled" || event.error === "interrupted");
      };
      setIsPlayingTTS(msgId);
      window.speechSynthesis.speak(utterance);
    });

  const detectReadAloudLanguage = (value: string) => {
    if (/[぀-ヿㇰ-ㇿ]/.test(value)) return "ja-JP";
    if (/[가-힯]/.test(value)) return "ko-KR";
    if (/[一-鿿]/.test(value)) {
      return language === "ja" ? "ja-JP" : "zh-CN";
    }
    return "en-US";
  };

  const handleTTS = async (msgId: string, text: string) => {
    if (isPlayingTTS === msgId) {
      stopReadAloud();
      setIsPlayingTTS(null);
      return;
    }

    stopReadAloud();
    const requestId = ttsRequestIdRef.current;
    const controller = new AbortController();
    ttsAbortRef.current = controller;

    try {
      setIsPlayingTTS(msgId);
      // Strip markdown more thoroughly
      const cleanText = text
        .replace(/!\[.*?\]\(.*?\)/g, "")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[*_#~>]/g, "")
        .trim();

      const safeText =
        cleanText.length > 1500
          ? cleanText.substring(0, 1500) + "..."
          : cleanText;
      const speechLang = detectReadAloudLanguage(safeText);
      const activeVoice = ttsVoice || "aura-asteria-en";
      // Deepgram Aura voices are English-only; send Japanese/Korean/Chinese
      // answers straight to the browser's native speech engine instead of
      // getting garbled English-model audio (or a silent failure) back.
      if (speechLang !== "en-US" && /^aura-/i.test(activeVoice)) {
        await speakWithBrowserTts(msgId, safeText, speechLang);
        return;
      }
      const ttsHeaders: Record<string, string> = {};
      if (deepgramApiKey) {
        ttsHeaders["x-deepgram-key"] = deepgramApiKey;
      }
      if (ttsVoice === "miso-tts-8b" && misoTtsApiUrl.trim()) {
        ttsHeaders["x-miso-tts-api-url"] = misoTtsApiUrl.trim();
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...ttsHeaders,
        },
        body: JSON.stringify({
          text: safeText,
          voice: ttsVoice || "aura-asteria-en",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: `TTS failed: ${res.status}` }));
        throw new Error(err.error || `TTS failed: ${res.status}`);
      }

      const usageCost = Number(res.headers.get("X-Usage-Cost") || 0);
      const usageChars = Number(
        res.headers.get("X-Usage-Input-Chars") || safeText.length,
      );
      const usageModel =
        res.headers.get("X-Usage-Model") || ttsVoice || "aura-asteria-en";
      recordVoiceUsage({
        provider: res.headers.get("X-Usage-Provider") || "deepgram",
        ttsModel: usageModel,
        ttsCharacters: usageChars,
        cost: usageCost,
        estimated: res.headers.get("X-Usage-Estimated") === "true",
      });

      const blob = await res.blob();
      if (controller.signal.aborted || requestId !== ttsRequestIdRef.current) {
        return;
      }
      ttsAbortRef.current = null;
      const objectUrl = URL.createObjectURL(blob);
      const audioObj = new Audio(objectUrl);
      ttsObjectUrlRef.current = objectUrl;
      ttsAudioRef.current = audioObj;

      audioObj.onended = () => {
        if (ttsAudioRef.current !== audioObj) return;
        stopReadAloud();
        setIsPlayingTTS(null);
      };

      audioObj.onerror = () => {
        if (ttsAudioRef.current !== audioObj) return;
        stopReadAloud();
        setIsPlayingTTS(null);
      };

      await audioObj.play();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setIsPlayingTTS(null);
        return;
      }
      console.warn(
        "[ChatPanel] Server TTS failed, falling back to browser speech:",
        err,
      );
      if (requestId !== ttsRequestIdRef.current) {
        setIsPlayingTTS(null);
        return;
      }
      const cleanFallback = text
        .replace(/!\[.*?\]\(.*?\)/g, "")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[*_#~>]/g, "")
        .trim()
        .slice(0, 1500);
      const spoke = await speakWithBrowserTts(
        msgId,
        cleanFallback,
        detectReadAloudLanguage(cleanFallback),
      );
      if (!spoke) {
        stopReadAloud();
        setIsPlayingTTS(null);
      }
    }
  };

  const estimateTokens = (value: string) =>
    Math.max(1, Math.ceil(value.length / 4));

  const sendMessage = async (text: string) => {
    if (!text.trim() || sendState !== "idle") return;
    if (activeBetaProofTrafficLocked) {
      alertProofTrafficApprovalNeeded();
      return;
    }

    audio.playClick();
    clearThinkingPauseTimer();
    lastSubmitAtRef.current = Date.now();
    setInteractionMode("submitted");
    setSendState("sending");

    const searchPrefix = isSearchSkillActive
      ? `[SYSTEM: The user has explicitly selected the Web Search skill. You MUST use the web_search tool to answer this query.]\n\n`
      : ``;

    const userMsgContent =
      searchPrefix +
      (selectedTextContext
        ? `Regarding this selected text:\n\n> ${selectedTextContext}\n\n${text.trim()}`
        : text.trim());

    setSelectedTextContext("");
    setInput("");
    setIsSearchSkillActive(false);

    const chatRequestId = createTutorRequestId("chat");
    const chatTaskId = `chat:${chatRequestId}`;
    const newMessages = [
      ...messages,
      {
        id: crypto.randomUUID(),
        requestId: chatRequestId,
        role: "user" as const,
        content: userMsgContent,
      },
    ];
    const assistantMsgId = crypto.randomUUID();
    setMessages([
      ...newMessages,
      {
        id: assistantMsgId,
        requestId: chatRequestId,
        role: "assistant" as const,
        content: "",
        hasFlashcards: false,
        phase: "retrieving" as const,
        reasoningSteps: [
          {
            id: crypto.randomUUID(),
            content: "Retrieving relevant contextual knowledge...",
          },
        ],
        webSearch: { active: false, sources: [] },
        sources: [],
      },
    ]);
    clearStreamingAssistant();
    isAutoScrollPaused.current = false;
    forceScrollToBottom("smooth");
    setIsTyping(true);
    recordLearnerBackgroundTask({
      taskId: chatTaskId,
      requestId: chatRequestId,
      source: "chat_stream",
      taskType: "foreground_chat_completion",
      status: "running",
      inputSummary: userMsgContent.slice(0, 500),
      metadata: {
        userId: activeUserId,
        bookId: canonicalActiveBookId || undefined,
        conversationId: canonicalActiveBookId
          ? chatThreadIdForBook(canonicalActiveBookId)
          : undefined,
        documentId: activeDocumentId || undefined,
        proofAttemptId: activeBetaProofAttemptId || undefined,
        agentLayer: "chat_stream",
        mode: "chat",
      },
    });

    try {
      let currentPageImage = null;
      const needsVision =
        /page|this|image|look|what|read|pdf|diagram|chart|graph|screen|visible|shown|display|see|seeing/i.test(
          userMsgContent,
        );
      if (needsVision) {
        try {
          currentPageImage = captureCurrentPdfPageImage();
        } catch (visionErr) {
          console.warn("Could not extract vision image:", visionErr);
        }
      }

      const hydratedDocuments =
        await hydrateDocumentsForBrainContext(orderedBookDocuments);
      const brainContextPacket = await buildBrainContextPacket({
        userId: activeUserId,
        requestId: chatRequestId,
        proofAttemptId: activeBetaProofAttemptId || undefined,
        mode: "chat",
        agentLayer: "chat_stream",
        query: userMsgContent,
        getRelevantContext:
          brainOrchestrator.getRelevantContext.bind(brainOrchestrator),
        activeBookId: canonicalActiveBookId,
        activeBookTitle: activeLearningBook?.title || activeProject,
        activeProject,
        activeDocumentId,
        documents: hydratedDocuments,
        runtimeSettings: brainRuntimeSettings,
        interaction: {
          mode: interactionMode === "idle" ? "submitted" : interactionMode,
          text,
          selectedTextAttached: Boolean(selectedTextContext),
          webSearchSelected: isSearchSkillActive,
          voiceState,
          sendState: "sending",
          lastInputAt: lastInputAtRef.current,
          lastSubmitAt: lastSubmitAtRef.current,
        },
      });
      const requestMemoryContext = brainContextPacket.context;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                phase: "thinking",
                reasoningSteps: [
                  ...(m.reasoningSteps || []),
                  { id: crypto.randomUUID(), content: "Linking concepts..." },
                ],
              }
            : m,
        ),
      );

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: learnerRequestHeaders(activeUserId, {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(serperApiKey ? { "X-Serper-API-Key": serperApiKey } : {}),
        }),
        body: JSON.stringify({
          messages: flattenChatMessagesForPrompt(newMessages),
          requestId: chatRequestId,
          currentPageImage,
          memoryContext: requestMemoryContext,
          brainContextMetadata: {
            userId: brainContextPacket.userId,
            proofAttemptId: brainContextPacket.proofAttemptId,
            mode: brainContextPacket.mode,
            agentLayer: brainContextPacket.agentLayer,
            activeBookId: brainContextPacket.activeBookId,
            activeBookTitle: brainContextPacket.activeBookTitle,
            activeDocumentId: brainContextPacket.activeDocumentId,
            scope: brainContextPacket.scope,
            documentIds: brainContextPacket.documentIds,
            readyDocumentIds: brainContextPacket.readyDocumentIds,
            contextDocumentIds: brainContextPacket.contextDocumentIds,
            documentCount: brainContextPacket.documentCount,
            readyDocumentCount: brainContextPacket.readyDocumentCount,
            unreadyDocumentCount: brainContextPacket.unreadyDocumentCount,
            omittedReadyDocumentCount:
              brainContextPacket.omittedReadyDocumentCount,
            rawContextChars: brainContextPacket.rawContextChars,
            memoryContextChars: brainContextPacket.memoryContextChars,
            activeBookContextChars: brainContextPacket.activeBookContextChars,
            documentContextChars: brainContextPacket.documentContextChars,
            contextCompacted: brainContextPacket.compacted,
          },
          aiModel,
          customPrompt: systemPrompt,
          runtimeSettings: brainRuntimeSettings,
          webSearchExplicit: isSearchSkillActive,
          activeProject: activeLearningBook?.title || activeProject,
          activeBookId: canonicalActiveBookId,
          activeDocumentId,
          // The page the learner is currently viewing, so the tutor can be told
          // exactly what is on screen rather than always the document's opening.
          currentPage: activeDocumentId ? pdfPage : undefined,
          currentPageTotal: activeDocumentId
            ? pdfTotalPages || undefined
            : undefined,
          documentContexts: orderedBookDocuments.map((document) => ({
            id: document.id,
            title: document.title,
            classification: document.classification,
            extractionMode: document.extractionMode,
          })),
          serperApiKey: serperApiKey || undefined,
          language: language || "en",
        }),
      });

      if (!res.ok) {
        let errorData = { error: "Failed to fetch response" };
        try {
          errorData = await res.json();
        } catch (e) {
          errorData.error = `HTTP Error ${res.status}: ${res.statusText}`;
        }
        throw new Error(errorData.error || "Failed to fetch response");
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                phase: "synthesizing",
                reasoningSteps: [
                  ...(m.reasoningSteps || []),
                  {
                    id: crypto.randomUUID(),
                    content: "Synthesizing final answer...",
                  },
                ],
              }
            : m,
        ),
      );

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream from chat API");

      const decoder = new TextDecoder("utf-8");
      let currentContent = "";
      let buffer = "";
      const liveInputEstimate = estimateTokens(userMsgContent);
      let liveOutputEstimate = 0;
      let messageUsage: NonNullable<Message["usage"]> = {
        provider: "openrouter",
        model: aiModel,
        inputTokens: liveInputEstimate,
        outputTokens: 0,
        cost: 0,
        estimated: true,
      };
      recordChatUsage({
        provider: "openrouter",
        model: aiModel,
        inputTokens: liveInputEstimate,
        outputTokens: 0,
        cost: 0,
        estimated: true,
        requests: 1,
      });
      const mergeSources = (
        current: NormalizedWebSource[] = [],
        incoming: NormalizedWebSource[] = [],
      ) => {
        const byUrl = new Map(current.map((source) => [source.url, source]));
        incoming.forEach((source) => byUrl.set(source.url, source));
        return Array.from(byUrl.values()).slice(0, 10);
      };
      const patchAssistantMessage = (
        patcher: (message: Message) => Message,
      ) => {
        setMessages((prev) => {
          const newM = [...prev];
          const msgIndex = newM.findIndex((m) => m.id === assistantMsgId);
          if (msgIndex !== -1) {
            newM[msgIndex] = patcher(newM[msgIndex]);
          }
          return newM;
        });
      };
      patchAssistantMessage((message) => ({
        ...message,
        usage: messageUsage,
      }));
      const recordWebTelemetry = (
        _name: string,
        _metadata: Record<string, unknown>,
      ) => {};
      const webSearchQueriesById = new Map<string, string>();
      const sourceLedgerContext = {
        messageId: assistantMsgId,
        conversationId: canonicalActiveBookId
          ? chatThreadIdForBook(canonicalActiveBookId)
          : undefined,
        bookId: canonicalActiveBookId || undefined,
      };
      const recordSourceArtifact = (
        source: NormalizedWebSource,
        options: {
          event: string;
          searchId?: string;
          sourceCount?: number;
          error?: unknown;
        },
      ) => {
        const searchId =
          typeof options.searchId === "string" ? options.searchId : undefined;
        void recordWebSourceArtifact({
          webSource: source,
          searchId,
          query: searchId ? webSearchQueriesById.get(searchId) : undefined,
          eventSource: options.event,
          ...sourceLedgerContext,
          metadata: {
            event: options.event,
            sourceCount: options.sourceCount,
            error: options.error,
          },
        });
      };
      const recordUnavailableCitation = (options: {
        event: string;
        searchId?: string;
        sourceCount?: number;
        reason?: unknown;
      }) => {
        const searchId =
          typeof options.searchId === "string" ? options.searchId : undefined;
        void recordUnavailableCitationState({
          searchId,
          query: searchId ? webSearchQueriesById.get(searchId) : undefined,
          reason: options.reason || "No web sources returned.",
          source: options.event,
          metadata: {
            event: options.event,
            sourceCount: options.sourceCount,
          },
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by double newlines (\n\n)
        const events = buffer.split("\n\n");
        // Keep the last (potentially incomplete) chunk in the buffer
        buffer = events.pop() || "";

        for (const event of events) {
          // Each SSE event can have multiple lines; find the 'data:' line
          const lines = event.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const jsonStr = trimmed.slice(5).trim(); // Remove "data:" prefix
            if (!jsonStr) continue;

            let data: any;
            try {
              data = JSON.parse(jsonStr);
            } catch {
              // Incomplete JSON fragment — skip silently
              continue;
            }

            if (data.type === "chunk") {
              currentContent += data.content;
              const nextLiveOutputEstimate = estimateTokens(currentContent);
              const outputDelta = nextLiveOutputEstimate - liveOutputEstimate;
              if (outputDelta > 0) {
                liveOutputEstimate = nextLiveOutputEstimate;
                messageUsage = {
                  ...messageUsage,
                  outputTokens: liveOutputEstimate,
                  estimated: true,
                };
                recordChatUsage({
                  provider: "openrouter",
                  model: aiModel,
                  outputTokens: outputDelta,
                  cost: 0,
                  estimated: true,
                  requests: 0,
                });
              }
              scheduleStreamingAssistant({
                id: assistantMsgId,
                content: currentContent,
                usage: messageUsage,
              });
            } else if (data.type === "web_search_started") {
              if (data.searchId && data.query) {
                webSearchQueriesById.set(
                  String(data.searchId),
                  String(data.query),
                );
              }
              recordWebSearchEvent({
                type: "started",
                searchId: data.searchId,
                query: data.query,
                mode: data.mode,
              });
              recordWebUsage({
                provider: "serper",
                requests: 1,
                searchRequests: data.mode === "news" ? 0 : 1,
                newsRequests: data.mode === "news" ? 1 : 0,
                estimated: true,
              });
              recordWebTelemetry(data.query || "web_search", {
                event: "started",
                searchId: data.searchId,
                mode: data.mode,
              });
              patchAssistantMessage((message) => ({
                ...message,
                phase: "web_search",
                webSearch: {
                  active: true,
                  query: data.query,
                  mode: data.mode,
                  status: "Searching web...",
                  sources: [],
                },
              }));
            } else if (data.type === "web_search_progress") {
              recordWebSearchEvent({
                type: "progress",
                searchId: data.searchId,
                status: data.status,
              });
              recordWebTelemetry(data.searchId || "web_search", {
                event: "progress",
                searchId: data.searchId,
                status: data.status,
              });
              patchAssistantMessage((message) => ({
                ...message,
                phase: "web_search",
                webSearch: {
                  active: true,
                  query: message.webSearch?.query,
                  mode: message.webSearch?.mode,
                  status: data.status,
                  sources: message.webSearch?.sources || [],
                },
              }));
            } else if (data.type === "web_result") {
              const source = data.source as NormalizedWebSource | undefined;
              if (!source) continue;
              recordWebSearchEvent({
                type: "result",
                searchId: data.searchId,
                source,
              });
              cacheWebSources([source]);
              recordSourceArtifact(source, {
                event: "chat_web_result",
                searchId: data.searchId,
              });
              recordWebTelemetry(source.domain || "web_result", {
                event: "result",
                searchId: data.searchId,
                url: source.url,
              });
              patchAssistantMessage((message) => {
                const sources = mergeSources(message.webSearch?.sources || [], [
                  source,
                ]);
                return {
                  ...message,
                  phase: "web_search",
                  webSearch: {
                    active: true,
                    query: message.webSearch?.query,
                    mode: message.webSearch?.mode,
                    status: `Reviewing ${sources.length} source${sources.length === 1 ? "" : "s"}...`,
                    sources,
                  },
                  sources: mergeSources(message.sources || [], [source]),
                };
              });
            } else if (data.type === "web_sources_complete") {
              const sources = (data.sources || []) as NormalizedWebSource[];
              recordWebSearchEvent({
                type: data.error ? "error" : "complete",
                searchId: data.searchId,
                sources,
                status:
                  data.error ||
                  `Reviewed ${sources.length} source${sources.length === 1 ? "" : "s"}`,
              });
              recordWebUsage({
                provider: "serper",
                sourcesReviewed: sources.length,
                failures: data.error ? 1 : 0,
                estimated: true,
              });
              if (sources.length) cacheWebSources(sources);
              sources.forEach((source) =>
                recordSourceArtifact(source, {
                  event: "chat_web_sources_complete",
                  searchId: data.searchId,
                  sourceCount: sources.length,
                  error: data.error,
                }),
              );
              if (!sources.length || data.error) {
                recordUnavailableCitation({
                  event: "chat_web_sources_complete",
                  searchId: data.searchId,
                  sourceCount: sources.length,
                  reason: data.error || "No web sources returned.",
                });
              }
              recordWebTelemetry(data.searchId || "web_search", {
                event: data.error ? "error" : "complete",
                searchId: data.searchId,
                sourceCount: sources.length,
                error: data.error,
              });
              patchAssistantMessage((message) => {
                const mergedSources = mergeSources(
                  message.webSearch?.sources || [],
                  sources,
                );
                return {
                  ...message,
                  webSearch: {
                    active: false,
                    query: message.webSearch?.query,
                    mode: message.webSearch?.mode,
                    status:
                      data.error ||
                      (mergedSources.length
                        ? `Reviewed ${mergedSources.length} sources`
                        : "No web sources returned"),
                    sources: mergedSources,
                    error: data.error,
                  },
                  sources: mergeSources(message.sources || [], mergedSources),
                };
              });
            } else if (data.type === "tool_job") {
              void recordToolJobEvent({
                id: data.id,
                timestamp: data.timestamp,
                toolName: data.toolName,
                status: data.status,
                requestId: data.requestId,
                model: data.model,
                source: data.source || "chat_stream",
                inputSummary: data.inputSummary,
                outputSummary: data.outputSummary,
                error: data.error,
                durationMs: data.durationMs,
                metadata: {
                  ...(data.metadata || {}),
                  proofAttemptId: activeBetaProofAttemptId || undefined,
                },
              });
            } else if (data.type === "model_run") {
              void recordModelRunEvent({
                id: data.id,
                timestamp: data.timestamp,
                status: data.status,
                provider: data.provider,
                source: data.source || "chat_stream",
                requestId: data.requestId,
                requestedModel: data.requestedModel,
                usedModel: data.usedModel,
                inputTokens: data.inputTokens,
                outputTokens: data.outputTokens,
                cost: data.cost,
                estimated: data.estimated,
                durationMs: data.durationMs,
                memoryContextChars: data.memoryContextChars,
                sourceMaterialRequest: data.sourceMaterialRequest,
                requestedWebSearch: data.requestedWebSearch,
                webSources: data.webSources,
                graphUpdates: data.graphUpdates,
                flashcards: data.flashcards,
                iterations: data.iterations,
                error: data.error,
                runtimeSettings: data.runtimeSettings,
                metadata: {
                  ...(data.metadata || {}),
                  proofAttemptId: activeBetaProofAttemptId || undefined,
                },
              });
            } else if (data.type === "done") {
              setSendState("success");
              clearStreamingAssistant();
              const hasFlashcards =
                data.flashcardsUpdates && data.flashcardsUpdates.length > 0;
              const evaluatedAnswerPayloads = Array.isArray(
                data.evaluatedAnswers,
              )
                ? data.evaluatedAnswers
                : [];
              recordLearnerBackgroundTask({
                taskId: chatTaskId,
                requestId: chatRequestId,
                source: "chat_stream",
                taskType: "foreground_chat_completion",
                status: "completed",
                inputSummary: userMsgContent.slice(0, 500),
                outputSummary: String(data.content || "").slice(0, 500),
                metadata: {
                  userId: activeUserId,
                  bookId: canonicalActiveBookId || undefined,
                  conversationId: canonicalActiveBookId
                    ? chatThreadIdForBook(canonicalActiveBookId)
                    : undefined,
                  documentId: activeDocumentId || undefined,
                  proofAttemptId: activeBetaProofAttemptId || undefined,
                  documentIds: brainContextPacket.documentIds,
                  contextDocumentIds: brainContextPacket.contextDocumentIds,
                  graphUpdates: Array.isArray(data.graphUpdates)
                    ? data.graphUpdates.length
                    : 0,
                  flashcards: Array.isArray(data.flashcardsUpdates)
                    ? data.flashcardsUpdates.length
                    : 0,
                  evaluatedAnswers: evaluatedAnswerPayloads.length,
                  agentLayer: "chat_stream",
                  mode: "chat",
                },
              });
              const finalSources = (data.sources ||
                []) as NormalizedWebSource[];
              if (finalSources.length) cacheWebSources(finalSources);
              finalSources.forEach((source) =>
                recordSourceArtifact(source, {
                  event: "chat_done_sources",
                  searchId: data.searchId,
                  sourceCount: finalSources.length,
                }),
              );
              if (data.usage) {
                messageUsage = {
                  provider: data.usage.provider || "openrouter",
                  model:
                    data.usage.usedModel ||
                    data.usage.model ||
                    data.usage.requestedModel ||
                    aiModel,
                  inputTokens: Number(
                    data.usage.inputTokens || messageUsage.inputTokens || 0,
                  ),
                  outputTokens: Number(
                    data.usage.outputTokens || messageUsage.outputTokens || 0,
                  ),
                  cost: Number(data.usage.cost || 0),
                  estimated: Boolean(data.usage.estimated),
                };
                recordChatUsage({
                  provider: data.usage.provider || "openrouter",
                  model:
                    data.usage.usedModel ||
                    data.usage.model ||
                    data.usage.requestedModel ||
                    aiModel,
                  inputTokens:
                    Number(data.usage.inputTokens || 0) - liveInputEstimate,
                  outputTokens:
                    Number(data.usage.outputTokens || 0) - liveOutputEstimate,
                  cost: Number(data.usage.cost || 0),
                  estimated: Boolean(data.usage.estimated),
                  requests: 0,
                });
              } else {
                messageUsage = {
                  ...messageUsage,
                  outputTokens:
                    liveOutputEstimate || estimateTokens(data.content || ""),
                  estimated: true,
                };
              }
              setMessages((prev) => {
                const newM = [...prev];
                const msgIndex = newM.findIndex((m) => m.id === assistantMsgId);
                if (msgIndex !== -1) {
                  newM[msgIndex] = {
                    ...newM[msgIndex],
                    content: data.content,
                    hasFlashcards: hasFlashcards,
                    phase: "complete",
                    reasoningSteps: (newM[msgIndex].reasoningSteps || [])
                      .filter(
                        (step) =>
                          !/synthesizing\s+(final\s+)?answer/i.test(
                            step.content,
                          ),
                      )
                      .concat({
                        id: crypto.randomUUID(),
                        content: "Ready with the final answer.",
                      }),
                    usage: messageUsage,
                    webSearch: newM[msgIndex].webSearch
                      ? {
                          ...newM[msgIndex].webSearch,
                          active: false,
                          status:
                            finalSources.length ||
                            newM[msgIndex].webSearch.sources.length
                              ? `Reviewed ${
                                  mergeSources(
                                    newM[msgIndex].webSearch.sources,
                                    finalSources,
                                  ).length
                                } sources`
                              : newM[msgIndex].webSearch.status,
                          sources: mergeSources(
                            newM[msgIndex].webSearch.sources,
                            finalSources,
                          ),
                        }
                      : undefined,
                    sources: mergeSources(
                      newM[msgIndex].sources || [],
                      finalSources,
                    ),
                  };
                }
                return newM;
              });

              brainOrchestrator.trackInteraction(
                userMsgContent,
                data.content,
                undefined,
                {
                  userId: activeUserId,
                  bookId: canonicalActiveBookId,
                  conversationId: canonicalActiveBookId
                    ? chatThreadIdForBook(canonicalActiveBookId)
                    : undefined,
                  documentId: activeDocumentId,
                  requestId: chatRequestId,
                  proofAttemptId: activeBetaProofAttemptId || undefined,
                  mode: "chat",
                  agentLayer: "chat_stream",
                },
              );
              void brainOrchestrator
                .updateLearningBookFromConversation({
                  userId: activeUserId,
                  userName: learnerName,
                  activeProject,
                  activeBookId: canonicalActiveBookId,
                  activeDocumentId,
                  requestId: chatRequestId,
                  proofAttemptId: activeBetaProofAttemptId || undefined,
                  mode: "chat",
                  agentLayer: "chat_stream",
                  conversationId: canonicalActiveBookId
                    ? chatThreadIdForBook(canonicalActiveBookId)
                    : undefined,
                  documentContexts: orderedBookDocuments,
                  userMessage: userMsgContent,
                  assistantMessage: data.content,
                  apiKey,
                })
                .catch((error) => {
                  console.warn(
                    "[ChatPanel] Learning book update failed:",
                    error,
                  );
                });
              setChatArchives(
                archiveChatSnapshot(
                  useStore.getState().messages,
                  canonicalActiveBookId || null,
                  activeLearningBook?.title || activeProject,
                ),
              );

              if (data.graphUpdates && data.graphUpdates.length > 0) {
                data.graphUpdates.forEach((update: any) => {
                  brainOrchestrator.addOrUpdateConcept(
                    update.name,
                    update.description,
                    update.understandingDelta,
                    undefined,
                    {
                      userId: activeUserId,
                      requestId: chatRequestId,
                      proofAttemptId: activeBetaProofAttemptId || undefined,
                      mode: "chat",
                      agentLayer: "chat_stream",
                      bookId: canonicalActiveBookId,
                      conversationId: canonicalActiveBookId
                        ? chatThreadIdForBook(canonicalActiveBookId)
                        : undefined,
                      documentId: activeDocumentId,
                      source: "chat_graph_update",
                    },
                  );
                });
              }

              if (evaluatedAnswerPayloads.length > 0) {
                void recordEvaluatedAnswerEvidenceBatch(
                  evaluatedAnswerPayloads,
                  {
                    userId: activeUserId,
                    bookId: canonicalActiveBookId || undefined,
                    bookTitle:
                      activeLearningBook?.title || activeProject || undefined,
                    conversationId: canonicalActiveBookId
                      ? chatThreadIdForBook(canonicalActiveBookId)
                      : undefined,
                    requestId: chatRequestId,
                    source: "chat_tool_evaluate_answer",
                    evaluator: "model_rubric",
                    metadata: {
                      userId: activeUserId,
                      agentLayer: "chat_stream",
                      mode: "chat",
                      proofAttemptId: activeBetaProofAttemptId || undefined,
                      activeDocumentId: activeDocumentId || undefined,
                      sourceUserMessage: userMsgContent.slice(0, 240),
                      runtimeSettings: brainRuntimeSettings,
                    },
                  },
                ).catch((error) => {
                  console.warn(
                    "[ChatPanel] Evaluated answer evidence failed:",
                    error,
                  );
                });
              }

              if (data.flashcardsUpdates && data.flashcardsUpdates.length > 0) {
                const flashcardBatchId = `${assistantMsgId}:stream-flashcards`;
                void Promise.all(
                  data.flashcardsUpdates.map(async (card: any) => {
                    const { flashcard } = await createFlashcardForStorage(
                      card,
                      {
                        id: Math.random().toString(36).substring(2, 15),
                        bookId: canonicalActiveBookId || undefined,
                        bookTitle:
                          activeLearningBook?.title ||
                          activeProject ||
                          undefined,
                      },
                    );
                    await db.flashcards.add(flashcard);
                    return flashcard;
                  }),
                )
                  .then((storedFlashcards) =>
                    recordGeneratedFlashcardsArtifact({
                      batchId: flashcardBatchId,
                      cards: storedFlashcards,
                      source: "chat_tool_flashcard_generation",
                      sourceMessageId: assistantMsgId,
                      messageId: assistantMsgId,
                      conversationId: canonicalActiveBookId
                        ? chatThreadIdForBook(canonicalActiveBookId)
                        : undefined,
                      bookId: canonicalActiveBookId || undefined,
                      bookTitle:
                        activeLearningBook?.title || activeProject || undefined,
                      metadata: {
                        generationPath: "chat_stream_done",
                        sourceUserMessage: userMsgContent.slice(0, 240),
                      },
                    }),
                  )
                  .catch(console.error);
              }
            } else if (data.type === "status") {
              setMessages((prev) => {
                const newM = [...prev];
                const msgIndex = newM.findIndex((m) => m.id === assistantMsgId);
                if (msgIndex !== -1) {
                  newM[msgIndex] = { ...newM[msgIndex], phase: data.phase };
                }
                return newM;
              });
            } else if (data.type === "reasoning_summary") {
              setMessages((prev) => {
                const newM = [...prev];
                const msgIndex = newM.findIndex((m) => m.id === assistantMsgId);
                if (msgIndex !== -1) {
                  const currentSteps = newM[msgIndex].reasoningSteps || [];
                  newM[msgIndex] = {
                    ...newM[msgIndex],
                    reasoningSteps: [
                      ...currentSteps,
                      { id: crypto.randomUUID(), content: data.content },
                    ],
                  };
                }
                return newM;
              });
            } else if (data.type === "info") {
              currentContent += `> Note: ${data.message}\n\n`;
              setMessages((prev) => {
                const newM = [...prev];
                const msgIndex = newM.findIndex((m) => m.id === assistantMsgId);
                if (msgIndex !== -1) {
                  newM[msgIndex] = {
                    ...newM[msgIndex],
                    content: currentContent,
                  };
                }
                return newM;
              });
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          }
        }
      }

      setSendState("idle");
      setInteractionMode("idle");
    } catch (err: any) {
      console.error(err);
      recordLearnerBackgroundTask({
        taskId: chatTaskId,
        requestId: chatRequestId,
        source: "chat_stream",
        taskType: "foreground_chat_completion",
        status: "failed",
        inputSummary: userMsgContent.slice(0, 500),
        error: err?.message || "Chat request failed",
        metadata: {
          userId: activeUserId,
          bookId: canonicalActiveBookId || undefined,
          conversationId: canonicalActiveBookId
            ? chatThreadIdForBook(canonicalActiveBookId)
            : undefined,
          documentId: activeDocumentId || undefined,
          proofAttemptId: activeBetaProofAttemptId || undefined,
          agentLayer: "chat_stream",
          mode: "chat",
        },
      });
      clearStreamingAssistant();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `**Error:** ${err.message}`, phase: "complete" }
            : m,
        ),
      );
      setSendState("idle");
      setInteractionMode(input.trim() ? "composing" : "idle");
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    if (hasLoadedVoiceProofScript && voiceState === "idle") {
      if (activeBetaProofTrafficLocked) {
        alertProofTrafficApprovalNeeded();
        textareaRef.current?.focus();
        return;
      }
      pendingVoiceProofScriptRef.current = input.trim();
      startVoice();
      textareaRef.current?.focus();
      return;
    }
    const currentInput = input;
    handleInputChange("");
    if (
      voiceState !== "idle" &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      sendVoiceText(currentInput);
      return;
    }
    sendMessage(currentInput);
  };

  useEffect(() => {
    if (askTutorQuery) {
      setInput((prev) =>
        prev ? prev + "\n\n" + askTutorQuery : askTutorQuery,
      );
      const focusTextarea = () => textareaRef.current?.focus();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(focusTextarea);
      } else {
        setTimeout(focusTextarea, 0);
      }
      lastInputAtRef.current = Date.now();
      setInteractionMode("composing");
      setAskTutorQuery("");
    }
  }, [askTutorQuery, setAskTutorQuery]);

  // When selectedTextContext changes (from PDF "Ask Tutor" button), auto-focus input
  useEffect(() => {
    if (selectedTextContext) {
      handleInputChange("");
    }
  }, [handleInputChange, selectedTextContext]);

  const lastMessage = displayMessages[displayMessages.length - 1];
  const lastAutoScrolledMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastMessage) return;
    const isNewMessage =
      lastMessage.id !== lastAutoScrolledMessageIdRef.current;
    if (isNewMessage) {
      lastAutoScrolledMessageIdRef.current = lastMessage.id;
      isAutoScrollPaused.current = false;
      forceScrollToBottom("smooth");
      return;
    }
    if (sendState !== "idle" && !isAutoScrollPaused.current) {
      forceScrollToBottom("auto");
    }
  }, [
    forceScrollToBottom,
    lastMessage?.id,
    lastMessage?.phase,
    lastMessage?.role,
    sendState,
  ]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    // Track manual scrolling to pause auto-scroll
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      isAutoScrollPaused.current = !isNearBottom;
    };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });

    let scrollFrame: number | null = null;
    // Use ResizeObserver to detect content height changes (like streaming text)
    const resizeObserver = new ResizeObserver(() => {
      if ((isAutoScrollPaused.current && sendState === "idle") || scrollFrame) {
        return;
      }
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior: "auto",
        });
      });
    });

    const activeBubble = lastMessage
      ? scrollEl.querySelector(`[data-message-id="${lastMessage.id}"]`)
      : null;
    resizeObserver.observe((activeBubble as Element | null) || scrollEl);

    return () => {
      scrollEl.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
    };
  }, [lastMessage?.id, sendState]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative z-10 w-full overflow-hidden">
      {/* Dynamic Header */}
      <div
        data-tutor-chat-header
        className="absolute top-0 z-40 flex w-full shrink-0 items-center justify-between border-b border-zinc-200/70 bg-[rgba(253,253,253,0.98)] px-3 py-3 pt-4 shadow-[0_12px_36px_rgba(255,255,255,0.92)] backdrop-blur-xl pointer-events-none sm:px-6 sm:py-4 sm:pt-6"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 pointer-events-auto sm:gap-4">
          <div className="hidden items-center gap-3 sm:flex">
            <div className="w-8 h-8 rounded-[10px] shadow-[0_2px_10px_rgba(0,0,0,0.08)] bg-white border border-black/5 flex items-center justify-center">
              <Sparkles size={14} className="text-zinc-600" />
            </div>
            <span className="text-[15px] font-semibold text-zinc-800">
              Tutor
            </span>
          </div>

          <div className="hidden h-4 w-px bg-black/10 sm:block" />

          {/* Context/Project Pill — the dropdown anchors to the header itself
              so it can span the same width as the chat bar below. */}
          <div className="min-w-0 flex-1 sm:flex-initial">
            <button
              type="button"
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
              className="group flex max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 font-medium text-zinc-800 shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
            >
              <Folder
                size={12}
                className="text-zinc-600 group-hover:text-zinc-800 transition-colors"
              />
              <AnimatePresence mode="popLayout">
                <gsapMotion.span
                  key={activeLearningBook?.id || activeProject}
                  initial={animationsEnabled ? { opacity: 0, y: 5 } : undefined}
                  animate={animationsEnabled ? { opacity: 1, y: 0 } : undefined}
                  exit={animationsEnabled ? { opacity: 0, y: -5 } : undefined}
                  className="inline-block min-w-0 truncate whitespace-nowrap text-xs font-medium"
                >
                  {activeLearningBook?.title || activeProject}
                </gsapMotion.span>
              </AnimatePresence>
              <ChevronDown size={12} className="text-zinc-500" />
            </button>

            <AnimatePresence>
              {isProjectDropdownOpen && (
                <gsapMotion.div
                  initial={{ opacity: 0, y: -5, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -5, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-auto absolute inset-x-3 top-full z-50 mx-auto mt-2 max-w-3xl origin-top overflow-y-auto rounded-[28px] border border-black/10 bg-white p-2 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.35)] max-h-[min(62dvh,540px)] custom-scroll sm:inset-x-6"
                >
                  <div className="px-3 py-2 border-b border-black/5 mb-1">
                    <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Library Context (Press Enter to Rename)
                    </span>
                  </div>
                  <div className="px-2 py-1.5 mb-1 bg-black/5 rounded-lg">
                    <input
                      type="text"
                      placeholder="Rename current book..."
                      className="w-full bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none"
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          e.currentTarget.value.trim() !== ""
                        ) {
                          const nextTitle = e.currentTarget.value.trim();
                          void brainOrchestrator
                            .updateLearningBookTitle(
                              canonicalActiveBookId || GENERAL_STUDY_BOOK_ID,
                              nextTitle,
                              learnerName,
                              "chat",
                            )
                            .then((book) => {
                              setActiveLearningBookId(book.id);
                              setActiveProject(book.title);
                            })
                            .catch((error) => {
                              console.warn(
                                "[ChatPanel] Active book rename failed:",
                                error,
                              );
                              setActiveProject(nextTitle);
                            });
                          setIsProjectDropdownOpen(false);
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {libraryContextBooks.length === 0 && (
                      <div className="px-3 py-3 text-[12px] leading-relaxed text-zinc-500">
                        Library book will appear when this session initializes.
                      </div>
                    )}
                    {libraryContextBooks.map((book) => (
                      <button
                        key={book.id}
                        onClick={() => {
                          saveCurrentChatArchive();
                          setActiveLearningBookId(book.id);
                          setActiveProject(book.title);
                          setIsProjectDropdownOpen(false);
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-colors text-left focus:outline-none ${
                          canonicalActiveBookId === book.id
                            ? "bg-black/5 text-zinc-800"
                            : "text-zinc-500 hover:bg-black/5 hover:text-zinc-700"
                        }`}
                      >
                        <Folder size={14} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {book.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                            {book.conversationCount} chats ·{" "}
                            {book.chapters?.length || 0} chapters
                          </span>
                        </span>
                        {canonicalActiveBookId === book.id && (
                          <Check size={14} className="ml-auto text-zinc-800" />
                        )}
                      </button>
                    ))}
                  </div>
                  {visibleChatArchives.length > 0 && (
                    <>
                      <div className="mt-2 px-3 py-2 border-t border-black/5">
                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                          Previous Chats
                        </span>
                      </div>
                      <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto pr-1 custom-scroll">
                        {visibleChatArchives.map((archive) => (
                          <button
                            key={archive.id}
                            type="button"
                            onClick={() => {
                              saveCurrentChatArchive();
                              setMessages(archive.messages);
                              if (archive.bookId) {
                                if (
                                  isGenericLibraryTitle(archive.bookTitle) &&
                                  archive.title.trim()
                                ) {
                                  void db.learningBooks
                                    .update(archive.bookId, {
                                      title: archive.title,
                                      updatedAt: Date.now(),
                                    })
                                    .catch((error) =>
                                      console.warn(
                                        "[ChatPanel] Archived book title sync failed:",
                                        error,
                                      ),
                                    );
                                }
                                setActiveLearningBookId(archive.bookId);
                              } else {
                                setActiveLearningBookId(null);
                              }
                              setActiveProject(
                                archive.bookTitle &&
                                  archive.bookTitle !== "General Study"
                                  ? archive.bookTitle
                                  : archive.title,
                              );
                              setIsProjectDropdownOpen(false);
                              requestAnimationFrame(() =>
                                forceScrollToBottom("auto"),
                              );
                            }}
                            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 focus:outline-none"
                          >
                            <Clock size={14} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">
                                {archive.title}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em] text-zinc-400">
                                {archive.bookTitle}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </gsapMotion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex shrink-0 gap-1 pointer-events-auto sm:gap-2">
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label={
                isFullscreen
                  ? "Exit fullscreen tutor chat"
                  : "Open fullscreen tutor chat"
              }
              title={
                isFullscreen
                  ? "Exit fullscreen tutor chat"
                  : "Open fullscreen tutor chat"
              }
              className="rounded-full p-1.5 text-[#9a9a9f] transition-colors hover:bg-black/5 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Are you sure you want to clear the chat history?",
                )
              ) {
                saveCurrentChatArchive();
                setMessages([
                  {
                    id: "1",
                    role: "assistant",
                    content: INITIAL_MESSAGE,
                  },
                ]);
              }
            }}
            title="Clear Chat History"
            className="rounded-full p-1.5 text-[#9a9a9f] transition-colors hover:bg-black/5 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
          >
            <RotateCcw size={15} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tutor chat"
              title="Close tutor chat"
              className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
            >
              <Minus size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Chat Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 sm:px-6 pt-[112px] py-4 pb-52 space-y-8 custom-scroll"
        ref={scrollRef}
      >
        <AnimatePresence initial={false}>
          {displayMessages.map((msg, index) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              sendState={sendState}
              isLast={index === displayMessages.length - 1}
              animationsEnabled={animationsEnabled}
              isPlayingTTS={isPlayingTTS}
              ttsVoice={ttsVoice}
              onSendMessage={sendMessage}
              onHandleTTS={handleTTS}
              onSetActiveView={setActiveView}
              setMessages={setMessages}
              apiKey={apiKey}
              activeBookId={canonicalActiveBookId || null}
              activeBookTitle={activeLearningBook?.title || activeProject}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <div className="absolute bottom-0 w-full p-4 shrink-0 bg-gradient-to-t from-[#fdfdfd] via-[#fdfdfd]/90 to-transparent z-40">
        <AnimatePresence>
          {activeBetaProofAttemptId && (
            <gsapMotion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="w-full max-w-3xl mx-auto mb-2"
            >
              <div className="rounded-2xl border border-cyan-300/25 bg-[#101014]/95 px-3 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-xl">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">
                      <Brain size={12} />
                      Live proof capture
                    </div>
                    <p className="mt-1 truncate text-[11px] leading-relaxed text-zinc-300">
                      Chat and voice rows will save under attempt{" "}
                      <span className="font-mono text-zinc-100">
                        {activeBetaProofAttemptId}
                      </span>{" "}
                      for {activeLearningBookTitle || activeProject}.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        readyProofDocuments.length >= 2
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-400/10 text-amber-200"
                      }`}
                    >
                      Ready PDFs {readyProofDocuments.length}
                    </span>
                    <span className="rounded-full border border-blue-300/25 bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200">
                      Chat capture on
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        isActiveProofTrafficApproved
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-400/10 text-amber-200"
                      }`}
                    >
                      {isActiveProofTrafficApproved
                        ? "Provider traffic approved"
                        : hasPendingProofTrafficApproval
                          ? "Approval ledger pending"
                          : "Approve traffic in Admin"}
                    </span>
                    {hasLoadedProofPrompt && (
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200">
                        Proof prompt loaded
                      </span>
                    )}
                    {hasLoadedVoiceProofScript && (
                      <span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-200">
                        Voice script loaded
                      </span>
                    )}
                    {hasLoadedVoiceProofScript && voiceState === "idle" && (
                      <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200">
                        Start voice first
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        voiceState !== "idle"
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                          : "border-violet-300/25 bg-violet-400/10 text-violet-200"
                      }`}
                    >
                      {voiceState !== "idle"
                        ? "Voice live"
                        : "Voice capture ready"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        hasOpenRouterRuntimeKey
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-400/10 text-amber-200"
                      }`}
                    >
                      {hasOpenRouterRuntimeKey
                        ? apiKey.trim()
                          ? "OpenRouter key set"
                          : "OpenRouter server fallback"
                        : "OpenRouter key missing"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                        hasDeepgramRuntimeKey
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
                          : "border-amber-300/30 bg-amber-400/10 text-amber-200"
                      }`}
                    >
                      {hasDeepgramRuntimeKey
                        ? deepgramApiKey.trim()
                          ? "Deepgram key set"
                          : "Deepgram server fallback"
                        : "Deepgram key missing"}
                    </span>
                  </div>
                </div>
              </div>
            </gsapMotion.div>
          )}
        </AnimatePresence>

        {/* Selected Text Context Chip */}
        <AnimatePresence>
          {selectedTextContext && (
            <gsapMotion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 450, damping: 28 }}
              className="w-full max-w-3xl mx-auto mb-2"
            >
              <div
                className="relative flex items-start gap-3 p-3 rounded-2xl overflow-hidden"
                style={{
                  background: "rgba(18, 18, 20, 0.95)",
                  backdropFilter: "blur(20px)",
                }}
              >
                {/* Animated conic-gradient border — same as FloatingSkillsMenu action bar */}
                <div
                  className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden"
                  style={{
                    padding: "1px",
                    WebkitMask:
                      "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                  }}
                >
                  <gsapMotion.div
                    animate={
                      animationsEnabled ? { rotate: 360 } : { rotate: 0 }
                    }
                    transition={{
                      repeat: animationsEnabled ? Infinity : 0,
                      duration: animationsEnabled ? 5 : 0,
                      ease: "linear",
                    }}
                    className="absolute inset-[-50%] w-[200%] h-[200%]"
                    style={{
                      background:
                        "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.05) 60%, transparent 100%)",
                    }}
                  />
                </div>

                {/* Left icon */}
                <div className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-white/10 mt-0.5">
                  <Sparkles size={11} className="text-zinc-300" />
                </div>

                {/* Label + text */}
                <div className="flex-1 min-w-0 pr-1">
                  <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.15em] mb-0.5">
                    From PDF Selection
                  </div>
                  <p className="max-h-24 overflow-y-auto pr-2 text-[12px] text-zinc-200 leading-snug whitespace-pre-wrap break-words font-medium custom-scrollbar">
                    "{selectedTextContext}"
                  </p>
                </div>

                {/* Dismiss */}
                <button
                  type="button"
                  aria-label="Clear selected PDF context"
                  onClick={() => setSelectedTextContext("")}
                  className="shrink-0 p-1.5 rounded-full text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors focus:outline-none mt-0.5"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            </gsapMotion.div>
          )}
        </AnimatePresence>

        <div className="relative mx-auto mb-2 flex w-full max-w-3xl items-end overflow-visible rounded-[32px] bg-[#18181b] shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-[height,min-height] duration-200 ease-out">
          {/* Menu Trigger Button */}
          <div className="relative flex items-center justify-center shrink-0 z-50 ml-2 mb-2 rounded-full h-[48px] w-[48px] p-[2px]">
            <gsapMotion.button
              onClick={() => setIsSkillsMenuOpen(!isSkillsMenuOpen)}
              className="relative flex items-center justify-center w-full h-full rounded-full group focus:outline-none shrink-0"
              aria-label="Open tutor tools"
              whileHover="hover"
              whileTap="tap"
              initial="idle"
              animate={isSkillsMenuOpen ? "hover" : "idle"}
              variants={{
                idle: { scale: 1, opacity: 0.8 },
                hover: { scale: 1.02, opacity: 1 },
                tap: { scale: 0.95 },
              }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <div className="absolute inset-[-1.5px] rounded-full bg-[#000000] shadow-[0_4px_16px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.05)]" />
              <div className="absolute inset-[0.5px] rounded-full overflow-hidden">
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-gradient-to-b from-[#333] to-[#111]" />
                  <div
                    className="absolute inset-0 mix-blend-overlay opacity-[0.35] pointer-events-none"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at center, rgba(255,255,255,0.8) 1px, transparent 1px)",
                      backgroundSize: "4px 4px",
                    }}
                  />
                  <div className="absolute inset-0 rounded-full shadow-[inset_0_0_2px_1px_rgba(255,255,255,0.3)] pointer-events-none mix-blend-screen" />
                </div>
              </div>
              <gsapMotion.div
                className="absolute z-10 flex items-center justify-center rounded-full group-hover:brightness-110 overflow-hidden"
                variants={{
                  idle: {
                    inset: "3.5px",
                    boxShadow:
                      "inset 0 1px 1px rgba(255,255,255,0.1), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                    borderRadius: "50%",
                  },
                  hover: {
                    inset: "3.5px",
                    boxShadow:
                      "inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                    borderRadius: "50%",
                  },
                  tap: {
                    inset: "4.5px",
                    boxShadow:
                      "inset 0 3px 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                    borderRadius: "50%",
                  },
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{
                  background:
                    "linear-gradient(180deg, #262626 0%, #1a1a1a 45%, #080808 100%)",
                }}
              >
                <gsapMotion.div
                  className="absolute z-20 flex items-center justify-center"
                  animate={{ rotate: isSkillsMenuOpen ? 45 : 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  <Plus
                    size={18}
                    className={
                      isSkillsMenuOpen
                        ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]"
                        : "text-zinc-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
                    }
                    strokeWidth={isSkillsMenuOpen ? 3 : 2.5}
                    style={{
                      filter: isSkillsMenuOpen
                        ? "drop-shadow(0 0 4px rgba(255,255,255,0.4))"
                        : "drop-shadow(0 1px 3px rgba(0,0,0,0.9))",
                    }}
                  />
                </gsapMotion.div>
              </gsapMotion.div>
              <gsapMotion.div
                className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center"
                animate={{ rotate: isSkillsMenuOpen ? 45 : 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <span className="absolute h-7 w-7 rounded-full bg-black/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.16),0_2px_8px_rgba(0,0,0,0.55)]" />
                <Plus
                  size={19}
                  className="relative z-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.52)]"
                  strokeWidth={isSkillsMenuOpen ? 3 : 2.65}
                  aria-hidden="true"
                />
              </gsapMotion.div>
            </gsapMotion.button>
            <FloatingSkillsMenu
              isOpen={isSkillsMenuOpen}
              onClose={() => setIsSkillsMenuOpen(false)}
              onSelectSkill={(skill) => {
                if (skill === "Search") setIsSearchSkillActive(true);
              }}
            />
          </div>

          <div className="relative flex min-h-[60px] flex-1 items-end justify-center">
            {isSearchSkillActive && (
              <div className="absolute top-2 left-4 flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-md text-[10px] font-bold uppercase tracking-wider z-20">
                <Search size={10} strokeWidth={3} /> Web Search
                <button
                  type="button"
                  aria-label="Remove web search tool"
                  onClick={() => setIsSearchSkillActive(false)}
                  className="ml-1 hover:text-white transition-colors"
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </div>
            )}
            <gsapMotion.textarea
              key="text-input"
              ref={textareaRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
              transition={{ duration: 0.2 }}
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                handleInputChange(e.target.value)
              }
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                voiceState !== "idle"
                  ? "Type to talk to Aria..."
                  : isSearchSkillActive
                    ? "Search the web..."
                    : "Ask..."
              }
              aria-label="Ask tutor question"
              className={`custom-scroll z-10 w-full resize-none border-none bg-transparent px-4 text-[15px] leading-[1.42] text-zinc-100 outline-none transition-[height] duration-200 ease-out caret-white placeholder:text-zinc-500 ${isSearchSkillActive ? "pt-8 pb-3" : "py-[18px]"}`}
              rows={1}
            />
          </div>
          <div className="relative flex items-center gap-2 shrink-0 z-50 mr-2 mb-2">
            <div className="relative flex items-center justify-center shrink-0 rounded-full h-[48px] w-[48px] p-[2px]">
              <gsapMotion.button
                type="button"
                className="relative flex items-center justify-center w-full h-full rounded-full group focus:outline-none shrink-0"
                onPointerDown={handleVoiceButtonPointerDown}
                onClick={handleVoiceButtonClick}
                aria-label={
                  voiceState === "idle" ? "Start voice input" : "Voice input"
                }
                whileHover="hover"
                whileTap="tap"
                animate={voiceState === "idle" ? "idle" : "sending"}
                variants={{
                  idle: { scale: 1, opacity: 0.8 },
                  hover: { scale: 1.02, opacity: 1 },
                  tap: { scale: 0.95 },
                  sending: { scale: 0.95, borderRadius: "50%" },
                }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <div className="absolute inset-[-1.5px] rounded-full bg-[#000000] shadow-[0_4px_16px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.05)]" />

                <div className="absolute inset-[0.5px] rounded-full overflow-hidden">
                  <div className="absolute inset-0">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#333] to-[#111]" />
                    {voiceState !== "idle" && (
                      <SiriLiquidGlass
                        isActive={true}
                        isHovered={true}
                        isValid={true}
                      />
                    )}
                    <div
                      className="absolute inset-0 mix-blend-overlay opacity-[0.35] pointer-events-none"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle at center, rgba(255,255,255,0.8) 1px, transparent 1px)",
                        backgroundSize: "4px 4px",
                      }}
                    />
                    <div className="absolute inset-0 rounded-full shadow-[inset_0_0_2px_1px_rgba(255,255,255,0.3)] pointer-events-none mix-blend-screen" />
                  </div>
                </div>

                <gsapMotion.div
                  className="absolute z-10 flex items-center justify-center rounded-full group-hover:brightness-110 overflow-hidden"
                  variants={{
                    idle: {
                      inset: "3.5px",
                      boxShadow:
                        "inset 0 1px 1px rgba(255,255,255,0.1), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    hover: {
                      inset: "3.5px",
                      boxShadow:
                        "inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    tap: {
                      inset: "4.5px",
                      boxShadow:
                        "inset 0 3px 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    sending: { inset: "4.5px", borderRadius: "50%" },
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  style={{
                    background:
                      "linear-gradient(180deg, #262626 0%, #1a1a1a 45%, #080808 100%)",
                  }}
                >
                  <gsapMotion.div className="absolute z-20 flex items-center justify-center">
                    {voiceState === "idle" ? (
                      <Mic
                        size={18}
                        className="text-zinc-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
                      />
                    ) : voiceState === "listening" ? (
                      <div className="relative flex items-center justify-center">
                        <div className="absolute inset-0 rounded-full border border-emerald-400 animate-ping opacity-50" />
                        <div className="absolute inset-[-4px] rounded-full bg-emerald-500/20 blur animate-pulse" />
                        <Mic
                          size={18}
                          className="relative z-10 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                        />
                      </div>
                    ) : (
                      <div className="relative flex items-center justify-center">
                        <div className="absolute inset-[-4px] rounded-full bg-blue-500/20 blur animate-pulse" />
                        <Activity
                          size={18}
                          className="relative z-10 animate-pulse text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.8)]"
                        />
                      </div>
                    )}
                  </gsapMotion.div>
                </gsapMotion.div>
                <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center">
                  <span className="absolute h-7 w-7 rounded-full bg-black/35 shadow-[inset_0_1px_1px_rgba(255,255,255,0.14),0_2px_8px_rgba(0,0,0,0.55)]" />
                  {voiceState === "idle" ? (
                    <Mic
                      size={19}
                      className="relative z-10 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.52)]"
                      aria-hidden="true"
                    />
                  ) : voiceState === "listening" ? (
                    <Mic
                      size={19}
                      className="relative z-10 text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.9)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <Activity
                      size={19}
                      className="relative z-10 text-blue-300 drop-shadow-[0_0_10px_rgba(96,165,250,0.85)]"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </gsapMotion.button>
            </div>

            <div className="relative flex items-center justify-center shrink-0 z-50 rounded-full h-[48px] w-[48px] p-[2px]">
              <gsapMotion.button
                className="relative flex items-center justify-center w-full h-full rounded-full group focus:outline-none shrink-0"
                aria-label="Send message"
                onMouseEnter={() => {
                  setIsHovered(true);
                  if (isActive) audio.playHover();
                }}
                onMouseLeave={() => setIsHovered(false)}
                onClick={handleSend}
                whileHover="hover"
                whileTap="tap"
                animate={sendState}
                variants={{
                  idle: { scale: 1, opacity: isActive ? 1 : 0.78 },
                  hover: { scale: 1.02, opacity: 1 },
                  tap: { scale: 0.95 },
                  sending: { scale: 0.95, borderRadius: "50%" },
                  success: {
                    scale: 1,
                    transition: { type: "spring", stiffness: 500, damping: 12 },
                    borderRadius: "50%",
                  },
                }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <AnimatePresence>
                  {sendState === "sending" && (
                    <gsapMotion.div
                      initial={{ scale: 0.8, opacity: 0.6, borderWidth: "2px" }}
                      animate={{ scale: 2.2, opacity: 0, borderWidth: "0px" }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="absolute inset-0 rounded-full border border-[rgba(255,255,255,0.8)] pointer-events-none z-0 mix-blend-screen"
                    />
                  )}
                </AnimatePresence>

                <div className="absolute inset-[-1.5px] rounded-full bg-[#000000] shadow-[0_4px_16px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.05)]" />

                <div className="absolute inset-[0.5px] rounded-full overflow-hidden">
                  <div className="absolute inset-0">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#333] to-[#111]" />
                    {isActive && (
                      <SiriLiquidGlass
                        isActive={isActive}
                        isHovered={isHovered}
                        isValid={isValid}
                      />
                    )}
                    <div
                      className="absolute inset-0 mix-blend-overlay opacity-[0.35] pointer-events-none"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle at center, rgba(255,255,255,0.8) 1px, transparent 1px)",
                        backgroundSize: "4px 4px",
                      }}
                    />
                    <div className="absolute inset-0 rounded-full shadow-[inset_0_0_2px_1px_rgba(255,255,255,0.3)] pointer-events-none mix-blend-screen" />
                  </div>
                </div>
                {sendState === "idle" && (
                  <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center">
                    <span className="absolute h-7 w-7 rounded-full bg-black/35 shadow-[inset_0_1px_1px_rgba(255,255,255,0.14),0_2px_8px_rgba(0,0,0,0.55)]" />
                    <ArrowUp
                      className={`h-[19px] w-[19px] ${
                        isActive && isValid ? "text-white" : "text-zinc-200"
                      } relative z-10 drop-shadow-[0_0_8px_rgba(255,255,255,0.52)]`}
                      stroke="currentColor"
                      strokeWidth={2.75}
                      aria-hidden="true"
                    />
                  </div>
                )}

                <gsapMotion.div
                  className="absolute z-10 flex items-center justify-center rounded-full group-hover:brightness-110 overflow-hidden"
                  variants={{
                    idle: {
                      inset: "3.5px",
                      boxShadow:
                        "inset 0 1px 1px rgba(255,255,255,0.1), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    hover: {
                      inset: "3.5px",
                      boxShadow:
                        "inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -2px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    tap: {
                      inset: "4.5px",
                      boxShadow:
                        "inset 0 3px 8px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,0,0,0.9)",
                      borderRadius: "50%",
                    },
                    sending: { inset: "4.5px", borderRadius: "50%" },
                    success: { inset: "3.5px", borderRadius: "50%" },
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  style={{
                    background:
                      "linear-gradient(180deg, #262626 0%, #1a1a1a 45%, #080808 100%)",
                  }}
                >
                  <gsapMotion.div
                    variants={{
                      idle: { y: 0, opacity: 1, scale: 1 },
                      hover: { y: 0, opacity: 1, scale: 1 },
                      tap: { y: 2, opacity: 1, scale: 0.9 },
                      sending: { y: -30, opacity: 0, scale: 0.5 },
                      success: { y: 30, opacity: 0, scale: 0.5 },
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className={
                      sendState === "idle"
                        ? "absolute z-20 flex items-center justify-center"
                        : "hidden"
                    }
                  >
                    <ArrowUp
                      className={`h-[18px] w-[18px] transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-300 ${
                        isActive && isValid ? "text-zinc-50" : "text-zinc-400"
                      }`}
                      stroke="currentColor"
                      style={{
                        filter:
                          isActive && isValid
                            ? "drop-shadow(0 0 6px rgba(255,255,255,0.34))"
                            : "drop-shadow(0 1px 3px rgba(0,0,0,1))",
                      }}
                      strokeWidth={2.5}
                    />
                  </gsapMotion.div>

                  <gsapMotion.div
                    variants={{
                      idle: { opacity: 0, scale: 0.5 },
                      hover: { opacity: 0, scale: 0.5 },
                      tap: { opacity: 0, scale: 0.5 },
                      sending: { opacity: 1, scale: 1 },
                      success: { opacity: 0, scale: 1.5 },
                    }}
                    transition={{ duration: 0.2 }}
                    className={
                      sendState === "sending"
                        ? "absolute z-30 flex items-center justify-center mix-blend-screen"
                        : "hidden"
                    }
                  >
                    <gsapMotion.div
                      animate={{ rotate: sendState === "sending" ? 360 : 0 }}
                      transition={{
                        repeat:
                          animationsEnabled && sendState === "sending"
                            ? Infinity
                            : 0,
                        duration: animationsEnabled ? 1 : 0,
                        ease: "linear",
                      }}
                      className="flex items-center justify-center"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-[18px] h-[18px]"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    </gsapMotion.div>
                  </gsapMotion.div>

                  <gsapMotion.div
                    variants={{
                      idle: { opacity: 0, scale: 0.5, y: -20 },
                      hover: { opacity: 0, scale: 0.5, y: -20 },
                      tap: { opacity: 0, scale: 0.5, y: -20 },
                      sending: { opacity: 0, scale: 0.5, y: -20 },
                      success: { opacity: 1, scale: 1, y: 0 },
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    className={
                      sendState === "success"
                        ? "absolute z-40 flex items-center justify-center"
                        : "hidden"
                    }
                  >
                    <Check
                      className="w-[18px] h-[18px] text-white"
                      strokeWidth={3}
                    />
                  </gsapMotion.div>
                </gsapMotion.div>
              </gsapMotion.button>
            </div>

            <AnimatePresence>
              {!isValid && (
                <gsapMotion.div
                  initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                  transition={{ duration: 0.3 }}
                  className="absolute -top-10 left-6 text-[#ff4d4d] text-xs font-medium tracking-wide flex items-center gap-1.5"
                >
                  <X size={12} strokeWidth={3} />
                  Special characters are limited.
                </gsapMotion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {voiceState !== "idle" && (
          <VoiceUniverse
            state={voiceState}
            caption={voiceCaption}
            visualFocus={voiceStageFocus}
            onDismissVisual={() => dismissVoiceStageFocus()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
