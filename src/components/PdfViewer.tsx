import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useStore, Annotation } from "../store";
import { gsap } from "gsap";
import { useTranslation } from "../lib/translations";
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Highlighter,
  MessageSquare,
  Underline,
  Strikethrough,
  StickyNote,
} from "lucide-react";
import { brainOrchestrator } from "../memory/memory.orchestrator";
import { useMotionPreference } from "../hooks/useMotionPreference";
import { db } from "../memory/longterm.memory";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// cMaps and standard fonts are required for CJK (Japanese/Chinese/Korean)
// PDFs — without them pdf.js silently renders pages with no text at all.
// Served by the pdfjs-static-assets plugin in vite.config.ts. Kept as a
// module constant so react-pdf doesn't reload the document on each render.
const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: "/pdfjs-assets/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs-assets/standard_fonts/",
};

export function PdfViewer() {
  const { t } = useTranslation();
  const pdfUrl = useStore((state) => state.pdfUrl);
  const activeLearningBookId = useStore((state) => state.activeLearningBookId);
  const activeDocumentId = useStore((state) => state.activeDocumentId);
  const pdfScale = useStore((state) => state.pdfScale);
  const setPdfScale = useStore((state) => state.setPdfScale);
  const pdfPage = useStore((state) => state.pdfPage);
  const setPdfPage = useStore((state) => state.setPdfPage);
  const pdfTotalPages = useStore((state) => state.pdfTotalPages);
  const setPdfTotalPages = useStore((state) => state.setPdfTotalPages);
  const annotations = useStore((state) => state.annotations);
  const addAnnotation = useStore((state) => state.addAnnotation);
  const motionEnabled = useMotionPreference();
  const setAskTutorQuery = useStore((state) => state.setAskTutorQuery);
  const setSelectedTextContext = useStore(
    (state) => state.setSelectedTextContext,
  );
  const [isFitWidth, setIsFitWidth] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapperRef = useRef<HTMLDivElement>(null);
  const activePageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const actionBorderRef = useRef<HTMLDivElement | null>(null);
  const loadingShimmerRef = useRef<HTMLDivElement | null>(null);
  const selectionTooltipRef = useRef<HTMLDivElement | null>(null);
  const selectionBorderRef = useRef<HTMLDivElement | null>(null);
  const draftNoteRef = useRef<HTMLDivElement | null>(null);
  const voiceFocusTimeoutRef = useRef<number | null>(null);
  const titleRequestRef = useRef<AbortController | null>(null);
  const titleScheduleRef = useRef<number | null>(null);
  const titleGenerationRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [selectionTooltip, setSelectionTooltip] = useState<{
    x: number;
    y: number;
    text: string;
    rawRects: DOMRect[];
  } | null>(null);
  const [draftNote, setDraftNote] = useState<{
    x: number;
    y: number;
    color: string;
    rects: any[];
    text: string;
  } | null>(null);
  const [voiceVisualFocus, setVoiceVisualFocus] = useState<{
    query: string;
    summary: string;
    status: string;
    pageNumber: number;
  } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pageInputValue, setPageInputValue] = useState<string | null>(null);
  const boundedPdfTotalPages = Math.max(1, pdfTotalPages || 1);
  const clampPdfPage = (page: number) =>
    Math.min(boundedPdfTotalPages, Math.max(1, page));
  const commitPageInput = () => {
    const val = parseInt(pageInputValue || "");
    if (!isNaN(val)) {
      setPdfPage(clampPdfPage(val));
    }
    setPageInputValue(null);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let timeoutId: any;
    const obs = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setContainerWidth(entries[0].contentRect.width);
        setContainerHeight(entries[0].contentRect.height);
      }, 150);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const [titleGenerated, setTitleGenerated] = useState(false);

  useEffect(() => {
    titleGenerationRef.current += 1;
    titleRequestRef.current?.abort();
    if (titleScheduleRef.current !== null) {
      window.clearTimeout(titleScheduleRef.current);
      titleScheduleRef.current = null;
    }
    setTitleGenerated(false);
  }, [pdfUrl]);

  const handlePageRenderSuccess = () => {
    if (pdfTotalPages > 0 && !titleGenerated) {
      const activeCanvas = activePageCanvasRef.current;
      if (activeCanvas) {
        setTitleGenerated(true);
        const generation = titleGenerationRef.current;
        titleRequestRef.current?.abort();
        const controller = new AbortController();
        titleRequestRef.current = controller;

        titleScheduleRef.current = window.setTimeout(() => {
          titleScheduleRef.current = null;
          if (
            controller.signal.aborted ||
            generation !== titleGenerationRef.current
          ) {
            return;
          }

          activeCanvas.toBlob(
            (blob) => {
              if (
                !blob ||
                controller.signal.aborted ||
                generation !== titleGenerationRef.current
              ) {
                return;
              }
              const reader = new FileReader();
              reader.onloadend = () => {
                if (
                  controller.signal.aborted ||
                  generation !== titleGenerationRef.current
                ) {
                  return;
                }
                const apiKey = useStore.getState().apiKey;
                if (!apiKey) return;
                fetch("/api/title", {
                  method: "POST",
                  signal: controller.signal,
                  headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                  },
                  body: JSON.stringify({ image: reader.result }),
                })
                  .then((res) => {
                    if (!res.ok) throw new Error(`Title HTTP ${res.status}`);
                    return res.json();
                  })
                  .then((data) => {
                    if (
                      !data.title ||
                      controller.signal.aborted ||
                      generation !== titleGenerationRef.current
                    ) {
                      return;
                    }
                    const cleanTitle = data.title
                      .replace(/[^a-zA-Z0-9 -]/g, "")
                      .trim();
                    const { activeDocumentId, activeLearningBookId } =
                      useStore.getState();
                    if (activeDocumentId) {
                      void db.learningDocuments.update(activeDocumentId, {
                        title: cleanTitle,
                        updatedAt: Date.now(),
                      });
                    }
                    if (activeLearningBookId) {
                      void db.learningBooks
                        .get(activeLearningBookId)
                        .then((book) => {
                          const currentTitle = String(book?.title || "").trim();
                          if (
                            !book ||
                            (currentTitle &&
                              !/^(general study|conversation notes|study session)$/i.test(
                                currentTitle,
                              ))
                          ) {
                            return;
                          }
                          useStore.getState().setActiveProject(cleanTitle);
                          void brainOrchestrator.updateLearningBookTitle(
                            activeLearningBookId,
                            cleanTitle,
                            undefined,
                            "pdf",
                          );
                        });
                    }
                  })
                  .catch((error) => {
                    if (!controller.signal.aborted) console.error(error);
                  });
              };
              reader.readAsDataURL(blob);
            },
            "image/jpeg",
            0.5,
          );
        }, 180);
      }
    }
  };

  useEffect(() => {
    return () => {
      titleRequestRef.current?.abort();
      if (titleScheduleRef.current !== null) {
        window.clearTimeout(titleScheduleRef.current);
      }
      if (voiceFocusTimeoutRef.current !== null) {
        window.clearTimeout(voiceFocusTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleVoiceVisualFocus = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.source && detail.source !== "voice_look_at_current_page") {
        return;
      }
      if (
        detail.activeDocumentId &&
        detail.activeDocumentId !== activeDocumentId
      ) {
        return;
      }
      setVoiceVisualFocus({
        query: String(detail.query || "Voice is explaining this page.").slice(
          0,
          180,
        ),
        summary: String(detail.summary || "").slice(0, 220),
        status: String(detail.status || "ready"),
        pageNumber: pdfPage,
      });
      pageWrapperRef.current?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });
      if (voiceFocusTimeoutRef.current !== null) {
        window.clearTimeout(voiceFocusTimeoutRef.current);
      }
      voiceFocusTimeoutRef.current = window.setTimeout(() => {
        setVoiceVisualFocus(null);
        voiceFocusTimeoutRef.current = null;
      }, 12000);
    };
    window.addEventListener(
      "learningai:voice-visual-focus",
      handleVoiceVisualFocus,
    );
    return () =>
      window.removeEventListener(
        "learningai:voice-visual-focus",
        handleVoiceVisualFocus,
      );
  }, [activeDocumentId, pdfPage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setPdfPage(clampPdfPage(pdfPage + 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setPdfPage(clampPdfPage(pdfPage - 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [boundedPdfTotalPages, pdfPage, setPdfPage]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    const currentState = useStore.getState();
    const currentPage = currentState.pdfPage || 1;
    const nextPage = Math.min(Math.max(currentPage, 1), numPages);
    if (currentState.pdfTotalPages !== numPages) {
      setPdfTotalPages(numPages);
    }
    if (currentState.pdfPage !== nextPage) {
      setPdfPage(nextPage);
    }
    if (activeDocumentId) {
      void db.learningDocuments
        .get(activeDocumentId)
        .then((document) => {
          if (document?.totalPages === numPages) return;
          return db.learningDocuments.update(activeDocumentId, {
            totalPages: numPages,
            updatedAt: Date.now(),
          });
        })
        .catch((error) =>
          console.warn("[PdfViewer] Could not store PDF page count:", error),
        );
    }
  }

  useEffect(() => {
    if (!activeDocumentId) return;
    void db.learningDocuments
      .get(activeDocumentId)
      .then((document) => {
        if (document?.lastViewedPage === pdfPage) return;
        return db.learningDocuments.update(activeDocumentId, {
          lastViewedPage: pdfPage,
          updatedAt: Date.now(),
        });
      })
      .catch((error) =>
        console.warn("[PdfViewer] Could not store PDF page:", error),
      );
  }, [activeDocumentId, pdfPage]);

  useEffect(() => {
    if (!activeDocumentId) return;
    void db.learningDocuments
      .get(activeDocumentId)
      .then((document) => {
        if (document?.scale === pdfScale) return;
        return db.learningDocuments.update(activeDocumentId, {
          scale: pdfScale,
          updatedAt: Date.now(),
        });
      })
      .catch((error) =>
        console.warn("[PdfViewer] Could not store PDF zoom:", error),
      );
  }, [activeDocumentId, pdfScale]);

  const handleDoubleClick = () => {
    setIsFitWidth(!isFitWidth);
  };

  const handleSelection = () => {
    if (selectionTooltip) setSelectionTooltip(null);
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const rawText = selection.toString();
    const text = rawText
      .replace(/-\n/g, "")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!text || !pageWrapperRef.current) return;

    const range = selection.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return;

    const pageRect = pageWrapperRef.current.getBoundingClientRect();
    const lastRect = rects[rects.length - 1];

    const containerNode = pageWrapperRef.current.closest(".preserve-3d");
    const containerRect = containerNode
      ? containerNode.getBoundingClientRect()
      : pageRect;

    setSelectionTooltip({
      x: (lastRect.left + lastRect.right) / 2 - containerRect.left,
      y: lastRect.bottom - containerRect.top + 5,
      text,
      rawRects: rects,
    });
  };

  const addSelectionAnnotation = (type: Annotation["type"], color: string) => {
    if (!selectionTooltip || !pageWrapperRef.current) return;
    const pageRect = pageWrapperRef.current.getBoundingClientRect();

    const normalizedRects = selectionTooltip.rawRects
      .filter((rect) => {
        // Must intersect page vertically
        return rect.bottom > pageRect.top && rect.top < pageRect.bottom;
      })
      .map((rect) => {
        const yOffset = rect.height * 0.15;
        const adjustedHeight = rect.height * 0.85;
        const x = Math.max(
          0,
          Math.min(1, (rect.left - pageRect.left) / pageRect.width),
        );
        const y = Math.max(
          0,
          Math.min(1, (rect.top - pageRect.top - yOffset) / pageRect.height),
        );
        const width = Math.min(1 - x, rect.width / pageRect.width);
        const height = Math.min(1 - y, adjustedHeight / pageRect.height);

        return {
          x,
          y,
          width,
          height,
          pageIndex: pdfPage,
        };
      });

    if (normalizedRects.length === 0) {
      setSelectionTooltip(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (type === "sticky") {
      setDraftNote({
        x: selectionTooltip.x,
        y: selectionTooltip.y,
        color,
        rects: normalizedRects,
        text: selectionTooltip.text,
      });
      setSelectionTooltip(null);
      return;
    }

    addAnnotation({
      id: Date.now().toString(),
      bookId: activeLearningBookId || undefined,
      documentId: activeDocumentId || undefined,
      pageNumber: pdfPage,
      rects: normalizedRects,
      text: selectionTooltip.text,
      color,
      type,
    });

    setSelectionTooltip(null);
    window.getSelection()?.removeAllRanges();
  };

  const saveStickyNote = () => {
    if (!draftNote || !noteText.trim()) return;
    addAnnotation({
      id: Date.now().toString(),
      bookId: activeLearningBookId || undefined,
      documentId: activeDocumentId || undefined,
      pageNumber: pdfPage,
      rects: draftNote.rects,
      text: draftNote.text,
      color: draftNote.color,
      type: "sticky",
      note: noteText,
    });
    setDraftNote(null);
    setNoteText("");
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        selectionTooltip &&
        !(e.target as Element).closest(".selection-tooltip-container")
      ) {
        setSelectionTooltip(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectionTooltip]);

  // Compute scale to fit the PDF page within the container (both width and height)
  // A4 aspect ratio is 1:1.414 (width:height). We want the page to fit without scrolling.
  const A4_ASPECT = 1.414;
  const availWidth = containerWidth ? Math.max(containerWidth - 40, 100) : 794;
  const availHeight = containerHeight
    ? Math.max(containerHeight - 80, 200)
    : 1123;

  // Scale that would make the page fit by width
  const scaleByWidth = availWidth / 794;
  // Scale that would make the page fit by height (794 * A4_ASPECT = A4 height in points)
  const scaleByHeight = availHeight / (794 * A4_ASPECT);
  // Use whichever is smaller to ensure it fits
  const fitScale = Math.min(scaleByWidth, scaleByHeight, 1.5);

  const defaultWidth = isFitWidth ? availWidth : Math.floor(794 * fitScale);
  const widthVal = isFitWidth ? availWidth : undefined;
  const heightVal: number | undefined = undefined;

  const renderedScale = pdfScale;

  const pageAnnotations = annotations.filter(
    (a) =>
      a.pageNumber === pdfPage &&
      (!activeDocumentId || a.documentId === activeDocumentId),
  );

  useEffect(() => {
    const borders = [
      actionBorderRef.current,
      selectionBorderRef.current,
    ].filter(Boolean) as HTMLDivElement[];
    gsap.killTweensOf(borders);
    gsap.set(borders, { rotate: 0 });
    if (!motionEnabled || !borders.length) return;
    const tween = gsap.to(borders, {
      rotate: 360,
      duration: 4,
      repeat: -1,
      ease: "none",
    });
    return () => {
      tween.kill();
    };
  }, [motionEnabled, selectionTooltip]);

  useLayoutEffect(() => {
    if (!loadingShimmerRef.current) return;
    gsap.killTweensOf(loadingShimmerRef.current);
    if (!motionEnabled) {
      gsap.set(loadingShimmerRef.current, { xPercent: 0 });
      return;
    }
    const tween = gsap.fromTo(
      loadingShimmerRef.current,
      { xPercent: -100 },
      {
        xPercent: 200,
        duration: 2,
        repeat: -1,
        ease: "none",
      },
    );
    return () => {
      tween.kill();
    };
  }, [motionEnabled, pdfUrl]);

  useLayoutEffect(() => {
    if (!selectionTooltip || !selectionTooltipRef.current) return;
    gsap.fromTo(
      selectionTooltipRef.current,
      { autoAlpha: 0, xPercent: -50, y: 10, scale: 0.95 },
      {
        autoAlpha: 1,
        xPercent: -50,
        y: 0,
        scale: 1,
        duration: motionEnabled ? 0.16 : 0,
        ease: "power2.out",
      },
    );
  }, [motionEnabled, selectionTooltip]);

  useLayoutEffect(() => {
    if (!draftNote || !draftNoteRef.current) return;
    gsap.fromTo(
      draftNoteRef.current,
      { autoAlpha: 0, xPercent: -50, y: 10, scale: 0.95 },
      {
        autoAlpha: 1,
        xPercent: -50,
        y: 0,
        scale: 1,
        duration: motionEnabled ? 0.16 : 0,
        ease: "power2.out",
      },
    );
  }, [draftNote, motionEnabled]);

  return (
    <div
      className="w-full h-full flex flex-col relative bg-[#0A0A0B]"
      ref={containerRef}
    >
      <style>{`
        /* Fix text selection readability */
        .react-pdf__Page__textContent ::selection {
          background: rgba(59, 130, 246, 0.4) !important;
          color: transparent !important;
        }
      `}</style>

      {/* Action Bar Floating (Liquid Metal style) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
        <div
          className="relative flex items-center gap-1 p-1.5 rounded-full overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-300"
          style={{
            background: "rgba(20, 20, 22, 0.85)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
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
              ref={actionBorderRef}
              className="absolute inset-[-50%] w-[200%] h-[200%]"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.1) 60%, transparent 100%)",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent mix-blend-overlay" />
          </div>

          <button
            type="button"
            aria-label="Previous PDF page"
            onClick={() => setPdfPage(clampPdfPage(pdfPage - 1))}
            className="relative z-10 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors flex items-center justify-center shrink-0 w-8 h-8 focus:outline-none"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="relative z-10 flex flex-col items-center justify-center px-4 min-w-[80px]">
            <span className="text-[14px] font-mono font-bold text-white tracking-widest flex items-center">
              <input
                aria-label="PDF page number"
                type="text"
                value={pageInputValue !== null ? pageInputValue : pdfPage}
                onChange={(e) => setPageInputValue(e.target.value)}
                onBlur={() => {
                  commitPageInput();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitPageInput();
                  }
                }}
                className="w-7 bg-transparent text-center text-white focus:outline-none focus:bg-white/20 hover:bg-white/10 rounded transition-colors"
              />
              <span className="text-zinc-500 font-medium px-1">/</span>{" "}
              {pdfTotalPages || "-"}
            </span>
          </div>

          <button
            type="button"
            aria-label="Next PDF page"
            onClick={() => setPdfPage(clampPdfPage(pdfPage + 1))}
            className="relative z-10 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full transition-colors flex items-center justify-center shrink-0 w-8 h-8 focus:outline-none"
          >
            <ChevronRight size={16} />
          </button>

          <div className="relative z-10 w-px h-5 bg-white/10 mx-1" />

          <button
            type="button"
            aria-label={t("fit_height")}
            aria-pressed={!isFitWidth}
            onClick={() => setIsFitWidth(false)}
            className={`relative z-10 p-2 rounded-full transition-colors w-8 h-8 flex items-center justify-center focus:outline-none ${!isFitWidth ? "text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)] bg-white/10 border border-white/10 mix-blend-screen" : "text-zinc-400 hover:text-white hover:bg-white/10"}`}
            title={t("fit_height")}
          >
            <Minimize size={14} />
          </button>
          <button
            type="button"
            aria-label={t("fit_width")}
            aria-pressed={isFitWidth}
            onClick={() => setIsFitWidth(true)}
            className={`relative z-10 p-2 rounded-full transition-colors w-8 h-8 flex items-center justify-center focus:outline-none ${isFitWidth ? "text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)] bg-white/10 border border-white/10 mix-blend-screen" : "text-zinc-400 hover:text-white hover:bg-white/10"}`}
            title={t("fit_width")}
          >
            <Maximize size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 w-full h-full overflow-auto pt-4 pb-32 flex justify-center custom-scroll bg-[#0A0A0B] relative md:pt-5">
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          className="relative z-10 transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-300 preserve-3d"
          onDoubleClick={handleDoubleClick}
          onMouseUp={handleSelection}
        >
          <Document
            file={pdfUrl}
            options={PDF_DOCUMENT_OPTIONS}
            onLoadSuccess={onDocumentLoadSuccess}
            onItemClick={({ pageNumber }) => setPdfPage(pageNumber)}
            loading={
              <div
                className="relative flex flex-col bg-white overflow-hidden rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] p-16 gap-6"
                style={{
                  width: widthVal || defaultWidth,
                  height: (widthVal || defaultWidth) * 1.414,
                }}
              >
                <div
                  ref={loadingShimmerRef}
                  className="absolute inset-0 z-10 bg-gradient-to-r from-transparent via-[#f0f0f0]/60 to-transparent skew-x-12"
                />
                <div className="w-1/2 h-8 bg-zinc-100 rounded-md mb-8" />
                <div className="w-full h-4 bg-zinc-100 rounded-md" />
                <div className="w-11/12 h-4 bg-zinc-100 rounded-md" />
                <div className="w-full h-4 bg-zinc-100 rounded-md" />
                <div className="w-4/5 h-4 bg-zinc-100 rounded-md mb-8" />

                <div className="w-full aspect-[16/9] bg-zinc-100 rounded-lg mb-8" />

                <div className="w-full h-4 bg-zinc-100 rounded-md" />
                <div className="w-3/4 h-4 bg-zinc-100 rounded-md" />
                <div className="w-full h-4 bg-zinc-100 rounded-md" />
                <div className="w-5/6 h-4 bg-zinc-100 rounded-md" />
              </div>
            }
          >
            <div ref={pageWrapperRef} className="relative">
              <Page
                pageNumber={pdfPage}
                scale={renderedScale}
                width={widthVal || defaultWidth}
                height={heightVal}
                className="bg-white rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] ring-1 ring-white/10"
                renderTextLayer={true}
                renderAnnotationLayer={true}
                canvasRef={activePageCanvasRef}
                onRenderSuccess={handlePageRenderSuccess}
              />
              <div className="absolute inset-0 pointer-events-none rounded-xl shadow-[inset_0_0_2px_rgba(255,255,255,0.2)] mix-blend-overlay" />

              {voiceVisualFocus && (
                <div
                  data-voice-visual-focus-overlay
                  aria-label={`Voice is explaining PDF page ${voiceVisualFocus.pageNumber}`}
                  className="pointer-events-none absolute inset-3 z-20 rounded-xl border-2 border-blue-300/95 bg-blue-400/[0.025] shadow-[0_0_0_9999px_rgba(37,99,235,0.055),0_0_42px_rgba(96,165,250,0.42)]"
                />
              )}

              {/* Render Annotations */}
              {pageAnnotations.map((ann) => (
                <React.Fragment key={ann.id}>
                  {ann.rects.map((rect, i) => {
                    if (ann.type === "underline") {
                      return (
                        <div
                          key={`${ann.id}-${i}`}
                          data-annotation-id={ann.id}
                          data-annotation-type={ann.type || "underline"}
                          aria-hidden="true"
                          className="absolute pointer-events-none mix-blend-multiply"
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${(rect.y + rect.height) * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `2.5px`,
                            backgroundColor: ann.color || "#3b82f6",
                            transform: "translateY(-4px)",
                          }}
                        />
                      );
                    }
                    if (ann.type === "strikethrough") {
                      return (
                        <div
                          key={`${ann.id}-${i}`}
                          data-annotation-id={ann.id}
                          data-annotation-type={ann.type || "strikethrough"}
                          aria-hidden="true"
                          className="absolute pointer-events-none mix-blend-multiply"
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${(rect.y + rect.height / 2) * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `2.5px`,
                            backgroundColor: ann.color || "#ef4444",
                          }}
                        />
                      );
                    }
                    // highlight or default
                    return (
                      <div
                        key={`${ann.id}-${i}`}
                        data-annotation-id={ann.id}
                        data-annotation-type={ann.type || "highlight"}
                        aria-hidden="true"
                        className="absolute mix-blend-multiply opacity-50 pointer-events-none cursor-pointer hover:opacity-70 transition-opacity"
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.width * 100}%`,
                          height: `${rect.height * 100}%`,
                          backgroundColor: ann.color || "#fde047",
                          transform: "translateY(-4px)",
                        }}
                      />
                    );
                  })}
                  {ann.type === "sticky" && ann.rects.length > 0 && (
                    <div
                      data-annotation-id={ann.id}
                      data-annotation-type="sticky"
                      aria-hidden="true"
                      className="absolute w-6 h-6 -ml-3 -mt-3 rounded shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform origin-center"
                      style={{
                        left: `${ann.rects[0].x * 100}%`,
                        top: `${ann.rects[0].y * 100}%`,
                        backgroundColor: ann.color || "#fde047",
                      }}
                    >
                      <StickyNote size={12} className="text-black/60" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </Document>

          {/* Selection Tooltip */}
          {selectionTooltip && (
            <div
              ref={selectionTooltipRef}
              className="absolute z-50 selection-tooltip-container"
              style={{
                left: selectionTooltip.x,
                top: selectionTooltip.y,
              }}
            >
              <div className="relative flex items-center gap-1 p-1 bg-[#121214]/95 backdrop-blur-xl rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.8)] overflow-hidden">
                {/* Liquid Metal Border */}
                <div
                  className="absolute inset-0 rounded-xl pointer-events-none overflow-hidden"
                  style={{
                    padding: "1px",
                    WebkitMask:
                      "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                    WebkitMaskComposite: "xor",
                    maskComposite: "exclude",
                  }}
                >
                  <div
                    ref={selectionBorderRef}
                    className="absolute inset-[-50%] w-[200%] h-[200%]"
                    style={{
                      background:
                        "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.1) 60%, transparent 100%)",
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
                </div>

                <div className="flex gap-1 pr-1.5 border-r border-white/10 relative z-10">
                  <button
                    type="button"
                    aria-label={t("highlight")}
                    onClick={() =>
                      addSelectionAnnotation("highlight", "#fde047")
                    } // yellow
                    className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors text-yellow-400 tooltip-trigger"
                    title={t("highlight")}
                  >
                    <Highlighter size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("underline")}
                    onClick={() =>
                      addSelectionAnnotation("underline", "#3b82f6")
                    } // blue
                    className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors text-blue-500"
                    title={t("underline")}
                  >
                    <Underline size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("strikethrough")}
                    onClick={() =>
                      addSelectionAnnotation("strikethrough", "#ef4444")
                    } // red
                    className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors text-red-500"
                    title={t("strikethrough")}
                  >
                    <Strikethrough size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("sticky_note")}
                    onClick={() => addSelectionAnnotation("sticky", "#fde047")} // yellow
                    className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors text-yellow-400"
                    title={t("sticky_note")}
                  >
                    <StickyNote size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selectionTooltip) {
                      setSelectedTextContext(selectionTooltip.text);
                      setAskTutorQuery("");
                      setSelectionTooltip(null);
                      window.getSelection()?.removeAllRanges();
                    }
                  }}
                  className="flex items-center justify-center px-3 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-[color,background-color,border-color,box-shadow,transform,opacity] text-[10px] font-semibold gap-1 ml-1 relative z-10 focus:outline-none focus:ring-2 ring-indigo-500/50 uppercase tracking-wide whitespace-nowrap group border border-indigo-400/30"
                  style={{ transform: "translateZ(0)", overflow: "hidden" }}
                >
                  <span className="absolute inset-0 z-0 rounded-lg bg-[linear-gradient(135deg,rgba(255,255,255,0.24),rgba(255,255,255,0.04)_42%,rgba(129,140,248,0.32))] opacity-70 transition-opacity group-hover:opacity-100 pointer-events-none" />
                  <span className="absolute inset-x-1 top-0 z-0 h-px rounded-full bg-white/70 pointer-events-none" />
                  <span className="absolute -left-10 top-0 z-0 h-full w-10 skew-x-[-18deg] bg-white/20 blur-sm transition-transform duration-700 group-hover:translate-x-32 pointer-events-none" />
                  <MessageSquare
                    size={12}
                    className="relative z-10 drop-shadow-md"
                  />{" "}
                  <span className="relative z-10 drop-shadow-sm font-bold">
                    {t("ask_tutor")}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Draft Note Input */}
          {draftNote && (
            <div
              ref={draftNoteRef}
              className="absolute z-50 selection-tooltip-container w-64"
              style={{
                left: draftNote.x,
                top: draftNote.y,
              }}
            >
              <div className="bg-[#121214] border border-[#2A2A30] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col">
                <div className="bg-[#1A1A1E] px-3 py-2 border-b border-[#2A2A30] flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400 uppercase tracking-wide">
                    <StickyNote size={12} />
                    {t("sticky_note")}
                  </div>
                  <button
                    type="button"
                    aria-label="Close sticky note editor"
                    onClick={() => setDraftNote(null)}
                    className="text-zinc-500 hover:text-white transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 6L6 18M6 6l12 12"></path>
                    </svg>
                  </button>
                </div>
                <div className="p-3">
                  <textarea
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        saveStickyNote();
                      }
                    }}
                    placeholder={t("add_annotation_note")}
                    className="w-full bg-transparent border-none outline-none text-sm text-zinc-200 placeholder:text-zinc-650 resize-none min-h-[80px]"
                  />
                </div>
                <div className="px-3 py-2 bg-[#1A1A1E]/50 border-t border-[#2A2A30] flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftNote(null)}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={saveStickyNote}
                    className="px-3 py-1.5 text-xs font-semibold bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 border border-yellow-400/20 rounded pl-2 pr-3 flex items-center gap-1 transition-colors"
                  >
                    {t("save_changes")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
