import React, {
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
  useId,
} from "react";
import { useStore } from "../store";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Brain,
  Search,
  BookOpen,
  Layers,
  Zap,
  Clock,
  AlertTriangle,
  Code,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Trash2,
  MessageSquare,
  Highlighter,
  Underline,
  Strikethrough,
  StickyNote,
  Settings,
  Mic,
  Activity,
  ArrowUp,
  Folder,
  Check,
  Play,
  Pause,
  Volume2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  db,
  GENERAL_STUDY_BOOK_ID,
  PersistentConcept,
  Flashcard,
  LearningBook,
} from "../memory/longterm.memory";
import { PatternCard, themes } from "../components/PatternCard";
import { SvgBeige } from "../components/PatternSVGs";
import tutorBook from "../lib/tutorBook.json";
import userBrainArchitectureBook from "../lib/userBrainArchitectureBook";
import {
  builtInBookAudioOverviews,
  userBrainChapterAudioOverviews,
  type ChapterAudioOverview,
} from "../lib/chapterAudioOverviews";
import { useMotionPreference } from "../hooks/useMotionPreference";
import { recordFlashcardReviewEvidence } from "../memory/revision.evidence";
import { gsap } from "gsap";

type BuiltInBook = {
  id: string;
  name: string;
  description: string;
  hiddenKey: string;
  chapters: {
    title: string;
    content?: string;
    audioOverview?: ChapterAudioOverview;
  }[];
  renderChapter?: (chapterIndex: number) => React.ReactNode;
};

type MermaidApi = typeof import("mermaid").default;

let revisionMermaidPromise: Promise<MermaidApi> | null = null;

const mermaidGeminiThemeVariables = {
  background: "#f6f7f9",
  primaryColor: "#ffffff",
  primaryTextColor: "#1f2933",
  primaryBorderColor: "#d8dadd",
  lineColor: "#a1a5ab",
  secondaryColor: "#ffffff",
  tertiaryColor: "#f6f7f9",
  fontFamily: "Inter, system-ui, sans-serif",
};

const mermaidGeminiInitDirective = `%%{init: ${JSON.stringify({
  theme: "base",
  themeVariables: mermaidGeminiThemeVariables,
})}}%%`;

const loadRevisionMermaid = () => {
  if (!revisionMermaidPromise) {
    revisionMermaidPromise = import("mermaid").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        fontFamily:
          "'Geist Sans', Inter, 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', system-ui, sans-serif",
        themeVariables: {
          background: "transparent",
          fontSize: "14px",
          primaryColor: "#ffffff",
          primaryTextColor: "#18181b",
          primaryBorderColor: "#d4d4d8",
          secondaryColor: "#f4f4f5",
          secondaryTextColor: "#27272a",
          secondaryBorderColor: "#d4d4d8",
          tertiaryColor: "#fafafa",
          tertiaryTextColor: "#3f3f46",
          tertiaryBorderColor: "#e4e4e7",
          mainBkg: "#ffffff",
          nodeBorder: "#d4d4d8",
          nodeTextColor: "#18181b",
          textColor: "#3f3f46",
          titleColor: "#18181b",
          lineColor: "#a1a1aa",
          arrowheadColor: "#a1a1aa",
          edgeLabelBackground: "#fafaf9",
          clusterBkg: "#fafafa",
          clusterBorder: "#e4e4e7",
          noteBkgColor: "#fef3c7",
          noteTextColor: "#78350f",
          noteBorderColor: "#fcd34d",
        },
        flowchart: {
          curve: "basis",
          padding: 12,
          nodeSpacing: 44,
          rankSpacing: 54,
          htmlLabels: true,
          useMaxWidth: true,
        },
        sequence: { useMaxWidth: true },
      });
      return mermaid;
    });
  }
  return revisionMermaidPromise;
};

type RevisionMermaidVariant = "default" | "gemini";

const readableMermaidWidth = (svg: SVGSVGElement) => {
  const [, , viewBoxWidth = 0, viewBoxHeight = 0] =
    svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number) || [];
  if (!Number.isFinite(viewBoxWidth) || viewBoxWidth <= 0) return 720;

  const aspectRatio =
    Number.isFinite(viewBoxHeight) && viewBoxHeight > 0
      ? viewBoxWidth / viewBoxHeight
      : 1;
  const readableScale = aspectRatio > 10 ? 0.74 : aspectRatio > 4 ? 0.86 : 1;

  return Math.round(
    Math.min(Math.max(viewBoxWidth * readableScale, 720), 1280),
  );
};

