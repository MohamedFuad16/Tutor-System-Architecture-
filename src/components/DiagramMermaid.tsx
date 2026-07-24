import { useEffect, useId, useRef, useState } from "react";

// Shared Mermaid renderer used by both the Revision/learning-book surfaces and the
// chat panel, so flowcharts look identical everywhere. It is deliberately LIGHT
// (white nodes, dark text, soft card) to match the paper/notebook surfaces the app
// renders diagrams on, and clamps to a readable width so wide graphs stay legible.
// On top of the Revision renderer it adds streaming safety (debounce + parse guard +
// skeleton) so half-finished ```mermaid fences never flash raw parser errors in chat.

type MermaidApi = typeof import("mermaid").default;
let sharedMermaidPromise: Promise<MermaidApi> | null = null;

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

const loadSharedMermaid = () => {
  if (!sharedMermaidPromise) {
    sharedMermaidPromise = import("mermaid").then((module) => {
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
  return sharedMermaidPromise;
};

export type DiagramMermaidVariant = "default" | "gemini";

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

export const DiagramMermaid = ({
  chart,
  variant = "default",
  streaming = false,
}: {
  chart: string;
  variant?: DiagramMermaidVariant;
  // When true (chat streaming), only render once the source parses cleanly so
  // incomplete fences don't flash raw parser errors.
  streaming?: boolean;
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const isGemini = variant === "gemini";
  const chartId = useId().replace(/:/g, "");
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const renderedChart = isGemini
    ? `${mermaidGeminiInitDirective}\n${chart}`
    : chart;

  useEffect(() => {
    let cancelled = false;
    const container = chartRef.current;
    if (!container) return;

    const chartForViewport = window.matchMedia?.("(max-width: 640px)").matches
      ? renderedChart
          .replace(/\bflowchart\s+LR\b/g, "flowchart TB")
          .replace(/\bgraph\s+LR\b/g, "graph TB")
      : renderedChart;

    const run = () => {
      loadSharedMermaid()
        .then(async (mermaid) => {
          if (cancelled) return;
          if (streaming) {
            // Guard against incomplete/invalid source while tokens stream in.
            let parseable = false;
            try {
              parseable = Boolean(
                await mermaid.parse(chartForViewport, { suppressErrors: true }),
              );
            } catch {
              parseable = false;
            }
            if (!parseable) return; // keep last good render / skeleton
          }
          const result = await mermaid.render(
            `diagram-mermaid-${chartId}`,
            chartForViewport,
          );
          if (cancelled || !chartRef.current) return;
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
          setStatus("ready");
        })
        .catch((error) => {
          console.warn("Diagram Mermaid error", error);
          // Do not dump the raw parser error as text; leave the last good render
          // (or the skeleton) in place.
        });
    };

    // Debounce so streaming tokens don't render on every keystroke.
    const timer = window.setTimeout(run, streaming ? 120 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chartId, renderedChart, streaming]);

  return (
    <div
      className={`not-prose relative my-6 overflow-x-auto overflow-y-hidden sm:my-8 ${
        isGemini
          ? "rounded-xl border border-zinc-200 bg-[#f6f7f9] p-2 shadow-[0_18px_46px_rgba(15,23,42,0.08)] sm:rounded-2xl sm:p-3"
          : "rounded-xl border border-zinc-200 bg-white/70 p-2 shadow-sm sm:p-3"
      }`}
    >
      <div
        ref={chartRef}
        role="img"
        aria-label={isGemini ? "Architecture diagram" : "Diagram"}
        className={`min-w-full rounded-xl p-2 sm:p-4 [&_.edgeLabel]:rounded-md [&_.label]:font-sans [&_svg]:h-auto ${
          isGemini
            ? "bg-[#f6f7f9] [&_.edgeLabel]:bg-[#f6f7f9]"
            : "bg-white [&_.edgeLabel]:bg-white"
        }`}
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
            Rendering diagram…
          </div>
        </div>
      )}
    </div>
  );
};