const RevisionMermaid = ({
  chart,
  variant = "default",
}: {
  chart: string;
  variant?: RevisionMermaidVariant;
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const isGemini = variant === "gemini";
  const chartId = useId().replace(/:/g, "");
  const renderedChart = isGemini
    ? `${mermaidGeminiInitDirective}\n${chart}`
    : chart;

  useEffect(() => {
    let cancelled = false;
    if (!chartRef.current) return;
    chartRef.current.textContent = "";
    const chartForViewport = window.matchMedia?.("(max-width: 640px)").matches
      ? renderedChart
          .replace(/\bflowchart\s+LR\b/g, "flowchart TB")
          .replace(/\bgraph\s+LR\b/g, "graph TB")
      : renderedChart;

    loadRevisionMermaid()
      .then((mermaid) =>
        mermaid.render(`revision-mermaid-${chartId}`, chartForViewport),
      )
      .then((result) => {
        if (!cancelled && chartRef.current) {
          chartRef.current.innerHTML = result.svg;
          const svg = chartRef.current.querySelector<SVGSVGElement>("svg");
          if (svg) {
            const readableWidth = readableMermaidWidth(svg);
            svg.style.width = "100%";
            svg.style.minWidth = "0";
            svg.style.maxWidth = `${readableWidth}px`;
            svg.style.height = "auto";
            svg.style.display = "block";
            svg.style.margin = "0 auto";
            svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
          }
        }
      })
      .catch((error) => {
        console.warn("Revision Mermaid error", error);
        if (!cancelled && chartRef.current) {
          chartRef.current.textContent =
            error instanceof Error ? error.message : String(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chartId, renderedChart]);

  return (
    <div
      className={`not-prose my-6 overflow-x-auto overflow-y-hidden sm:my-8 ${
        isGemini
          ? "rounded-xl border border-zinc-200 bg-[#f6f7f9] p-2 shadow-[0_18px_46px_rgba(15,23,42,0.08)] sm:rounded-2xl sm:p-3"
          : "rounded-xl border border-zinc-200 bg-white/70 p-2 shadow-sm sm:p-3"
      }`}
    >
      <div
        ref={chartRef}
        role="img"
        aria-label={
          isGemini ? "User Brain Architecture chart" : "Revision diagram"
        }
        className={`min-w-full rounded-xl p-2 sm:p-4 [&_.edgeLabel]:rounded-md [&_.label]:font-sans [&_svg]:h-auto ${
          isGemini
            ? "bg-[#f6f7f9] [&_.edgeLabel]:bg-[#f6f7f9]"
            : "bg-white [&_.edgeLabel]:bg-white"
        }`}
      />
    </div>
  );
};

const InteractionRuntimeDiagram = () => {
  const animate = useMotionPreference();
  const runtimeId = useId().replace(/:/g, "");
  const svgId = (name: string) => `${runtimeId}-${name}`;
  const titleId = svgId("title");
  const descId = svgId("desc");
  const softShadowId = svgId("soft-shadow");
  const blueGlowId = svgId("blue-glow");
  const greenGlowId = svgId("green-glow");
  const arrowId = svgId("arrow");
  const userToTutorId = svgId("user-to-tutor");
  const tutorToUserId = svgId("tutor-to-user");
  const contextPathId = svgId("context-path");
  const responsePathId = svgId("response-path");
  const toolLoopId = svgId("tool-loop");
  const mobileTitleId = svgId("mobile-title");
  const mobileDescId = svgId("mobile-desc");
  const mobileSoftShadowId = svgId("mobile-soft-shadow");
  const mobileBlueGlowId = svgId("mobile-blue-glow");
  const mobileGreenGlowId = svgId("mobile-green-glow");
  const mobileArrowId = svgId("mobile-arrow");
  const mobileUserToTutorId = svgId("mobile-user-to-tutor");
  const mobileTutorToUserId = svgId("mobile-tutor-to-user");
  const mobileContextPathId = svgId("mobile-context-path");
  const mobileResponsePathId = svgId("mobile-response-path");
  const mobileToolLoopId = svgId("mobile-tool-loop");

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border border-zinc-200 bg-[#f6f7f9] p-2 shadow-[0_18px_46px_rgba(15,23,42,0.08)] sm:my-8 sm:rounded-2xl sm:p-4">
      <svg
        viewBox="0 0 360 500"
        role="img"
        aria-labelledby={`${mobileTitleId} ${mobileDescId}`}
        className="mx-auto block h-auto w-full max-w-[360px] font-sans sm:hidden"
      >
        <title id={mobileTitleId}>
          Mobile interaction runtime with tutor and background workers
        </title>
        <desc id={mobileDescId}>
          A stacked mobile diagram where the learner talks to the tutor in real
          time while context and verified results move through background
          workers.
        </desc>
        <defs>
          <filter
            id={mobileSoftShadowId}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="8"
              floodColor="#111827"
              floodOpacity="0.08"
            />
          </filter>
          <filter
            id={mobileBlueGlowId}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id={mobileGreenGlowId}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id={mobileArrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 2 2 L 8 5 L 2 8"
              fill="none"
              stroke="#a1a5ab"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
          <path id={mobileContextPathId} d="M 180 192 L 180 118" />
          <path id={mobileResponsePathId} d="M 212 118 L 212 192" />
          <path id={mobileUserToTutorId} d="M 148 336 L 148 276" />
          <path id={mobileTutorToUserId} d="M 212 276 L 212 336" />
          <path
            id={mobileToolLoopId}
            d="M 265 70 L 318 70 Q 330 70 330 82 L 330 124 Q 330 136 318 136 L 272 136"
          />
        </defs>

        <path
          d="M 38 198 L 322 198 A 16 16 0 0 1 338 214 L 338 432 A 16 16 0 0 1 322 448 L 38 448 A 16 16 0 0 1 22 432 L 22 214 A 16 16 0 0 1 38 198"
          fill="none"
          stroke="#9aa0a6"
          strokeWidth="1.4"
          strokeDasharray="6 6"
        />
        <text
          x="180"
          y="466"
          fill="#555"
          fontSize="14"
          fontWeight="650"
          textAnchor="middle"
        >
          real-time tutor loop
        </text>

        <g
          fill="none"
          stroke="#a1a5ab"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 180 192 L 180 118" markerEnd={`url(#${mobileArrowId})`} />
          <path d="M 212 118 L 212 192" markerEnd={`url(#${mobileArrowId})`} />
          <path d="M 148 336 L 148 276" markerEnd={`url(#${mobileArrowId})`} />
          <path d="M 212 276 L 212 336" markerEnd={`url(#${mobileArrowId})`} />
          <path
            d="M 265 70 L 318 70 Q 330 70 330 82 L 330 124 Q 330 136 318 136 L 272 136"
            markerEnd={`url(#${mobileArrowId})`}
          />
        </g>

        <g fill="#4a4a4a" fontSize="13" fontWeight="650">
          <text x="126" y="155">
            context
          </text>
          <text x="224" y="155">
            response
          </text>
          <text x="262" y="38">
            tool calls
          </text>
          <text x="262" y="56">
            browsing
          </text>
          <text x="262" y="74">
            artifacts
          </text>
        </g>

        {animate ? (
          <>
            <circle r="5" fill="#aadd77" filter={`url(#${mobileGreenGlowId})`}>
              <animateMotion dur="1.7s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${mobileContextPathId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#aadd77" filter={`url(#${mobileGreenGlowId})`}>
              <animateMotion
                dur="1.7s"
                begin="0.8s"
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href={`#${mobileResponsePathId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#5bc0de" filter={`url(#${mobileBlueGlowId})`}>
              <animateMotion dur="1.4s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${mobileUserToTutorId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#5bc0de" filter={`url(#${mobileBlueGlowId})`}>
              <animateMotion
                dur="1.4s"
                begin="0.7s"
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href={`#${mobileTutorToUserId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#aadd77" filter={`url(#${mobileGreenGlowId})`}>
              <animateMotion dur="2.4s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${mobileToolLoopId}`} />
              </animateMotion>
            </circle>
          </>
        ) : null}

        <g filter={`url(#${mobileSoftShadowId})`}>
          <rect
            x="92"
            y="52"
            width="172"
            height="68"
            rx="12"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="178"
            y="80"
            fill="#1f2933"
            fontSize="15"
            fontWeight="650"
            textAnchor="middle"
          >
            background
          </text>
          <text
            x="178"
            y="101"
            fill="#1f2933"
            fontSize="15"
            fontWeight="650"
            textAnchor="middle"
          >
            workers
          </text>

          <rect
            x="92"
            y="214"
            width="172"
            height="68"
            rx="12"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="178"
            y="242"
            fill="#1f2933"
            fontSize="15"
            fontWeight="650"
            textAnchor="middle"
          >
            interaction
          </text>
          <text
            x="178"
            y="263"
            fill="#1f2933"
            fontSize="15"
            fontWeight="650"
            textAnchor="middle"
          >
            tutor
          </text>

          <rect
            x="92"
            y="352"
            width="172"
            height="60"
            rx="12"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="178"
            y="389"
            fill="#1f2933"
            fontSize="15"
            fontWeight="650"
            textAnchor="middle"
          >
            learner
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 800 550"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="mx-auto hidden h-auto w-full max-w-[800px] font-sans sm:block"
      >
        <title id={titleId}>
          Interaction runtime with foreground tutor and background worker layer
        </title>
        <desc id={descId}>
          The learner interacts with a foreground tutor in real time. Shared
          context goes to a background worker layer for tool calls and
          retrieval. Verified responses return to the tutor.
        </desc>
        <defs>
          <filter
            id={softShadowId}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feDropShadow
              dx="0"
              dy="6"
              stdDeviation="8"
              floodColor="#111827"
              floodOpacity="0.08"
            />
          </filter>
          <filter id={blueGlowId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={greenGlowId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 2 2 L 8 5 L 2 8"
              fill="none"
              stroke="#a1a5ab"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
          <path
            id={userToTutorId}
            d="M 170 390 L 170 292 Q 170 280 182 280 L 258 280"
          />
          <path
            id={tutorToUserId}
            d="M 330 310 L 330 410 Q 330 420 318 420 L 242 420"
          />
          <path
            id={contextPathId}
            d="M 330 250 L 330 160 Q 330 150 342 150 L 488 150"
          />
          <path
            id={responsePathId}
            d="M 560 180 L 560 268 Q 560 280 548 280 L 402 280"
          />
          <path
            id={toolLoopId}
            d="M 560 120 L 560 70 Q 560 60 572 60 L 680 60 Q 690 60 690 72 L 690 138 Q 690 150 678 150 L 632 150"
          />
        </defs>

        <path
          d="M 96 210 L 444 210 A 18 18 0 0 1 462 228 L 462 452 A 18 18 0 0 1 444 470 L 420 470 M 340 470 L 96 470 A 18 18 0 0 1 78 452 L 78 228 A 18 18 0 0 1 96 210"
          fill="none"
          stroke="#9aa0a6"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
        <text
          x="380"
          y="475"
          fill="#555"
          fontSize="16"
          fontWeight="650"
          textAnchor="middle"
        >
          real-time
        </text>

        <g
          fill="none"
          stroke="#a1a5ab"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M 170 390 L 170 292 Q 170 280 182 280 L 258 280"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 330 310 L 330 410 Q 330 420 318 420 L 242 420"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 330 250 L 330 160 Q 330 150 342 150 L 488 150"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 560 180 L 560 268 Q 560 280 548 280 L 402 280"
            markerEnd={`url(#${arrowId})`}
          />
          <path
            d="M 560 120 L 560 70 Q 560 60 572 60 L 680 60 Q 690 60 690 72 L 690 138 Q 690 150 678 150 L 632 150"
            markerEnd={`url(#${arrowId})`}
          />
        </g>

        <g fill="#4a4a4a" fontSize="16" fontWeight="650">
          <text x="350" y="138">
            context
          </text>
          <text x="460" y="268" textAnchor="middle">
            response
          </text>
          <text x="705" y="85" fontSize="15">
            tool calls
          </text>
          <text x="705" y="105" fontSize="15">
            browsing
          </text>
          <text x="705" y="125" fontSize="15">
            artifacts
          </text>
        </g>

        {animate ? (
          <>
            <circle r="5" fill="#5bc0de" filter={`url(#${blueGlowId})`}>
              <animateMotion dur="1.4s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${userToTutorId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#5bc0de" filter={`url(#${blueGlowId})`}>
              <animateMotion
                dur="1.4s"
                begin="0.7s"
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href={`#${tutorToUserId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#aadd77" filter={`url(#${greenGlowId})`}>
              <animateMotion dur="1.7s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${contextPathId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#aadd77" filter={`url(#${greenGlowId})`}>
              <animateMotion
                dur="1.7s"
                begin="0.8s"
                repeatCount="indefinite"
                rotate="auto"
              >
                <mpath href={`#${responsePathId}`} />
              </animateMotion>
            </circle>
            <circle r="5" fill="#aadd77" filter={`url(#${greenGlowId})`}>
              <animateMotion dur="2.4s" repeatCount="indefinite" rotate="auto">
                <mpath href={`#${toolLoopId}`} />
              </animateMotion>
            </circle>
          </>
        ) : null}

        <g filter={`url(#${softShadowId})`}>
          <rect
            x="100"
            y="390"
            width="140"
            height="60"
            rx="10"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="170"
            y="426"
            fill="#1f2933"
            fontSize="16"
            fontWeight="650"
            textAnchor="middle"
          >
            learner
          </text>

          <rect
            x="260"
            y="250"
            width="140"
            height="60"
            rx="10"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="330"
            y="275"
            fill="#1f2933"
            fontSize="16"
            fontWeight="650"
            textAnchor="middle"
          >
            interaction
          </text>
          <text
            x="330"
            y="295"
            fill="#1f2933"
            fontSize="16"
            fontWeight="650"
            textAnchor="middle"
          >
            tutor
          </text>

          <rect
            x="490"
            y="120"
            width="140"
            height="60"
            rx="10"
            fill="#ffffff"
            stroke="#d8dadd"
            strokeWidth="1.4"
          />
          <text
            x="560"
            y="145"
            fill="#1f2933"
            fontSize="16"
            fontWeight="650"
            textAnchor="middle"
          >
            background
          </text>
          <text
            x="560"
            y="165"
            fill="#1f2933"
            fontSize="16"
            fontWeight="650"
            textAnchor="middle"
          >
            workers
          </text>
        </g>
      </svg>
      <figcaption className="mt-3 text-center font-sans text-sm text-zinc-600">
        The learner stays in a real-time loop with the tutor while background
        workers handle tools, browsing, and artifacts.
      </figcaption>
    </figure>
  );
};

type LibraryDeleteTarget = {
  id: string;
  name: string;
  kind: "built-in" | "learning";
};

const designTokens = [
  { label: "Obsidian", value: "#030303", swatch: "bg-[#030303]" },
  { label: "Panel", value: "#0A0A0B", swatch: "bg-[#0A0A0B]" },
  { label: "Paper", value: "#faf9f6", swatch: "bg-[#faf9f6]" },
  { label: "Violet", value: "#7c3aed", swatch: "bg-violet-600" },
  { label: "Blue", value: "#0a84ff", swatch: "bg-[#0a84ff]" },
  { label: "Signal", value: "#ff6e00", swatch: "bg-[#ff6e00]" },
];

type SnapshotPreviewId =
  | "navigation"
  | "library"
  | "pdf"
  | "toolbar"
  | "chat"
  | "thinking"
  | "brain"
  | "revision"
  | "settings"
  | "analytics";

type WireframeNodeTone = "dark" | "light" | "accent" | "paper" | "blue";

type WireframeNode = {
  id: string;
  x: number;
  y: number;
  tone: WireframeNodeTone;
  summary: string;
  lane: string;
};

type WireframeLinkSide = "top" | "right" | "bottom" | "left";

type WireframeLink = {
  from: string;
  to: string;
  label: string;
  labelX: number;
  labelY: number;
  fromSide?: WireframeLinkSide;
  toSide?: WireframeLinkSide;
  waypoints?: { x: number; y: number }[];
};

const wireframeNodes = [
  {
    id: "App Shell",
    x: 150,
    y: 150,
    tone: "dark",
    summary: "view host",
    lane: "Navigation",
  },
  {
    id: "Navigation",
    x: 470,
    y: 150,
    tone: "dark",
    summary: "activeView",
    lane: "Navigation",
  },
  {
    id: "Settings",
    x: 865,
    y: 150,
    tone: "light",
    summary: "keys + voice",
    lane: "Navigation",
  },
  {
    id: "Study View",
    x: 150,
    y: 380,
    tone: "dark",
    summary: "workspace",
    lane: "Study",
  },
  {
    id: "Document Intake",
    x: 420,
    y: 380,
    tone: "paper",
    summary: "upload",
    lane: "Study",
  },
  {
    id: "PDF Viewer",
    x: 690,
    y: 380,
    tone: "light",
    summary: "read + mark",
    lane: "Study",
  },
  {
    id: "Selection Toolbar",
    x: 960,
    y: 380,
    tone: "light",
    summary: "quote tools",
    lane: "Study",
  },
  {
    id: "Chat Panel",
    x: 1200,
    y: 380,
    tone: "dark",
    summary: "ask tutor",
    lane: "Tutor",
  },
  {
    id: "Thinking Trace",
    x: 690,
    y: 640,
    tone: "blue",
    summary: "stream",
    lane: "Tutor",
  },
  {
    id: "Tutor Tools",
    x: 960,
    y: 640,
    tone: "accent",
    summary: "actions",
    lane: "Tutor",
  },
  {
    id: "Server API",
    x: 1200,
    y: 640,
    tone: "dark",
    summary: "models",
    lane: "Tutor",
  },
  {
    id: "Voice + TTS",
    x: 150,
    y: 640,
    tone: "blue",
    summary: "speech",
    lane: "Tutor",
  },
  {
    id: "Memory Orchestrator",
    x: 420,
    y: 900,
    tone: "accent",
    summary: "maps learning",
    lane: "Memory",
  },
  {
    id: "Dexie DB",
    x: 690,
    y: 900,
    tone: "paper",
    summary: "browser store",
    lane: "Memory",
  },
  {
    id: "Brain Graph",
    x: 960,
    y: 900,
    tone: "dark",
    summary: "concepts",
    lane: "Memory",
  },
  {
    id: "Learning Books",
    x: 1200,
    y: 900,
    tone: "paper",
    summary: "chapters",
    lane: "Memory",
  },
  {
    id: "Revision Library",
    x: 690,
    y: 1140,
    tone: "paper",
    summary: "review",
    lane: "Review",
  },
  {
    id: "Flashcards",
    x: 960,
    y: 1140,
    tone: "light",
    summary: "recall",
    lane: "Review",
  },
  {
    id: "Analytics",
    x: 420,
    y: 1140,
    tone: "light",
    summary: "progress",
    lane: "Ops",
  },
  {
    id: "Admin Console",
    x: 150,
    y: 1140,
    tone: "accent",
    summary: "logs",
    lane: "Ops",
  },
] satisfies WireframeNode[];

const wireframeLinks = [
  {
    from: "App Shell",
    to: "Navigation",
    label: "renders tabs",
    labelX: 310,
    labelY: 150,
  },
  {
    from: "Navigation",
    to: "Study View",
    label: "opens workspace",
    labelX: 310,
    labelY: 260,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 470, y: 260 },
      { x: 150, y: 260 },
    ],
  },
  {
    from: "Navigation",
    to: "Revision Library",
    label: "opens library",
    labelX: 770,
    labelY: 610,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 770, y: 260 },
      { x: 770, y: 1050 },
      { x: 690, y: 1050 },
    ],
  },
  {
    from: "Navigation",
    to: "Analytics",
    label: "opens progress",
    labelX: 350,
    labelY: 760,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 350, y: 260 },
      { x: 350, y: 1050 },
      { x: 420, y: 1050 },
    ],
  },
  {
    from: "Settings",
    to: "Chat Panel",
    label: "model + voice",
    labelX: 1080,
    labelY: 260,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 865, y: 260 },
      { x: 1200, y: 260 },
    ],
  },
  {
    from: "Study View",
    to: "Document Intake",
    label: "adds file",
    labelX: 285,
    labelY: 380,
  },
  {
    from: "Document Intake",
    to: "PDF Viewer",
    label: "loads pages",
    labelX: 555,
    labelY: 380,
  },
  {
    from: "PDF Viewer",
    to: "Selection Toolbar",
    label: "selected text",
    labelX: 825,
    labelY: 380,
  },
  {
    from: "Selection Toolbar",
    to: "Chat Panel",
    label: "ask tutor",
    labelX: 1080,
    labelY: 380,
  },
  {
    from: "Chat Panel",
    to: "Thinking Trace",
    label: "streams reasoning",
    labelX: 945,
    labelY: 515,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 1200, y: 515 },
      { x: 690, y: 515 },
    ],
  },
  {
    from: "Chat Panel",
    to: "Tutor Tools",
    label: "calls tools",
    labelX: 1080,
    labelY: 548,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 1200, y: 548 },
      { x: 960, y: 548 },
    ],
  },
  {
    from: "Tutor Tools",
    to: "Server API",
    label: "model/search",
    labelX: 1080,
    labelY: 640,
  },
  {
    from: "Server API",
    to: "Chat Panel",
    label: "returns answer",
    labelX: 1325,
    labelY: 520,
    fromSide: "right",
    toSide: "right",
    waypoints: [
      { x: 1325, y: 640 },
      { x: 1325, y: 380 },
    ],
  },
  {
    from: "Chat Panel",
    to: "Memory Orchestrator",
    label: "saves exchange",
    labelX: 1020,
    labelY: 735,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 1200, y: 735 },
      { x: 420, y: 735 },
    ],
  },
  {
    from: "PDF Viewer",
    to: "Memory Orchestrator",
    label: "adds notes",
    labelX: 560,
    labelY: 760,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 690, y: 760 },
      { x: 420, y: 760 },
    ],
  },
  {
    from: "Tutor Tools",
    to: "Memory Orchestrator",
    label: "updates graph",
    labelX: 690,
    labelY: 785,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 960, y: 785 },
      { x: 420, y: 785 },
    ],
  },
  {
    from: "Voice + TTS",
    to: "Chat Panel",
    label: "speech input",
    labelX: 460,
    labelY: 720,
    fromSide: "right",
    toSide: "bottom",
    waypoints: [
      { x: 300, y: 720 },
      { x: 1325, y: 720 },
      { x: 1325, y: 465 },
      { x: 1200, y: 465 },
    ],
  },
  {
    from: "Memory Orchestrator",
    to: "Dexie DB",
    label: "persists",
    labelX: 555,
    labelY: 900,
  },
  {
    from: "Memory Orchestrator",
    to: "Brain Graph",
    label: "creates nodes",
    labelX: 690,
    labelY: 805,
    fromSide: "top",
    toSide: "top",
    waypoints: [
      { x: 420, y: 805 },
      { x: 960, y: 805 },
    ],
  },
  {
    from: "Memory Orchestrator",
    to: "Learning Books",
    label: "writes chapters",
    labelX: 810,
    labelY: 1010,
    fromSide: "bottom",
    toSide: "bottom",
    waypoints: [
      { x: 420, y: 1010 },
      { x: 1200, y: 1010 },
    ],
  },
  {
    from: "Learning Books",
    to: "Revision Library",
    label: "appears as book",
    labelX: 960,
    labelY: 1060,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 1200, y: 1060 },
      { x: 690, y: 1060 },
    ],
  },
  {
    from: "Learning Books",
    to: "Flashcards",
    label: "review queue",
    labelX: 1080,
    labelY: 1088,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 1200, y: 1088 },
      { x: 960, y: 1088 },
    ],
  },
  {
    from: "Dexie DB",
    to: "Analytics",
    label: "aggregates",
    labelX: 555,
    labelY: 1026,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 690, y: 1026 },
      { x: 420, y: 1026 },
    ],
  },
  {
    from: "Dexie DB",
    to: "Admin Console",
    label: "trace records",
    labelX: 400,
    labelY: 1000,
    fromSide: "bottom",
    toSide: "top",
    waypoints: [
      { x: 690, y: 1000 },
      { x: 150, y: 1000 },
    ],
  },
] satisfies WireframeLink[];

const snapshotCards: {
  id: SnapshotPreviewId;
  title: string;
  caption: string;
}[] = [
  {
    id: "navigation",
    title: "Navigation",
    caption: "Click a route to move the active pill.",
  },
  {
    id: "library",
    title: "Library Book Card",
    caption: "Open and close the cover state.",
  },
  {
    id: "pdf",
    title: "PDF Viewer",
    caption: "Change page, zoom, and annotation mode.",
  },
  {
    id: "toolbar",
    title: "Selection Toolbar",
    caption: "Pick highlight, underline, strike, or Ask Tutor.",
  },
  {
    id: "chat",
    title: "Chat Panel",
    caption: "Send a sample prompt into the mini tutor.",
  },
  {
    id: "thinking",
    title: "AI Thinking",
    caption: "Expand and collapse the reasoning trace.",
  },
  {
    id: "brain",
    title: "Brain Graph",
    caption: "Focus different concept nodes.",
  },
  {
    id: "revision",
    title: "Revision Notebook",
    caption: "Turn notebook pages.",
  },
  {
    id: "settings",
    title: "Settings",
    caption: "Switch settings tabs.",
  },
  {
    id: "analytics",
    title: "Analytics/Admin",
    caption: "Toggle metric modes.",
  },
];

const GalleryPanel = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-[34px] border border-zinc-200/70 bg-zinc-100/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_28px_80px_rgba(24,24,27,0.08)] sm:p-6 ${className}`}
  >
    {children}
  </div>
);

const WireframeMap = () => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [mapScale, setMapScale] = useState(1);
  const nodeById = new Map(wireframeNodes.map((node) => [node.id, node]));
  const canvas = { width: 1360, height: 1260 };
  const nodeSize = { width: 170, height: 92 };
  const lanes = [
    ["Navigation", 82],
    ["Study", 305],
    ["Tutor", 565],
    ["Memory", 825],
    ["Review + Ops", 1065],
  ] as const;
  const nodeClass = (tone: WireframeNodeTone) => {
    if (tone === "dark") return "border-zinc-700 bg-[#07070a] text-white";
    if (tone === "accent") return "border-orange-300 bg-white text-orange-600";
    if (tone === "paper") return "border-zinc-200 bg-[#faf9f6] text-zinc-900";
    if (tone === "blue") return "border-blue-200 bg-white text-blue-600";
    return "border-white bg-white text-zinc-700";
  };
  useEffect(() => {
    const updateScale = () => {
      const width = viewportRef.current?.clientWidth ?? canvas.width;
      setMapScale(Math.min(1, Math.max(0.58, (width - 28) / canvas.width)));
    };
    updateScale();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateScale)
        : null;
    if (viewportRef.current) resizeObserver?.observe(viewportRef.current);
    window.addEventListener("resize", updateScale);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [canvas.width]);
  const defaultSide = (
    source: WireframeNode,
    target: WireframeNode,
    role: "source" | "target",
  ): WireframeLinkSide => {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (role === "source") return dx >= 0 ? "right" : "left";
      return dx >= 0 ? "left" : "right";
    }
    if (role === "source") return dy >= 0 ? "bottom" : "top";
    return dy >= 0 ? "top" : "bottom";
  };
  const anchorFor = (node: WireframeNode, side: WireframeLinkSide) => {
    if (side === "left") return { x: node.x - nodeSize.width / 2, y: node.y };
    if (side === "right") return { x: node.x + nodeSize.width / 2, y: node.y };
    if (side === "top") return { x: node.x, y: node.y - nodeSize.height / 2 };
    return { x: node.x, y: node.y + nodeSize.height / 2 };
  };
  const linkPath = (
    link: WireframeLink,
    source: WireframeNode,
    target: WireframeNode,
  ) => {
    const sourceSide = link.fromSide ?? defaultSide(source, target, "source");
    const targetSide = link.toSide ?? defaultSide(source, target, "target");
    const start = anchorFor(source, sourceSide);
    const end = anchorFor(target, targetSide);

    if (link.waypoints?.length) {
      return [
        `M ${start.x} ${start.y}`,
        ...link.waypoints.map((point) => `L ${point.x} ${point.y}`),
        `L ${end.x} ${end.y}`,
      ].join(" ");
    }

    const horizontal = sourceSide === "left" || sourceSide === "right";
    const distance = horizontal
      ? Math.abs(end.x - start.x)
      : Math.abs(end.y - start.y);
    const offset = Math.max(74, Math.min(170, distance * 0.55));

    if (horizontal) {
      const direction = sourceSide === "right" ? 1 : -1;
      return `M ${start.x} ${start.y} C ${start.x + direction * offset} ${start.y}, ${end.x - direction * offset} ${end.y}, ${end.x} ${end.y}`;
    }

    const direction = sourceSide === "bottom" ? 1 : -1;
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + direction * offset}, ${end.x} ${end.y - direction * offset}, ${end.x} ${end.y}`;
  };

  return (
    <GalleryPanel className="relative left-1/2 w-full -translate-x-1/2 overflow-hidden bg-[#f3f3f4] p-0 lg:w-[min(1480px,calc(100vw-18rem))] xl:w-[min(1540px,calc(100vw-24rem))]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.88),transparent_56%)]" />
      <div className="relative border-b border-white/80 px-5 py-4 sm:px-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
          Component Map
        </div>
        <div className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
          Scroll the canvas to follow how the app shell hands work to the study
          surface, tutor tools, memory layer, review surfaces, and diagnostic
          views.
        </div>
      </div>
      <div
        ref={viewportRef}
        className="relative max-h-[min(78vh,880px)] overflow-x-auto overflow-y-auto custom-scroll"
        aria-label="Scrollable wireframe map of the Tutor UI components"
      >
        <div
          className="relative mx-auto"
          style={{
            width: canvas.width * mapScale,
            height: canvas.height * mapScale,
          }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: canvas.width,
              height: canvas.height,
              transform: `scale(${mapScale})`,
              transformOrigin: "top left",
            }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(212,212,216,0.28)_1px,transparent_1px),linear-gradient(180deg,rgba(212,212,216,0.28)_1px,transparent_1px)] bg-[size:80px_80px]" />
            {lanes.map(([lane, top]) => (
              <div
                key={lane}
                className="absolute left-6 right-6 border-t border-dashed border-zinc-300/70 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400"
                style={{ top }}
              >
                {lane}
              </div>
            ))}
            <svg
              className="absolute inset-0 z-10"
              width={canvas.width}
              height={canvas.height}
              viewBox={`0 0 ${canvas.width} ${canvas.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="wire-arrow"
                  markerHeight="8"
                  markerWidth="8"
                  orient="auto"
                  refX="7"
                  refY="4"
                >
                  <path d="M0,0 L8,4 L0,8 Z" fill="rgba(113,113,122,0.82)" />
                </marker>
              </defs>
              {wireframeLinks.map((link) => {
                const source = nodeById.get(link.from);
                const target = nodeById.get(link.to);
                if (!source || !target) return null;
                return (
                  <g key={`${link.from}-${link.to}`}>
                    <path
                      d={linkPath(link, source, target)}
                      fill="none"
                      stroke="rgba(113,113,122,0.46)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd="url(#wire-arrow)"
                    />
                  </g>
                );
              })}
            </svg>

            {wireframeLinks.map((link) => (
              <div
                key={`${link.from}-${link.to}-label`}
                data-wireframe-label={link.label}
                className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-zinc-200/90 bg-white/95 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.04em] text-zinc-600 shadow-[0_10px_24px_rgba(24,24,27,0.1)] backdrop-blur-sm"
                style={{ left: link.labelX, top: link.labelY }}
              >
                {link.label}
              </div>
            ))}

            {wireframeNodes.map((node) => (
              <div
                key={node.id}
                data-wireframe-node={node.id}
                className={`absolute z-30 flex min-h-[92px] w-[170px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-[24px] border px-4 text-center shadow-[0_24px_55px_rgba(24,24,27,0.13)] transition-transform duration-300 hover:scale-[1.03] ${nodeClass(
                  node.tone,
                )}`}
                style={{ left: node.x, top: node.y }}
              >
                <div className="text-[14px] font-bold leading-tight tracking-tight">
                  {node.id}
                </div>
                <div
                  className={`mt-2 text-[10px] font-bold uppercase tracking-[0.16em] ${
                    node.tone === "dark" ? "text-white/40" : "text-zinc-400"
                  }`}
                >
                  {node.summary}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GalleryPanel>
  );
};

const LiveComponentPreview = ({ id }: { id: SnapshotPreviewId }) => {
  const motionEnabled = useMotionPreference();
  const [activeRoute, setActiveRoute] = useState("Study");
  const [bookOpen, setBookOpen] = useState(false);
  const [pdfPage, setPdfPage] = useState(2);
  const [pdfZoom, setPdfZoom] = useState(112);
  const [activeTool, setActiveTool] = useState("Highlight");
  const [chatMessages, setChatMessages] = useState([
    "What should I review next?",
  ]);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [brainFocus, setBrainFocus] = useState("Memory");
  const [notebookPage, setNotebookPage] = useState(1);
  const [settingsTab, setSettingsTab] = useState("AI");
  const [metricMode, setMetricMode] = useState("Mastery");

  if (id === "navigation") {
    const navItems = [
      { label: "Study", icon: BookOpen },
      { label: "Analytics", icon: Zap },
      { label: "Revision", icon: Brain },
    ];
    return (
      <div className="flex justify-center rounded-[28px] bg-[#f7f7f8] p-6 shadow-inner">
        <div className="inline-flex rounded-full border border-white/10 bg-[#242426] p-1 shadow-[0_20px_45px_rgba(0,0,0,0.35)]">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => setActiveRoute(label)}
              className={`relative inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold transition-colors ${
                activeRoute === label
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {activeRoute === label && (
                <span className="absolute inset-0 rounded-full bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_8px_22px_rgba(0,0,0,0.35)]" />
              )}
              <span
                className={`relative z-10 inline-flex items-center gap-2 transition-transform duration-200 ${
                  activeRoute === label ? "-translate-y-px" : ""
                }`}
              >
                <Icon size={14} />
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (id === "library") {
    return (
      <div className="flex justify-center rounded-[30px] bg-[#f4f4f5] p-4 shadow-inner">
        <div className="h-60 w-[190px] overflow-hidden rounded-[28px]">
          <div className="origin-top-left scale-[0.58]">
            <PatternCard
              bgClass={bookOpen ? themes[2].bg : themes[0].bg}
              SvgComponent={
                bookOpen ? themes[2].SvgComponent : themes[0].SvgComponent
              }
              bloomColor={bookOpen ? themes[2].bloom : themes[0].bloom}
              bloomOpacity={
                bookOpen ? themes[2].bloomOpacity : themes[0].bloomOpacity
              }
              onClick={() => setBookOpen((open) => !open)}
              animateDots
            >
              <div
                className={`relative z-20 flex h-full flex-col justify-end p-8 ${
                  bookOpen ? "text-zinc-950" : "text-white"
                }`}
              >
                <div className="text-[12px] font-bold uppercase tracking-[0.22em] opacity-50">
                  Built-in book
                </div>
                <div className="mt-5 text-4xl font-semibold leading-[0.95] tracking-tight">
                  App Design
                  <br />
                  Language
                </div>
                <div className="mt-6 text-sm font-medium opacity-60">
                  {bookOpen ? "Wireframes · Theme · Snapshots" : "Tap to open"}
                </div>
              </div>
            </PatternCard>
          </div>
        </div>
      </div>
    );
  }

  if (id === "pdf") {
    return (
      <div className="rounded-[28px] bg-[#08080a] p-4 text-white shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {["-", "+"].map((control) => (
              <button
                key={control}
                type="button"
                onClick={() =>
                  setPdfZoom((zoom) =>
                    control === "+"
                      ? Math.min(150, zoom + 8)
                      : Math.max(80, zoom - 8),
                  )
                }
                className="h-8 w-8 rounded-xl bg-white/10 text-sm font-bold"
              >
                {control}
              </button>
            ))}
          </div>
          <div className="rounded-full bg-white/10 px-3 py-1 text-[10px]">
            {pdfZoom}%
          </div>
        </div>
        <div className="rounded-[22px] bg-[#faf9f6] p-4 text-zinc-900">
          <div className="mb-3 flex items-center justify-between">
            <div className="h-2 w-24 rounded-full bg-zinc-300" />
            <div className="text-[10px] font-bold text-zinc-400">
              p. {pdfPage}
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-2 rounded-full bg-zinc-200" />
            <div className="h-2 w-5/6 rounded-full bg-zinc-200" />
            <div
              className={`h-4 rounded-full ${
                activeTool === "Highlight" ? "bg-yellow-300" : "bg-zinc-200"
              }`}
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {[1, 2, 3].map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => setPdfPage(page)}
              className={`h-7 flex-1 rounded-full text-[10px] ${
                pdfPage === page ? "bg-indigo-500" : "bg-white/10 text-zinc-400"
              }`}
            >
              {page}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (id === "toolbar") {
    const tools = [
      { label: "Highlight", icon: Highlighter, color: "text-yellow-400" },
      { label: "Underline", icon: Underline, color: "text-blue-500" },
      { label: "Strike", icon: Strikethrough, color: "text-red-500" },
      { label: "Sticky", icon: StickyNote, color: "text-yellow-400" },
    ];
    return (
      <div className="flex justify-center rounded-[28px] bg-[#f7f7f8] p-6 shadow-inner">
        <div className="relative flex items-center gap-1 overflow-hidden rounded-xl bg-[#121214]/95 p-1 text-white shadow-[0_20px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div
            className={`absolute inset-[-60%] h-[220%] w-[220%] ${
              motionEnabled ? "animate-[spin_4s_linear_infinite]" : ""
            }`}
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.72) 50%, rgba(255,255,255,0.08) 60%, transparent 100%)",
            }}
          />
          <div className="relative z-10 flex gap-1 border-r border-white/10 pr-1.5">
            {tools.map(({ label, icon: Icon, color }) => (
              <button
                key={label}
                type="button"
                onClick={() => setActiveTool(label)}
                title={label}
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-white/10 ${color} ${
                  activeTool === label ? "bg-white/10" : ""
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setActiveTool("Ask")}
            className={`relative z-10 ml-1 flex items-center gap-1 overflow-hidden rounded-lg border border-indigo-400/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] ${
              activeTool === "Ask" ? "bg-indigo-400" : "bg-indigo-500"
            }`}
          >
            <span className="absolute inset-0 rounded-lg bg-[linear-gradient(135deg,rgba(255,255,255,0.24),rgba(255,255,255,0.04)_42%,rgba(129,140,248,0.32))]" />
            <MessageSquare size={12} className="relative z-10" />
            <span className="relative z-10">Ask Tutor</span>
          </button>
        </div>
      </div>
    );
  }

  if (id === "chat") {
    return (
      <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-[#fdfdfd] text-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200/70 bg-white/95 px-4 py-3 shadow-[0_12px_30px_rgba(255,255,255,0.9)]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/5 bg-white shadow-sm">
              <Zap size={14} className="text-zinc-600" />
            </div>
            <div className="text-sm font-semibold">Tutor</div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[10px] font-medium shadow-sm">
            <Folder size={12} />
            App Design
          </div>
        </div>
        <div className="space-y-3 p-4">
          {chatMessages.slice(-2).map((message, index) => (
            <div
              key={`${message}-${index}`}
              className={
                index === 0
                  ? "ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-[#1c1c1e] px-3 py-2 text-xs font-medium text-white"
                  : "max-w-[88%] rounded-2xl bg-zinc-100 px-3 py-2 text-xs text-zinc-700"
              }
            >
              {message}
            </div>
          ))}
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-3 shadow-[0_14px_34px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Zap size={14} className="text-violet-500" />
              Reasoning trace
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-zinc-500">
                Complete
              </span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">Answer ready.</div>
          </div>
        </div>
        <div className="p-3 pt-0">
          <div className="flex items-center gap-2 rounded-[24px] bg-[#18181b] p-2">
            <button
              type="button"
              onClick={() =>
                setChatMessages((messages) => [
                  ...messages,
                  "Explain this page with one analogy.",
                ])
              }
              className="flex-1 rounded-2xl px-3 py-2 text-left text-xs text-zinc-400"
            >
              Ask about the current page...
            </button>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-950 text-white">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (id === "thinking") {
    return (
      <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white/90 text-left shadow-[0_18px_45px_rgba(0,0,0,0.06)]">
        <button
          type="button"
          onClick={() => setThinkingOpen((open) => !open)}
          aria-expanded={thinkingOpen}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition-colors hover:bg-zinc-50"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
              <Zap size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-zinc-900">
                  Reasoning trace
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  Complete
                </span>
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-snug text-zinc-500">
                Answer ready.
              </div>
            </div>
          </div>
          <span
            className={`transition-transform duration-200 ${
              thinkingOpen ? "rotate-180" : ""
            }`}
          >
            <ChevronDown size={16} className="text-zinc-400" />
          </span>
        </button>
        {thinkingOpen && (
          <div className="overflow-hidden border-t border-zinc-100">
            <div className="space-y-2 px-4 py-3 text-[12px] text-zinc-500">
              {["Retrieving relevant context", "Linking concepts"].map(
                (item) => (
                  <div key={item} className="rounded-2xl bg-zinc-50 px-3 py-2">
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (id === "brain") {
    return (
      <div className="relative h-48 rounded-[30px] bg-[#07070a] p-4 shadow-2xl">
        {["Learner", "Memory", "Revision"].map((node, index) => {
          const positions = [
            "left-[18%] top-[48%]",
            "left-[48%] top-[25%]",
            "left-[70%] top-[62%]",
          ];
          return (
            <button
              key={node}
              type="button"
              onClick={() => setBrainFocus(node)}
              className={`absolute ${positions[index]} h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[color,background-color,border-color,box-shadow,transform,opacity] ${
                brainFocus === node
                  ? "bg-violet-400 shadow-[0_0_34px_rgba(167,139,250,0.82)]"
                  : "bg-blue-400/70 shadow-[0_0_22px_rgba(96,165,250,0.45)]"
              }`}
              aria-label={`Focus ${node}`}
            />
          );
        })}
        <div className="absolute left-[24%] top-[41%] h-px w-24 rotate-[-20deg] bg-white/30" />
        <div className="absolute left-[51%] top-[45%] h-px w-24 rotate-[31deg] bg-white/30" />
        <div className="absolute bottom-4 left-4 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          Focus: {brainFocus}
        </div>
      </div>
    );
  }

  if (id === "revision") {
    return (
      <div className="rounded-[28px] bg-[#faf9f6] p-5 shadow-2xl">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
          Page {notebookPage}
        </div>
        <h4 className="mt-3 font-serif text-2xl font-medium">
          {notebookPage === 1 ? "Recall Prompt" : "Concept Notes"}
        </h4>
        <div className="mt-5 space-y-2">
          <div className="h-2 rounded-full bg-zinc-200" />
          <div className="h-2 w-5/6 rounded-full bg-zinc-200" />
          <div className="h-2 w-2/3 rounded-full bg-zinc-200" />
        </div>
        <button
          type="button"
          onClick={() => setNotebookPage((page) => (page === 1 ? 2 : 1))}
          className="mt-5 rounded-full bg-zinc-950 px-4 py-2 text-xs font-semibold text-white"
        >
          Turn page
        </button>
      </div>
    );
  }

  if (id === "settings") {
    return (
      <div className="rounded-[30px] border border-zinc-200 bg-[#faf9f6] p-4 text-zinc-950 shadow-2xl">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-white p-1 shadow-inner">
          {["AI", "Voice", "Usage"].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSettingsTab(tab)}
              className={`relative rounded-full py-2 text-[10px] font-semibold transition-colors ${
                settingsTab === tab
                  ? "text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {settingsTab === tab && (
                <span className="absolute inset-0 rounded-full bg-zinc-950/5 shadow-[0_8px_18px_rgba(24,24,27,0.08)]" />
              )}
              <span className="relative z-10">{tab}</span>
            </button>
          ))}
        </div>
        <div
          key={settingsTab}
          className="mt-4 rounded-2xl border border-zinc-200 bg-white/80 p-4 text-xs text-zinc-600 shadow-sm"
        >
          <div className="flex items-center gap-2 font-semibold text-zinc-950">
            <Settings size={14} />
            {settingsTab} controls preview
          </div>
          <div className="mt-3 h-2 rounded-full bg-zinc-200" />
          <div className="mt-2 h-2 w-2/3 rounded-full bg-zinc-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] bg-white p-4 shadow-2xl">
      <div className="mb-4 flex gap-2">
        {["Mastery", "Runtime"].map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setMetricMode(mode)}
            className={`rounded-full px-3 py-1 text-[10px] font-semibold ${
              metricMode === mode ? "bg-zinc-950 text-white" : "bg-zinc-100"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="flex h-28 items-end gap-2">
        {(metricMode === "Mastery"
          ? [42, 68, 34, 86, 58]
          : [70, 40, 92, 55, 76]
        ).map((height, index) => (
          <div
            key={`${height}-${index}`}
            className="flex-1 rounded-t-xl bg-gradient-to-t from-blue-500 to-emerald-300"
            style={{ height }}
          />
        ))}
      </div>
    </div>
  );
};

const formatAudioTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
};

const resolveAudioOverviewSrc = (src: string) => {
  if (/^(https?:|blob:|data:)/.test(src)) return src;
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedSrc = src.startsWith("/") ? src.slice(1) : src;
  return `${normalizedBase}${normalizedSrc}`;
};

const StoredAudioOverview = ({
  overview,
}: {
  overview: ChapterAudioOverview;
}) => {
  const audioSrc = resolveAudioOverviewSrc(overview.audioSrc);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingPlayRef = useRef<Promise<void> | null>(null);
  const retryPlaybackTimerRef = useRef<number | null>(null);
  const retryPlaybackAttemptsRef = useRef(0);
  const [audioIssue, setAudioIssue] = useState<"" | "playback" | "media">("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (retryPlaybackTimerRef.current) {
      window.clearTimeout(retryPlaybackTimerRef.current);
      retryPlaybackTimerRef.current = null;
    }
    retryPlaybackAttemptsRef.current = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setAudioIssue("");
    pendingPlayRef.current = null;
    return () => {
      audioRef.current?.pause();
      if (retryPlaybackTimerRef.current) {
        window.clearTimeout(retryPlaybackTimerRef.current);
        retryPlaybackTimerRef.current = null;
      }
      pendingPlayRef.current = null;
    };
  }, [audioSrc]);

  const startPlayback = async () => {
    const audioElement = audioRef.current;
    if (!audioElement) throw new Error("Audio element is not ready.");
    audioElement.playbackRate = playbackRate;
    if (audioElement.ended) audioElement.currentTime = 0;
    if (audioElement.readyState === 0) audioElement.load();
    const playPromise = audioElement.play();
    pendingPlayRef.current = playPromise;
    try {
      await playPromise;
      retryPlaybackAttemptsRef.current = 0;
    } finally {
      if (pendingPlayRef.current === playPromise) {
        pendingPlayRef.current = null;
      }
    }
    setError("");
    setAudioIssue("");
  };

  const schedulePlaybackRetry = () => {
    if (retryPlaybackTimerRef.current) return;
    if (retryPlaybackAttemptsRef.current >= 3) return;
    retryPlaybackAttemptsRef.current += 1;
    retryPlaybackTimerRef.current = window.setTimeout(() => {
      retryPlaybackTimerRef.current = null;
      void startPlayback().catch(() => {
        setAudioIssue("playback");
        setError("Audio playback was blocked by the browser.");
      });
    }, 800);
  };

  const togglePlayback = async () => {
    const audioElement = audioRef.current;
    if (!audioElement) return;
    const pendingPlay = pendingPlayRef.current;
    if (pendingPlay) {
      try {
        await pendingPlay;
      } catch {
        setAudioIssue("playback");
        setError("Audio playback was blocked by the browser.");
        schedulePlaybackRetry();
      }
      return;
    }
    if (isPlaying || (!audioElement.paused && !audioElement.ended)) {
      audioElement.pause();
      return;
    }
    try {
      await startPlayback();
    } catch {
      setAudioIssue("playback");
      setError("Audio playback was blocked by the browser.");
      schedulePlaybackRetry();
    }
  };

  const seekAudio = (nextTime: number) => {
    const audioElement = audioRef.current;
    if (!audioElement || !Number.isFinite(nextTime)) return;
    const boundedTime = Math.min(
      Math.max(0, nextTime),
      Number.isFinite(duration) && duration > 0 ? duration : nextTime,
    );
    audioElement.currentTime = boundedTime;
    setCurrentTime(boundedTime);
  };

  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;
  const playbackStatus =
    audioIssue === "playback" && error
      ? "Open audio guide"
      : audioIssue === "playback"
        ? "Preparing audio guide"
        : error
          ? "Audio unavailable"
          : isPlaying
            ? "Playing audio guide"
            : duration > 0
              ? "Ready audio guide"
              : "Loading audio metadata";

  return (
    <div className="mb-10 rounded-[30px] border border-zinc-200 bg-white/80 p-4 font-sans shadow-[0_20px_54px_rgba(46,36,22,0.08)] sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-500/70">
            <Volume2 size={14} />
            Chapter audio guide
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            {overview.summary}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={`${isPlaying ? "Pause" : "Play"} ${overview.title}`}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800"
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          {[1, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => setPlaybackRate(rate)}
              aria-pressed={playbackRate === rate}
              aria-label={`Set chapter audio speed to ${rate}x`}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
                playbackRate === rate
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-orange-400 transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={duration > 0 ? Math.min(currentTime, duration) : 0}
          disabled={duration <= 0}
          aria-label="Seek chapter audio guide"
          onChange={(event) => seekAudio(Number(event.currentTarget.value))}
          className="mt-3 h-2 w-full cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
          <span>
            {formatAudioTime(currentTime)} /{" "}
            {duration ? formatAudioTime(duration) : overview.durationLabel}
          </span>
          <span>{playbackStatus}</span>
        </div>
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="auto"
          className="sr-only"
          onPlay={() => {
            setIsPlaying(true);
            setError("");
            setAudioIssue("");
          }}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={(event) =>
            setCurrentTime(event.currentTarget.currentTime)
          }
          onLoadedMetadata={(event) => {
            const nextDuration = Number.isFinite(event.currentTarget.duration)
              ? event.currentTarget.duration
              : 0;
            setDuration(nextDuration);
            event.currentTarget.playbackRate = playbackRate;
            setError("");
            setAudioIssue("");
            if (audioIssue === "playback") schedulePlaybackRetry();
          }}
          onError={() => {
            setIsPlaying(false);
            setAudioIssue("media");
            setError("Audio guide is unavailable in this build.");
          }}
        />
      </div>
      {error && (audioIssue === "media" || audioIssue === "playback") && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{error}</span>{" "}
          <a
            href={audioSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-4"
          >
            Open the local MP3 guide.
          </a>
        </div>
      )}
      <details className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        <summary className="cursor-pointer font-medium text-zinc-800">
          Transcript
        </summary>
        <p className="mt-3 leading-6">{overview.transcript}</p>
      </details>
    </div>
  );
};

const AppDesignLanguagePage = ({ chapterIndex }: { chapterIndex: number }) => {
  if (chapterIndex === 0) {
    return (
      <div className="font-sans text-zinc-900">
        <WireframeMap />
      </div>
    );
  }

  if (chapterIndex === 1) {
    return (
      <div className="font-sans text-zinc-900">
        <div className="grid gap-5 md:grid-cols-2">
          <GalleryPanel className="bg-[#09090b] text-white">
            <div className="mb-8 text-[11px] font-bold uppercase tracking-[0.18em] text-white/35">
              Cosmic Obsidian
            </div>
            <div className="relative min-h-64 overflow-hidden rounded-[32px] border border-white/10 bg-[#030303] p-6 shadow-2xl">
              <div className="absolute -left-8 top-10 h-36 w-36 rounded-full bg-blue-500/25 blur-2xl" />
              <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-violet-500/30 blur-2xl" />
              <div className="absolute bottom-0 right-8 h-24 w-24 rounded-full bg-orange-500/25 blur-xl" />
              <div className="relative">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 via-violet-500 to-orange-400 shadow-[0_0_40px_rgba(124,58,237,0.5)]" />
                <h3 className="mt-8 text-3xl font-semibold tracking-tight">
                  Dark learning surfaces stay cinematic and focused.
                </h3>
                <p className="mt-4 text-sm leading-6 text-zinc-400">
                  Glass, blur, neon, and spring motion are reserved for active
                  learning controls and AI state.
                </p>
              </div>
            </div>
          </GalleryPanel>

          <GalleryPanel className="bg-[#faf9f6]">
            <div className="mb-8 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              Paper Counterpart
            </div>
            <div className="rounded-[32px] border border-zinc-200 bg-white/65 p-6 shadow-[0_24px_70px_rgba(46,36,22,0.12)]">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Revision
              </div>
              <h3 className="mt-5 font-serif text-3xl font-medium leading-tight">
                Review should feel like opening a careful notebook.
              </h3>
              <div className="mt-8 space-y-3">
                <div className="h-2 rounded-full bg-zinc-200" />
                <div className="h-2 w-5/6 rounded-full bg-zinc-200" />
                <div className="h-2 w-2/3 rounded-full bg-zinc-200" />
              </div>
            </div>
          </GalleryPanel>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {designTokens.map((token) => (
            <div
              key={token.label}
              className="flex items-center gap-3 rounded-[22px] bg-white px-4 py-3 shadow-[0_14px_34px_rgba(24,24,27,0.08)]"
            >
              <div
                className={`h-10 w-10 rounded-2xl border border-zinc-200 ${token.swatch}`}
              />
              <div>
                <div className="text-sm font-semibold">{token.label}</div>
                <div className="font-mono text-xs text-zinc-400">
                  {token.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (chapterIndex === 3) {
    const controlPatterns = [
      {
        title: "PDF chip rail",
        detail:
          "Study keeps document switching compact: one or several uploaded PDFs are saved into the active book, then appear as rounded chips above the reader with a small remove action and a dashed add control.",
      },
      {
        title: "Request timelines",
        detail:
          "Admin groups brain-context packet injections, server events, retrieval injections, model runs, tool jobs, interaction/learning-book/graph-concept background job state, and background memory writes by request id so one tutor turn can be audited as a single story.",
      },
      {
        title: "Brain context packet",
        detail:
          "Typed chat and live voice share one context builder for memory, active-book summary, a retrieval hint that names the active and companion PDFs, a PDF manifest, balanced excerpts from multiple ready PDFs, and interaction timing before the foreground agent answers. Admin chips should show added, ready, excerpted, pending/failed, and omitted PDF counts for that packet.",
      },
      {
        title: "Brain-flow coverage",
        detail:
          "Beta Diagnostics checks chat context, voice context, chat and voice multi-PDF context, request correlation, foreground tools, evaluated mastery evidence, transcript saves, request-correlated memory rows, and model-observation gates as one local readiness proof. The top card turns that proof into a local brain architecture completion percentage: 100% only for complete local-live proof, 99% only for the final provider-proof binding gap, and cloud readiness stays deferred.",
      },
      {
        title: "Provider-ready proof",
        detail:
          "Provider-key proof treats completed model rows and provider-ready rows as separate evidence. Typed chat needs a completed OpenRouter-backed row for the selected request; live voice needs the server-side Deepgram Voice provider ready row; both provider rows must carry the shared Admin proof attempt id, and the local mock voice provider row never counts.",
      },
      {
        title: "Provider-key drill packet",
        detail:
          "The provider-key panel should turn the checklist into a runnable local drill: setup checklist, exact typed-chat and live-voice prompts, expected ledger rows, blockers, and export instructions. It guides beta proof without auto-starting provider calls or cloud work.",
      },
      {
        title: "Synthetic wiring rehearsal",
        detail:
          "Admin can exercise the shared multi-PDF packet helpers, typed-chat and live-voice tool definitions, matching shared tool schemas, and the same thirteen-signal verifier in memory only. The rehearsal is labeled synthetic and cannot raise live beta coverage.",
      },
      {
        title: "Validated confidence meters",
        detail:
          "Admin and revision evidence should separate audit-only model-summary proposals from flashcard reviews or evaluated answers that actually moved durable learner confidence through capped BKT-backed recall evidence, including the learning-book concept promotion status behind the attempt.",
      },
      {
        title: "Voice agent timeline",
        detail:
          "Live voice mode records local session start, proof-attempt id, voice-realtime agent layer, Deepgram settings, speaking/listening transitions, barge-in, tool requests, tool completions, transcript turns, and errors so the dark voice UI is debuggable from Admin. The proof-attempt id is latched at session start, keeping voice context, model, tool, transcript, and background-memory rows on one attempt even if Admin selection changes later.",
      },
      {
        title: "Voice current-page vision",
        detail:
          "Voice can inspect the currently rendered PDF page for page, screen, visible-diagram, and reading-context questions, then records that tool activity in Admin.",
      },
      {
        title: "Voice web search tool",
        detail:
          "Voice can call live web search for explicit web or freshness questions, while current-page, selected-text, document, and active-book questions keep the source-material-first path.",
      },
      {
        title: "Correction overlays",
        detail:
          "Mark-wrong, deletion-review, and supersede actions stay non-destructive in beta while affected rows gain visible correction state and corrected concepts quarantine confidence/mastery instead of keeping stale scores.",
      },
      {
        title: "Local citation checks",
        detail:
          "Source Artifacts keeps artifact readiness separate from citation verification and can run a local source-card integrity check without fetching external pages.",
      },
      {
        title: "Flashcard artifact rows",
        detail:
          "Generated flashcard batches now leave not-checked ArtifactRecord provenance, so Admin can tune study-card generation without treating it as external source proof.",
      },
      {
        title: "Learning-note artifact rows",
        detail:
          "Generated learning-book entries leave ArtifactRecord provenance, attach compact source-span anchors when document text exists, and run a local ledger-coherence check immediately. Notes with saved spans also report summary-preview to source-preview lexical support.",
      },
      {
        title: "Learning-note integrity checks",
        detail:
          "Admin can re-run generated-note checks when the local entry, book or conversation, citation link, saved source-span anchors, local preview-level lexical support, and no-external-fetch metadata agree. Shared preview terms are inspectable support, not semantic entailment or fact proof.",
      },
      {
        title: "Chapter audio guides",
        detail:
          "Every built-in Library chapter now attaches a Deepgram-generated guide asset with measured 3-4 minute duration metadata, one visible player for play, pause, speed, and seek. Bounded retry stays hidden inside that player, so the learner never sees a separate retry control.",
      },
      {
        title: "Audio generation dry-run",
        detail:
          "The generation plan lists every built-in book chapter, verifies checked-in MP3s locally, reports duration seconds, and regenerates assets through Deepgram Aura when a key is available.",
      },
      {
        title: "Diagnostics export",
        detail:
          "Exports are capped, local-only, and explicit about deferred cloud readiness, correction overlays, and out-of-scope automation.",
      },
    ];
    const visibleControlPatterns = controlPatterns.filter((pattern) =>
      [
        "Request timelines",
        "Brain context packet",
        "Provider-ready proof",
        "Voice agent timeline",
        "Correction overlays",
        "Diagnostics export",
      ].includes(pattern.title),
    );

    return (
      <div className="font-sans text-zinc-900">
        <div className="rounded-[34px] border border-zinc-200 bg-white/80 p-6 shadow-[0_24px_70px_rgba(46,36,22,0.12)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-500/70">
            Operator controls
          </div>
          <h3 className="mt-3 max-w-2xl text-3xl font-serif font-medium leading-tight">
            These controls exist to prove the learning loop before cloud
            deployment.
          </h3>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-600">
            Learners do not need these controls during ordinary study. They let
            an operator follow one request, inspect the context given to the
            tutor, confirm that real providers ran, review corrections, and
            export a bounded local-beta report. Once production observability
            exists, several of these local proof controls can be retired.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {visibleControlPatterns.map((pattern) => (
              <div
                key={pattern.title}
                className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4"
              >
                <div className="text-sm font-semibold text-zinc-950">
                  {pattern.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {pattern.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans text-zinc-900">
      <div className="grid gap-5 md:grid-cols-2">
        {snapshotCards.map((card) => (
          <GalleryPanel key={card.title} className="min-h-[250px]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                  Snapshot
                </div>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">
                  {card.title}
                </h3>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold text-zinc-400 shadow-sm">
                UI
              </div>
            </div>
            <div className="flex min-h-36 items-center justify-center rounded-[30px] bg-white/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <div className="w-full max-w-xs">
                <LiveComponentPreview id={card.id} />
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-500">
              {card.caption}
            </p>
          </GalleryPanel>
        ))}
      </div>
    </div>
  );
};

const builtInBooks: BuiltInBook[] = [
  {
    id: "tutor-book",
    name: "Tutor System Architecture",
    description:
      "Complete guide to the underlying pedagogical models and technical architecture of the AI Tutor.",
    hiddenKey: "tutor_book_hidden",
    chapters: tutorBook.map((chapter, index) => ({
      ...chapter,
      audioOverview:
        builtInBookAudioOverviews["tutor-book"]?.[index]?.chapterTitle ===
        chapter.title
          ? builtInBookAudioOverviews["tutor-book"]?.[index]
          : undefined,
    })),
  },
  {
    id: "user-brain-architecture",
    name: "User Brain Architecture",
    description:
      "A plain guide to the local learner-brain ledger, evidence gates, runtime traces, audio boundaries, and deferred cloud work.",
    hiddenKey: "user_brain_architecture_book_hidden",
    chapters: userBrainArchitectureBook.map((chapter, index) => ({
      ...chapter,
      audioOverview:
        userBrainChapterAudioOverviews[index]?.chapterTitle === chapter.title
          ? userBrainChapterAudioOverviews[index]
          : undefined,
    })),
  },
  {
    id: "app-design-language",
    name: "App Design Language",
    description:
      "Wireframe connections, theme rules, and rendered UI component snapshots for the Tutor interface.",
    hiddenKey: "app_design_language_book_hidden",
    chapters: [
      { title: "Wireframe Connections" },
      { title: "Theme System" },
      { title: "UI Component Snapshots" },
      { title: "Operator Controls And Why They Exist" },
    ].map((chapter, index) => ({
      ...chapter,
      audioOverview:
        builtInBookAudioOverviews["app-design-language"]?.[index]
          ?.chapterTitle === chapter.title
          ? builtInBookAudioOverviews["app-design-language"]?.[index]
          : undefined,
    })),
    renderChapter: (chapterIndex) => (
      <AppDesignLanguagePage chapterIndex={chapterIndex} />
    ),
  },
];

const builtInBookIds = new Set(builtInBooks.map((book) => book.id));

const createBuiltInBookConcept = (book: BuiltInBook): PersistentConcept => ({
  id: book.id,
  name: book.name,
  mastery: 0,
  confidence: 0,
  description: book.description,
  p_learn: 0.2,
  p_transit: 0.1,
  p_slip: 0.1,
  p_guess: 0.2,
  attempt_history: [],
  decay_factor: 1,
  prerequisites: [],
  relatedConcepts: [],
  sourcePages: [],
  revisionCount: 0,
  lastReviewedAt: Date.now(),
  firstLearnedAt: Date.now(),
  linkedAnnotations: [],
});

const LongPressWrapper = ({
  onLongPress,
  onClick,
  ariaLabel,
  children,
}: {
  onLongPress: () => void;
  onClick: () => void;
  ariaLabel?: string;
  children: (pressing: boolean) => React.ReactNode;
}) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const mounted = useRef(true);
  const [pressing, setPressing] = useState(false);

  const clearTimer = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clearPress = React.useCallback(() => {
    clearTimer();
    if (mounted.current) setPressing(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return (
    <div
      onPointerDown={() => {
        isLongPress.current = false;
        setPressing(true);
        timer.current = setTimeout(() => {
          if (!mounted.current) return;
          isLongPress.current = true;
          setPressing(false);
          onLongPress();
        }, 800);
      }}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onClick={() => {
        if (!isLongPress.current) {
          onClick();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        clearPress();
        onClick();
      }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="relative cursor-pointer select-none"
    >
      {children(pressing)}
    </div>
  );
};

const FlashcardUI = React.memo(
  ({
    card,
    onReview,
  }: {
    card: Flashcard;
    onReview: (quality: number) => void;
  }) => {
    const [flipped, setFlipped] = useState(false);
    const toggleCard = React.useCallback(() => {
      setFlipped((value) => !value);
    }, []);
    const onToggleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleCard();
      },
      [toggleCard],
    );

    return (
      <div className="w-full max-w-md mx-auto mb-8 h-[280px] relative perspective-[1000px]">
        <div
          className="w-full h-full relative"
          style={{
            transform: `rotateY(${flipped ? 180 : 0}deg)`,
            transformStyle: "preserve-3d",
            transition: "transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-6 bg-[#0A0A0B] border border-white/10 rounded-2xl shadow-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#0A0A0B]"
            style={{
              opacity: flipped ? 0 : 1,
              transition: `opacity 120ms ease ${flipped ? "0ms" : "100ms"}`,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              pointerEvents: flipped ? "none" : "auto",
            }}
            role="button"
            tabIndex={flipped ? -1 : 0}
            aria-label="Show flashcard answer"
            aria-pressed={flipped}
            onClick={toggleCard}
            onKeyDown={onToggleKeyDown}
          >
            <div className="text-center overflow-y-auto">
              <span className="text-xs font-mono text-zinc-500 mb-4 block">
                QUESTION
              </span>
              <p className="text-lg font-serif text-white">{card.front}</p>
            </div>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 w-full h-full flex flex-col p-6 bg-white/5 border border-white/10 rounded-2xl shadow-xl bg-gradient-to-br from-[#1A1A1E] to-[#0A0A0B]"
            style={{
              transform: "rotateY(180deg)",
              opacity: flipped ? 1 : 0,
              transition: `opacity 120ms ease ${flipped ? "100ms" : "0ms"}`,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              pointerEvents: flipped ? "auto" : "none",
            }}
          >
            <div className="flex-1 flex items-center justify-center text-center mb-4 overflow-y-auto w-full">
              <div
                className="w-full cursor-pointer rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-[#0A0A0B]"
                role="button"
                tabIndex={flipped ? 0 : -1}
                aria-label="Show flashcard question"
                aria-pressed={flipped}
                onClick={toggleCard}
                onKeyDown={onToggleKeyDown}
              >
                <span className="text-xs font-mono text-zinc-500 mb-2 block">
                  ANSWER
                </span>
                <p className="text-[15px] font-serif text-white leading-relaxed">
                  {card.back}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 border-t border-white/5 pt-3 mt-auto shrink-0 relative z-10 w-full">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped(false);
                  onReview(0);
                }}
                className="text-[10px] font-mono py-2 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                AGAIN
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped(false);
                  onReview(2);
                }}
                className="text-[10px] font-mono py-2 rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
              >
                HARD
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped(false);
                  onReview(4);
                }}
                className="text-[10px] font-mono py-2 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
              >
                GOOD
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped(false);
                  onReview(5);
                }}
                className="text-[10px] font-mono py-2 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                EASY
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

const FlashcardDeck = ({
  cards,
  totalCount,
  dueCount,
  onReview,
}: {
  cards: Flashcard[];
  totalCount: number;
  dueCount: number;
  onReview: (card: Flashcard, quality: number) => void;
}) => {
  if (cards.length === 0) return null;

  return (
    <div className="rounded-[28px] border border-zinc-900/10 bg-white/55 p-5 shadow-[0_24px_70px_rgba(46,36,22,0.14)] backdrop-blur-sm md:p-7">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-yellow-700">
            <Zap size={16} />
            Active Recall
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Flashcards
          </h2>
        </div>
        <div className="rounded-full border border-zinc-900/10 bg-[#faf9f6] px-3 py-1.5 text-xs font-medium text-zinc-600">
          {dueCount > 0 ? `${dueCount} due now` : `Next review queued`} ·{" "}
          {totalCount} total
        </div>
      </div>

      {cards.slice(0, 1).map((card) => (
        <div key={card.id}>
          <FlashcardUI
            card={card}
            onReview={(quality) => onReview(card, quality)}
          />
        </div>
      ))}
    </div>
  );
};

export function RevisionView() {
  const setActiveView = useStore((state) => state.setActiveView);
  const accessMode = useStore((state) => state.accessMode);
  const motionEnabled = useMotionPreference();
  const activeLearningBookId = useStore((state) => state.activeLearningBookId);
  const setActiveLearningBookId = useStore(
    (state) => state.setActiveLearningBookId,
  );
  const setActiveDocumentId = useStore((state) => state.setActiveDocumentId);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const brainRuntimeSettings = useStore((state) => state.brainRuntimeSettings);
  const activeUserId = useStore((state) => state.activeUserId);
  const learnerName = useStore((state) => state.learnerName);
  const [libraryRevision, setLibraryRevision] = useState(0);

  const concepts = React.useMemo(
    () =>
      builtInBooks
        .filter((book) => localStorage.getItem(book.hiddenKey) !== "1")
        .map(createBuiltInBookConcept),
    [libraryRevision],
  );

  const queriedLearningBooks = useLiveQuery(
    () => db.learningBooks.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const learningBooks = queriedLearningBooks || [];
  const scopedLearningBooks = React.useMemo(() => {
    const matches = learningBooks.filter((book) =>
      book.userId
        ? book.userId === activeUserId
        : book.userName === learnerName,
    );
    return matches.length > 0 ? matches : learningBooks;
  }, [activeUserId, learnerName, learningBooks]);
  const visibleLearningBooks = React.useMemo(() => {
    const general =
      scopedLearningBooks.find((book) =>
        book.id.startsWith(GENERAL_STUDY_BOOK_ID),
      ) ||
      scopedLearningBooks.find((book) =>
        /^general study$/i.test(book.title.trim()),
      );
    const seen = new Set<string>();
    const result: LearningBook[] = [];
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
  const queriedLearningBookConcepts = useLiveQuery(
    () => db.learningBookConcepts.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const learningBookConcepts = queriedLearningBookConcepts || [];
  const queriedLearningEntries = useLiveQuery(
    () => db.learningEntries.orderBy("timestamp").reverse().limit(50).toArray(),
    [],
  );
  const learningEntries = queriedLearningEntries || [];

  const queriedFlashcards = useLiveQuery(async () => {
    try {
      return await db.flashcards.toArray();
    } catch (error) {
      console.warn("[RevisionView] Flashcards unavailable:", error);
      return [];
    }
  }, []);
  const flashcards = queriedFlashcards || [];
  const isLibraryLoading =
    queriedLearningBooks === undefined ||
    queriedLearningBookConcepts === undefined ||
    queriedLearningEntries === undefined ||
    queriedFlashcards === undefined;

  const conceptsByBookId = React.useMemo(() => {
    const map = new Map<string, typeof learningBookConcepts>();
    learningBookConcepts.forEach((concept) => {
      const bucket = map.get(concept.bookId) || [];
      bucket.push(concept);
      map.set(concept.bookId, bucket);
    });
    return map;
  }, [learningBookConcepts]);

  const entriesByBookId = React.useMemo(() => {
    const map = new Map<string, typeof learningEntries>();
    learningEntries.forEach((entry) => {
      const bucket = map.get(entry.bookId) || [];
      bucket.push(entry);
      map.set(entry.bookId, bucket);
    });
    return map;
  }, [learningEntries]);

  const flashcardsByBookId = React.useMemo(() => {
    const map = new Map<string, Flashcard[]>();
    flashcards.forEach((card) => {
      if (!card.bookId) return;
      const bucket = map.get(card.bookId) || [];
      bucket.push(card);
      map.set(card.bookId, bucket);
    });
    return map;
  }, [flashcards]);

  const generalStudyFlashcards = React.useMemo(
    () => flashcards.filter((card) => !card.bookId),
    [flashcards],
  );

  const [activeConceptId, setActiveConceptId] = useState<string | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<LibraryDeleteTarget | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const learningBookRowRefs = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    const unhideCoreKey = "revision_core_books_visible_v1";
    if (localStorage.getItem(unhideCoreKey) !== "1") {
      try {
        localStorage.removeItem("tutor_book_hidden");
        localStorage.removeItem("app_design_language_book_hidden");
        localStorage.setItem(unhideCoreKey, "1");
        setLibraryRevision((version) => version + 1);
      } catch (error) {
        console.warn(
          "[RevisionView] Core book visibility sync skipped:",
          error,
        );
      }
    }
  }, []);

  useLayoutEffect(() => {
    if (activeConceptId || visibleLearningBooks.length === 0) return;
    const rows = learningBookRowRefs.current.filter(Boolean);
    if (!rows.length) return;

    gsap.killTweensOf(rows);
    if (!motionEnabled || document.hidden) {
      gsap.set(rows, { autoAlpha: 1, y: 0, filter: "blur(0px)" });
      return;
    }

    gsap.fromTo(
      rows,
      { autoAlpha: 0, y: 18, filter: "blur(8px)" },
      {
        autoAlpha: 1,
        y: 0,
        filter: "blur(0px)",
        duration: 0.44,
        stagger: 0.055,
        ease: "power3.out",
      },
    );

    return () => {
      gsap.killTweensOf(rows);
    };
  }, [activeConceptId, motionEnabled, visibleLearningBooks.length]);

  const handleReview = async (card: Flashcard, quality: number) => {
    const nextDays = quality >= 4 ? 3 * (quality - 2) : 1;
    await db.flashcards.update(card.id, {
      nextReviewAt: Date.now() + nextDays * 24 * 60 * 60 * 1000,
    });
    try {
      await recordFlashcardReviewEvidence(card, quality, {
        userId: activeUserId,
        runtimeSettings: brainRuntimeSettings,
      });
    } catch (error) {
      console.warn("[RevisionView] Flashcard evidence write failed:", error);
    }
  };

  const sampleNotes = React.useMemo<Record<string, string>>(
    () => ({
      "tutor-book": tutorBook
        .map((chapter) => chapter.content)
        .join("\n\n---\n\n"),
      "user-brain-architecture": userBrainArchitectureBook
        .map((chapter) => chapter.content)
        .join("\n\n---\n\n"),
    }),
    [],
  );

  const activeConcept = concepts.find((c) => c.id === activeConceptId);
  const activeBuiltInBook = builtInBooks.find(
    (book) => book.id === activeConcept?.id,
  );
  const activeLearningBook = scopedLearningBooks.find(
    (book) => book.id === activeConceptId,
  );
  const flashcardsForBook = React.useCallback(
    (book: LearningBook) => {
      const directCards = flashcardsByBookId.get(book.id) || [];
      if (book.title.toLowerCase() !== "general study") return directCards;
      return [...directCards, ...generalStudyFlashcards];
    },
    [flashcardsByBookId, generalStudyFlashcards],
  );
  const activeBookFlashcards = React.useMemo(
    () => (activeLearningBook ? flashcardsForBook(activeLearningBook) : []),
    [activeLearningBook, flashcardsForBook],
  );
  const activeDueFlashcards = React.useMemo(() => {
    const now = Date.now();
    return activeBookFlashcards
      .filter((card) => card.nextReviewAt <= now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
  }, [activeBookFlashcards]);
  const activeReviewQueue = React.useMemo(
    () =>
      activeDueFlashcards.length > 0
        ? activeDueFlashcards
        : [...activeBookFlashcards].sort(
            (a, b) => a.nextReviewAt - b.nextReviewAt,
          ),
    [activeBookFlashcards, activeDueFlashcards],
  );

  useEffect(() => {
    const pendingBookId = localStorage.getItem("revision_open_book_id");
    if (!pendingBookId) return;
    const canOpenBook =
      builtInBookIds.has(pendingBookId) ||
      scopedLearningBooks.some((book) => book.id === pendingBookId);
    if (!canOpenBook) return;
    setCurrentChapterIndex(0);
    setActiveConceptId(pendingBookId);
    const generatedBook = scopedLearningBooks.find(
      (book) => book.id === pendingBookId,
    );
    if (generatedBook) {
      setActiveLearningBookId(generatedBook.id);
      setActiveProject(generatedBook.title);
    }
    scrollBookToTop("auto");
    localStorage.removeItem("revision_open_book_id");
  }, [scopedLearningBooks, setActiveLearningBookId, setActiveProject]);

  const cleanRevisionNote = React.useCallback(
    (value?: string) =>
      String(value || "")
        .replace(/\bPrompt:\s*/gi, "")
        .replace(/\bLearning note:\s*/gi, "")
        .replace(
          /\bReview hook:\s*restate the idea in your own words, identify the key mechanism, and test it with a fresh example\.?/gi,
          "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    [],
  );

  const learningBookMarkdown = React.useCallback(
    (book: LearningBook) => {
      const conceptsForBook = conceptsByBookId.get(book.id) || [];
      const entriesForBook = entriesByBookId.get(book.id) || [];
      const chapterText = (book.chapters || []).length
        ? book.chapters
            .map((chapter, index) => {
              const chapterConceptIds = new Set(chapter.conceptIds);
              const chapterConcepts = conceptsForBook
                .filter((concept) => chapterConceptIds.has(concept.id))
                .map((concept) => concept.name);
              return `### Chapter ${index + 1}: ${chapter.title}\n${cleanRevisionNote(chapter.summary) || "Chapter summary pending."}${chapterConcepts.length ? `\n\nConcepts: ${chapterConcepts.join(", ")}` : ""}`;
            })
            .join("\n\n")
        : "No chapters mapped yet.";
      const conceptText = conceptsForBook.length
        ? conceptsForBook
            .map((concept) => {
              const branches = concept.childConcepts.length
                ? `\n  - Branches: ${concept.childConcepts.join(", ")}`
                : "";
              const parents = concept.parentConcepts.length
                ? `\n  - Parent concepts: ${concept.parentConcepts.join(", ")}`
                : "";
              return `### ${concept.name}\n${cleanRevisionNote(concept.summary) || "Summary pending."}${parents}${branches}`;
            })
            .join("\n\n")
        : "No concepts mapped yet.";
      const entryText = entriesForBook
        .slice(0, 5)
        .map(
          (entry, index) =>
            `### Page ${index + 1}\n${cleanRevisionNote(entry.conversationSummary || entry.assistantSummary) || "Learning note pending."}`,
        )
        .join("\n\n");
      return `## Overview\n${cleanRevisionNote(book.overview) || "Overview pending."}\n\n## Knowledge Summary\n${cleanRevisionNote(book.knowledgeSummary || book.summary) || "Summary pending."}\n\n## Chapters\n${chapterText}\n\n## Mapped Concepts\n${conceptText}\n\n## Learning Pages\n${entryText || "No learning notes recorded yet."}`;
    },
    [cleanRevisionNote, conceptsByBookId, entriesByBookId],
  );

  const formatLearningChapterPage = React.useCallback(
    (book: LearningBook, index: number) => {
      const chapter = book.chapters?.[index];
      if (!chapter) return learningBookMarkdown(book);
      const chapterConceptIds = new Set(chapter.conceptIds);
      const conceptsForChapter = (conceptsByBookId.get(book.id) || []).filter(
        (concept) => chapterConceptIds.has(concept.id),
      );
      const note =
        cleanRevisionNote(chapter.summary) ||
        cleanRevisionNote(book.summary) ||
        "This chapter is ready for notes from the next tutor exchange.";
      const conceptText = conceptsForChapter.length
        ? conceptsForChapter
            .map(
              (concept) =>
                `### ${concept.name}\n${cleanRevisionNote(concept.summary) || "A fuller explanation will be added after the next supported lesson."}`,
            )
            .join("\n\n")
        : "This chapter has not yet separated its main idea into smaller concepts.";
      const chapterEntries = (entriesByBookId.get(book.id) || []).filter(
        (entry) =>
          entry.learnedConcepts.some((conceptId) =>
            chapterConceptIds.has(conceptId),
          ),
      );
      const example =
        cleanRevisionNote(
          chapterEntries[0]?.assistantSummary ||
            chapterEntries[0]?.conversationSummary,
        ) ||
        "Create a new example that uses the chapter's main mechanism in a different situation.";
      const diagramNodes = conceptsForChapter.slice(0, 6);
      const diagram = diagramNodes.length
        ? [
            "```mermaid",
            "flowchart LR",
            `  idea["${chapter.title.replace(/"/g, "'")}"]`,
            ...diagramNodes.map(
              (concept, conceptIndex) =>
                `  concept${conceptIndex}["${concept.name.replace(/"/g, "'")}"]`,
            ),
            ...diagramNodes.map(
              (_, conceptIndex) => `  idea --> concept${conceptIndex}`,
            ),
            "```",
          ].join("\n")
        : "";
      return `## The Big Idea\n\n${note}\n\n## How The Ideas Connect\n\n${conceptText}\n\n${diagram ? `## Visual Map\n\n${diagram}\n\n` : ""}## Worked Example\n\n${example}\n\n## Check Your Understanding\n\nExplain the main idea without looking back. Then name the mechanism that makes it work and apply it to one fresh example. If this is a programming chapter, write or modify a short code sample and predict its output before running it.`;
    },
    [
      cleanRevisionNote,
      conceptsByBookId,
      entriesByBookId,
      learningBookMarkdown,
    ],
  );
  const isBuiltInBook = Boolean(activeBuiltInBook);
  const activeTitle = activeLearningBook?.title || activeConcept?.name || "";
  const activeChapterCount = activeBuiltInBook
    ? activeBuiltInBook.chapters.length
    : activeLearningBook?.chapters?.length || 0;
  const activeBuiltInChapter = activeBuiltInBook?.chapters[currentChapterIndex];
  const activeMarkdown = React.useMemo(() => {
    if (activeBuiltInBook) {
      return activeBuiltInBook.chapters[currentChapterIndex]?.content || "";
    }
    if (activeLearningBook) {
      return activeLearningBook.chapters &&
        activeLearningBook.chapters.length > 0
        ? formatLearningChapterPage(activeLearningBook, currentChapterIndex)
        : learningBookMarkdown(activeLearningBook);
    }
    if (!activeConcept) return "";
    return (
      sampleNotes[activeConcept.id as keyof typeof sampleNotes] ||
      activeConcept.description ||
      "Notes unavailable."
    );
  }, [
    activeBuiltInBook,
    activeConcept,
    activeLearningBook,
    currentChapterIndex,
    formatLearningChapterPage,
    learningBookMarkdown,
    sampleNotes,
  ]);

  const scrollBookToTop = (behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior });
    });
  };

  const returnToLibrary = () => {
    setActiveConceptId(null);
    setCurrentChapterIndex(0);
    scrollBookToTop("auto");
  };

  const selectChapter = (index: number) => {
    setCurrentChapterIndex(index);
    scrollBookToTop();
  };

  const deleteLearningBookRecords = React.useCallback(
    async (bookId: string) => {
      await db.transaction(
        "rw",
        [
          db.learningBooks,
          db.learningBookConcepts,
          db.learningEntries,
          db.learningDocuments,
          db.bookChatThreads,
          db.flashcards,
        ],
        async () => {
          const relatedFlashcardIds = (
            await db.flashcards
              .filter((card) => card.bookId === bookId)
              .toArray()
          ).map((card) => card.id);
          await db.learningBookConcepts.where("bookId").equals(bookId).delete();
          await db.learningEntries.where("bookId").equals(bookId).delete();
          await db.learningDocuments.where("bookId").equals(bookId).delete();
          await db.bookChatThreads.where("bookId").equals(bookId).delete();
          if (relatedFlashcardIds.length > 0) {
            await db.flashcards.bulkDelete(relatedFlashcardIds);
          }
          await db.learningBooks.delete(bookId);
        },
      );
    },
    [],
  );

  const deleteConcept = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "built-in") {
        const builtInDeleteTarget = builtInBooks.find(
          (book) => book.id === deleteTarget.id,
        );
        if (builtInDeleteTarget) {
          localStorage.setItem(builtInDeleteTarget.hiddenKey, "1");
        }
        setLibraryRevision((version) => version + 1);
      } else {
        await deleteLearningBookRecords(deleteTarget.id);
        if (activeLearningBookId === deleteTarget.id) {
          setActiveLearningBookId(null);
          setActiveDocumentId(null);
          setActiveProject("General Study");
        }
      }
    } catch (error) {
      console.warn(
        "[RevisionView] Book delete could not update IndexedDB:",
        error,
      );
    }
    if (activeConceptId === deleteTarget.id) {
      setActiveConceptId(null);
    }
    setDeleteTarget(null);
  };

  return (
    <div
      ref={scrollRef}
      className="w-full h-full bg-[#faf9f6] text-zinc-900 flex flex-col overflow-y-auto custom-scroll pt-[4.75rem] lg:pt-0 relative"
    >
      {/* Subtle Paper Texture Overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noise%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noise)%22/%3E%3C/svg%3E")',
        }}
      />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[4.75rem] bg-[#faf9f6] lg:hidden"
        aria-hidden="true"
      />
      {activeConcept || activeLearningBook ? (
        <div className="min-h-full flex w-full relative z-10 pt-0 lg:pt-24 shrink-0">
          {/* Sidebar Navigation */}
          {(isBuiltInBook || activeLearningBook) && (
            <div className="sticky top-24 hidden h-[calc(100vh-96px)] w-72 flex-shrink-0 flex-col overflow-hidden border-r border-zinc-200/50 bg-[#faf9f6] px-4 py-5 self-start lg:flex">
              <div className="z-20 flex-shrink-0 border-b border-zinc-200/70 bg-[#faf9f6] pb-4 shadow-[0_14px_28px_rgba(250,249,246,0.96)]">
                <div className="mb-3 line-clamp-2 px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
                  {activeTitle}
                </div>
                <button
                  onClick={returnToLibrary}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <Menu size={16} /> Back to Library
                </button>
                <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest mt-6 px-3">
                  Contents
                </div>
              </div>
              <nav className="custom-scroll -mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-4 pr-2">
                {(
                  activeBuiltInBook?.chapters ||
                  activeLearningBook?.chapters ||
                  []
                ).map((ch: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => selectChapter(idx)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ${idx === currentChapterIndex ? "bg-zinc-900 text-white font-medium shadow-sm border border-zinc-900" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 border border-transparent"}`}
                  >
                    <span className="line-clamp-2 leading-snug">
                      {ch.title}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          )}

          <div className="flex-1 flex flex-col w-full relative">
            {/* Compact mobile book chrome */}
            <div className="sticky left-0 right-0 top-0 z-50 border-b border-zinc-200/70 bg-[#faf9f6] shadow-[0_14px_28px_rgba(250,249,246,0.98)] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-6 after:h-6 after:bg-[#faf9f6] after:content-[''] lg:hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
                <button
                  onClick={returnToLibrary}
                  className="flex shrink-0 items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
                >
                  <Menu size={16} /> Back to Library
                </button>
                <div className="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-wide text-zinc-800 sm:text-center md:max-w-md">
                  {activeTitle}
                </div>
                <div className="hidden w-10 shrink-0 sm:block"></div>
              </div>
              {(isBuiltInBook || activeLearningBook) && (
                <div className="border-t border-zinc-200/70 px-4 pb-3 pt-3 md:px-6">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                    Contents
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 custom-scroll">
                    {(
                      activeBuiltInBook?.chapters ||
                      activeLearningBook?.chapters ||
                      []
                    ).map((ch: any, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => selectChapter(idx)}
                        className={`max-w-[min(220px,70vw)] shrink-0 rounded-full border px-3 py-2 text-left text-xs transition-colors ${idx === currentChapterIndex ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"}`}
                      >
                        <span className="line-clamp-1">{ch.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative isolate mx-auto w-full max-w-4xl flex-1 p-5 pt-6 sm:p-6 md:p-10 lg:p-16 xl:p-20">
              <div
                key={currentChapterIndex}
                className="relative z-10 font-serif pb-12"
              >
                <div className="mb-10 border-b border-zinc-200 pb-8 pt-4 font-sans cursor-default">
                  <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-zinc-400 mb-6 block font-medium">
                    <span className="text-zinc-500 mr-2">#</span>
                    {isBuiltInBook
                      ? "Documentation"
                      : activeLearningBook
                        ? "Learning Book"
                        : "Concept Overview"}
                  </span>
                  <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight text-zinc-900 mb-6 font-serif leading-[1.15]">
                    {activeBuiltInBook
                      ? activeBuiltInBook.chapters[currentChapterIndex]?.title
                      : activeLearningBook
                        ? activeLearningBook.chapters?.[currentChapterIndex]
                            ?.title || activeTitle
                        : activeTitle}
                  </h1>
                </div>

                {activeBuiltInChapter?.audioOverview && (
                  <StoredAudioOverview
                    overview={activeBuiltInChapter.audioOverview}
                  />
                )}

                {activeBuiltInBook?.renderChapter ? (
                  activeBuiltInBook.renderChapter(currentChapterIndex)
                ) : (
                  <div className="prose prose-zinc w-full max-w-none prose-sm md:prose-base font-serif prose-a:text-blue-700 prose-a:decoration-blue-300 prose-a:underline-offset-4 prose-a:hover:text-blue-900 prose-p:leading-[1.8] prose-p:text-zinc-800 prose-p:font-light prose-p:my-5 prose-headings:font-serif prose-headings:font-medium prose-headings:tracking-tight prose-h2:text-2xl prose-h2:mt-14 prose-h2:mb-5 prose-h2:border-b prose-h2:border-zinc-200/80 prose-h2:pb-3 prose-h2:text-zinc-900 prose-h3:text-lg prose-h3:mt-10 prose-h3:mb-3 prose-h3:text-zinc-900 prose-li:leading-[1.75] prose-li:text-zinc-800 prose-li:font-light prose-li:my-1.5 prose-li:marker:text-zinc-400 prose-ul:my-5 prose-ol:my-5 prose-pre:bg-zinc-100 prose-pre:text-zinc-800 prose-pre:border prose-pre:border-zinc-200 prose-pre:shadow-inner prose-pre:my-8 prose-code:before:content-none prose-code:after:content-none prose-code:bg-transparent prose-code:px-0 prose-code:py-0 prose-code:font-mono prose-code:text-[0.88em] prose-code:font-normal prose-code:text-zinc-700 prose-strong:text-zinc-900 prose-strong:font-medium selection:bg-zinc-200 selection:text-zinc-950">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, ...props }) => {
                          const isExternal = href?.startsWith("http");
                          return (
                            <a
                              {...props}
                              href={href}
                              target={isExternal ? "_blank" : undefined}
                              rel={
                                isExternal ? "noopener noreferrer" : undefined
                              }
                            >
                              {children}
                            </a>
                          );
                        },
                        code: ({ className, children, ...props }) => {
                          const language =
                            /language-([\w-]+)/.exec(className || "")?.[1] ||
                            "";
                          const code = String(children).replace(/\n$/, "");
                          if (language === "mermaid") {
                            return (
                              <RevisionMermaid
                                chart={code}
                                variant={
                                  activeBuiltInBook?.id ===
                                  "user-brain-architecture"
                                    ? "gemini"
                                    : "default"
                                }
                              />
                            );
                          }
                          if (language === "interaction-runtime") {
                            return <InteractionRuntimeDiagram />;
                          }
                          return (
                            <code {...props} className={className}>
                              {children}
                            </code>
                          );
                        },
                        img: ({ alt, ...props }) => (
                          <img
                            {...props}
                            alt={alt || ""}
                            className="not-prose my-8 w-full rounded-lg border border-zinc-200 shadow-[0_18px_48px_rgba(24,24,27,0.14)]"
                          />
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="not-prose not-italic my-8 rounded-2xl border border-amber-200/80 bg-amber-50/70 px-5 py-4 font-sans text-[15px] leading-relaxed text-amber-950 shadow-sm [&>p]:my-1 [&_strong]:font-semibold [&_strong]:text-amber-900">
                            {children}
                          </blockquote>
                        ),
                        table: ({ children }) => (
                          <div className="not-prose my-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white/70 shadow-sm">
                            <table className="w-full border-collapse text-left font-sans text-sm text-zinc-700">
                              {children}
                            </table>
                          </div>
                        ),
                        th: ({ children }) => (
                          <th className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase tracking-normal text-zinc-500">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border-b border-zinc-100 px-4 py-3 align-top leading-6 text-zinc-700">
                            {children}
                          </td>
                        ),
                      }}
                    >
                      {activeMarkdown}
                    </ReactMarkdown>
                  </div>
                )}
              </div>

              {(isBuiltInBook || activeLearningBook) &&
                activeChapterCount > 1 && (
                  <div className="flex justify-between items-center mt-12 pt-8 border-t border-zinc-200/50 font-sans">
                    <button
                      disabled={currentChapterIndex === 0}
                      onClick={() => {
                        selectChapter(Math.max(0, currentChapterIndex - 1));
                      }}
                      className="px-5 py-2.5 rounded-full border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none transition-[color,background-color,border-color,box-shadow,transform,opacity] flex items-center gap-2"
                    >
                      &larr; Previous
                    </button>
                    <button
                      disabled={currentChapterIndex === activeChapterCount - 1}
                      onClick={() => {
                        selectChapter(
                          Math.min(
                            activeChapterCount - 1,
                            currentChapterIndex + 1,
                          ),
                        );
                      }}
                      className="px-5 py-2.5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-40 disabled:pointer-events-none transition-[color,background-color,border-color,box-shadow,transform,opacity] flex items-center gap-2 shadow-sm"
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}

              {activeLearningBook && activeBookFlashcards.length > 0 && (
                <div className="mt-20 border-t border-zinc-200 pt-16 font-sans">
                  <FlashcardDeck
                    cards={activeReviewQueue}
                    totalCount={activeBookFlashcards.length}
                    dueCount={activeDueFlashcards.length}
                    onReview={handleReview}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 md:p-12 lg:p-16">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-3 md:mb-16">
            <h1 className="text-3xl md:text-4xl font-medium tracking-tight text-zinc-900 mb-2">
              Library
            </h1>
            <div className="text-sm font-mono text-zinc-500">
              {visibleLearningBooks.length +
                concepts.length +
                (accessMode === "admin" ? 1 : 0)}{" "}
              Books
            </div>
          </div>

          {visibleLearningBooks.length > 0 && (
            <section
              className="mb-8 overflow-hidden rounded-[30px] border border-zinc-200/80 bg-white/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_22px_60px_rgba(46,36,22,0.06)] backdrop-blur-sm sm:p-4 md:mb-10"
              aria-label="Generated learning books"
            >
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-2 pt-1">
                <div>
                  <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-zinc-400">
                    Saved from study
                  </div>
                  <h2 className="mt-1 text-lg font-medium tracking-tight text-zinc-950">
                    Learning books
                  </h2>
                </div>
                <div className="rounded-full border border-zinc-200 bg-[#faf9f6] px-3 py-1 text-xs font-medium text-zinc-500">
                  {visibleLearningBooks.length} active
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {visibleLearningBooks.map((book, index) => {
                  const conceptCount =
                    conceptsByBookId.get(book.id)?.length || 0;
                  const cardCount = flashcardsForBook(book).length;
                  const preview =
                    book.overview ||
                    book.knowledgeSummary ||
                    book.summary ||
                    "DeepSeek trace is building this map.";
                  return (
                    <div
                      key={book.id}
                      ref={(node) => {
                        if (node) learningBookRowRefs.current[index] = node;
                      }}
                      className="opacity-0"
                    >
                      <LongPressWrapper
                        ariaLabel={`Open learning book ${book.title}`}
                        onLongPress={() =>
                          setDeleteTarget({
                            id: book.id,
                            name: book.title,
                            kind: "learning",
                          })
                        }
                        onClick={() => {
                          setCurrentChapterIndex(0);
                          setActiveConceptId(book.id);
                          setActiveLearningBookId(book.id);
                          setActiveProject(book.title);
                          scrollBookToTop("auto");
                        }}
                      >
                        {(pressing) => (
                          <div
                            className={`group relative flex min-h-[92px] cursor-pointer items-center gap-4 overflow-hidden rounded-[24px] border px-4 py-4 transition-[border-color,background-color,box-shadow,transform] duration-300 sm:px-5 ${
                              pressing
                                ? "border-orange-300 bg-orange-50/80 shadow-[0_18px_50px_rgba(255,110,0,0.13)] scale-[0.992]"
                                : "border-zinc-200/80 bg-[#faf9f6]/80 shadow-[0_12px_34px_rgba(46,36,22,0.04)] hover:border-zinc-300 hover:bg-white hover:shadow-[0_18px_46px_rgba(46,36,22,0.08)]"
                            }`}
                          >
                            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(46,36,22,0.08)]">
                              <BookOpen size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-zinc-400">
                                <span>Learning Book</span>
                                <span className="h-1 w-1 rounded-full bg-zinc-300" />
                                <span>{conceptCount} concepts</span>
                                {cardCount > 0 && (
                                  <>
                                    <span className="h-1 w-1 rounded-full bg-zinc-300" />
                                    <span>{cardCount} cards</span>
                                  </>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[17px] font-medium tracking-tight text-zinc-950 sm:text-[19px]">
                                {book.title}
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500">
                                {preview}
                              </p>
                            </div>
                            <div className="hidden shrink-0 rounded-full border border-zinc-200 bg-white p-2 text-zinc-400 transition-colors group-hover:text-zinc-900 sm:block">
                              <ChevronRight size={17} />
                            </div>
                          </div>
                        )}
                      </LongPressWrapper>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {visibleLearningBooks.length === 0 &&
              concepts.length === 0 &&
              (isLibraryLoading ? (
                <div
                  className="col-span-full h-64 flex items-center justify-center text-zinc-500 border border-white/10 border-dashed rounded-3xl"
                  role="status"
                  aria-live="polite"
                >
                  Loading revision library...
                </div>
              ) : (
                <div className="col-span-full h-64 flex items-center justify-center text-zinc-500 border border-white/10 border-dashed rounded-3xl">
                  No books discovered yet. Start chatting to learn new concepts.
                </div>
              ))}
            {concepts.map((concept, index) => {
              const theme = themes[index % themes.length];
              return (
                <LongPressWrapper
                  key={concept.id}
                  ariaLabel={`Open built-in book ${concept.name}`}
                  onLongPress={() =>
                    setDeleteTarget({
                      id: concept.id,
                      name: concept.name,
                      kind: "built-in",
                    })
                  }
                  onClick={() => {
                    setCurrentChapterIndex(0);
                    setActiveConceptId(concept.id);
                    scrollBookToTop("auto");
                  }}
                >
                  {(pressing) => (
                    <PatternCard
                      layoutId={`card-${concept.id}`}
                      bgClass={theme.bg}
                      SvgComponent={theme.SvgComponent}
                      bloomColor={theme.bloom}
                      bloomOpacity={theme.bloomOpacity}
                      interactive={false}
                      isPressing={pressing}
                      pressDotColor={
                        theme.text.includes("1f1f1f") ? "#ff6e00" : "#fefefe"
                      }
                      pressRingColor={
                        theme.text.includes("1f1f1f")
                          ? "rgba(255,110,0,0.58)"
                          : "rgba(254,254,254,0.58)"
                      }
                    >
                      <div className="absolute flex flex-col bottom-[38px] left-[38px] right-[38px] gap-[7px] z-20 pointer-events-none">
                        <div
                          className={`text-[25px] font-medium tracking-tight leading-[1.05] ${theme.text}`}
                        >
                          {concept.name}
                        </div>
                        <div
                          className={`text-[16px] font-light tracking-tight leading-[1.25] opacity-70 ${theme.text}`}
                        >
                          {concept.description}
                        </div>
                      </div>
                    </PatternCard>
                  )}
                </LongPressWrapper>
              );
            })}

            {accessMode === "admin" && (
              <PatternCard
                layoutId="card-admin-dashboard"
                onClick={() => setActiveView("admin")}
                bgClass="bg-[#ecebe9]"
                SvgComponent={SvgBeige}
                bloomColor="rgb(255, 110, 0)"
                bloomOpacity={0.18}
              >
                <div className="absolute flex flex-col bottom-[38px] left-[38px] right-[38px] gap-[7px] z-20 pointer-events-none">
                  <div className="p-3 rounded-full w-fit mb-2 transition-colors bg-[#ff6e00]/10 text-[#ff6e00]">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="text-[25px] font-medium tracking-tight leading-[1.05] text-[#1f1f1f]">
                    Admin
                    <br />
                    Dashboard
                  </div>
                  <div className="text-[16px] font-light tracking-tight leading-[1.25] opacity-70 text-[#1f1f1f]">
                    View live DeepSeek LLM traces and server console logs.
                  </div>
                </div>
              </PatternCard>
            )}
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-zinc-950/35 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-900/10 bg-[#faf9f6] p-6 shadow-[0_30px_90px_rgba(46,36,22,0.28)]">
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.12]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 10%, rgba(255,110,0,0.28), transparent 34%), radial-gradient(circle at 85% 100%, rgba(17,24,39,0.12), transparent 30%)",
              }}
            />
            <div className="relative flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-[#faf9f6] shadow-[0_16px_34px_rgba(24,24,27,0.22)]">
                <Trash2 size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Delete book
                </div>
                <h2 className="mt-2 text-2xl font-serif font-medium leading-tight text-zinc-950">
                  Remove "{deleteTarget.name}"?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                  This removes the book from your revision library on this
                  device. The action keeps the rest of your notes and chat
                  history untouched.
                </p>
              </div>
            </div>
            <div className="relative mt-6 flex justify-end gap-3 border-t border-zinc-900/10 pt-4">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-full border border-zinc-900/10 bg-white/60 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-white hover:text-zinc-950"
              >
                Keep book
              </button>
              <button
                type="button"
                onClick={deleteConcept}
                className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-[#faf9f6] shadow-[0_14px_34px_rgba(24,24,27,0.22)] transition-colors hover:bg-red-950"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
