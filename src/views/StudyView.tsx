import React, {
  useCallback,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { PdfViewer } from "../components/PdfViewer";
import { ChatPanel } from "../components/ChatPanel";
import { useStore } from "../store";
import {
  UploadCloud,
  MessageSquare,
  X,
  Network,
  FileText,
  Plus,
} from "lucide-react";
import { PatternCard, themes } from "../components/PatternCard";
import { gsap } from "gsap";
import { useTranslation } from "../lib/translations";
import { brainOrchestrator } from "../memory/memory.orchestrator";
import { useMotionPreference } from "../hooks/useMotionPreference";
import { learnerRequestHeaders } from "../lib/localLearnerProfile";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  generalStudyBookIdForUser,
  type LearningBook,
  type LearningDocument,
} from "../memory/longterm.memory";

const splitCardTitle = (title: string) => {
  const words = title.split(" ");
  if (words.length < 2) return title;
  return (
    <>
      {words[0]}
      <br />
      {words.slice(1).join(" ")}
    </>
  );
};

const documentObjectUrlCache = new Map<string, { blob: Blob; url: string }>();
const MOBILE_STUDY_MEDIA_QUERY = "(max-width: 767px)";

const isMobileStudyViewport = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(MOBILE_STUDY_MEDIA_QUERY).matches;

const getCachedDocumentObjectUrl = (document: LearningDocument) => {
  if (document.fileUrl) return document.fileUrl;
  const sourceBlob = document.blob instanceof Blob ? document.blob : null;
  if (!sourceBlob) return null;
  const cached = documentObjectUrlCache.get(document.id);
  if (cached?.blob === sourceBlob) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(sourceBlob);
  documentObjectUrlCache.set(document.id, { blob: sourceBlob, url });
  return url;
};

const revokeCachedDocumentObjectUrl = (documentId: string) => {
  const cached = documentObjectUrlCache.get(documentId);
  if (!cached) return;
  URL.revokeObjectURL(cached.url);
  documentObjectUrlCache.delete(documentId);
};

const AnimatedHeadlineWords = ({
  text,
  headlineIndex,
  motionEnabled,
  onFirstWord,
  onComplete,
}: {
  text: string;
  headlineIndex: number;
  motionEnabled: boolean;
  onFirstWord?: (index: number) => void;
  onComplete?: (index: number) => void;
}) => {
  const wordRefs = useRef<HTMLSpanElement[]>([]);
  const onFirstWordRef = useRef(onFirstWord);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onFirstWordRef.current = onFirstWord;
    onCompleteRef.current = onComplete;
  }, [onComplete, onFirstWord]);

  useLayoutEffect(() => {
    const words = wordRefs.current.filter(Boolean);
    if (!words.length) return;
    gsap.killTweensOf(words);
    if (!motionEnabled) {
      gsap.set(words, {
        autoAlpha: 1,
        y: 0,
        filter: "blur(0px)",
        willChange: "auto",
      });
      onFirstWordRef.current?.(headlineIndex);
      onCompleteRef.current?.(headlineIndex);
      return;
    }
    const timeline = gsap.timeline({
      onComplete: () => {
        gsap.set(words, { willChange: "auto" });
        onCompleteRef.current?.(headlineIndex);
      },
    });
    timeline.call(() => onFirstWordRef.current?.(headlineIndex), [], 0.08);
    gsap.set(words, { willChange: "transform, opacity, filter" });
    timeline.fromTo(
      words,
      { autoAlpha: 0, y: 16, filter: "blur(16px)" },
      {
        autoAlpha: 1,
        y: 0,
        filter: "blur(0px)",
        duration: 1.28,
        stagger: 0.105,
        ease: "power4.out",
      },
      0,
    );
    return () => {
      gsap.set(words, { willChange: "auto" });
      timeline.kill();
    };
  }, [headlineIndex, motionEnabled, text]);

  wordRefs.current = [];

  return (
    <h2
      data-testid="intro-heading"
      className="flex w-full max-w-[min(30rem,100%)] flex-wrap justify-center gap-x-[0.28em] gap-y-1.5 overflow-visible px-2 text-center font-serif text-[clamp(1.18rem,2.15vw,2rem)] leading-[1.18] tracking-normal text-white/92 sm:max-w-[42rem]"
    >
      {text.split(" ").map((word, index) => (
        <span
          key={`${word}-${index}`}
          ref={(node) => {
            if (node) wordRefs.current[index] = node;
          }}
          className="inline-block max-w-full break-words [overflow-wrap:anywhere]"
        >
          {word}
        </span>
      ))}
    </h2>
  );
};

type StudyIntroSplashProps = {
  cardStep: number;
  headlineIndex: number;
  motionEnabled: boolean;
  isDragging: boolean;
  isIngesting: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setIsDragging: (dragging: boolean) => void;
  openFilePicker: () => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onHeadlineStart: (index: number) => void;
  onHeadlineComplete: (index: number) => void;
  t: (key: string) => string;
};

type CardTarget = {
  opacity: number;
  xPercent: number;
  y: number;
  scale: number;
  rotate: number;
  filter: string;
};

function StudyIntroSplash({
  cardStep,
  headlineIndex,
  motionEnabled,
  isDragging,
  isIngesting,
  fileInputRef,
  setIsDragging,
  openFilePicker,
  handleDrop,
  handleFileChange,
  onHeadlineStart,
  onHeadlineComplete,
  t,
}: StudyIntroSplashProps) {
  const activeIndex = headlineIndex;
  const finalStack = cardStep >= 4;
  const cardRefs = useRef<HTMLDivElement[]>([]);
  const lastCardTargetsRef = useRef<Array<CardTarget | null>>([]);
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(max-width: 640px)").matches,
  );
  const [isDocumentHidden, setIsDocumentHidden] = useState(() =>
    typeof document === "undefined" ? false : document.hidden,
  );
  const introCards = [
    {
      key: "tutor",
      headline: t("study_hero_1"),
      theme: themes[2],
      icon: <MessageSquare className="h-5 w-5" />,
      iconClass: "bg-black/10 text-black border-black/10",
      title: t("study_card_tutor_title"),
      subtitle: t("study_card_tutor_subtitle"),
      textClass: "text-black",
      subtextClass: "text-black",
    },
    {
      key: "graph",
      headline: t("study_scroll_text_2"),
      theme: themes[0],
      icon: <Network className="h-5 w-5" />,
      iconClass: "bg-white/10 text-white border-white/20",
      title: t("study_card_graph_title"),
      subtitle: t("study_card_graph_subtitle"),
      textClass: "text-[#fefefe]",
      subtextClass: "text-[#fefefe]",
      bgClass: `${themes[0].bg} border border-white/10`,
    },
    {
      key: "upload",
      headline: t("study_scroll_text_3"),
      theme: themes[1],
      icon: <UploadCloud className="h-5 w-5" />,
      iconClass: "bg-[#ff6e00]/20 text-white border-white/20",
      title: isIngesting
        ? t("study_card_ingest_title")
        : t("study_card_upload_title"),
      subtitle: isIngesting
        ? t("study_card_ingest_subtitle")
        : t("study_card_upload_subtitle"),
      textClass: "text-[#fefefe]",
      subtextClass: "text-[#fefefe]",
    },
  ];

  const getCardTarget = (index: number): CardTarget => {
    if (finalStack) {
      if (index === 0) {
        return {
          opacity: 1,
          xPercent: isCompactViewport ? -62 : -72,
          y: isCompactViewport ? 12 : 18,
          scale: isCompactViewport ? 0.88 : 0.9,
          rotate: isCompactViewport ? -3.8 : -4.5,
          filter: "blur(0px)",
        };
      }
      if (index === 1) {
        return {
          opacity: 1,
          xPercent: -50,
          y: 9,
          scale: 0.94,
          rotate: -1.6,
          filter: "blur(0px)",
        };
      }
      return {
        opacity: 1,
        xPercent: isCompactViewport ? -38 : -28,
        y: 0,
        scale: 1,
        rotate: isCompactViewport ? 1.2 : 1.8,
        filter: "blur(0px)",
      };
    }

    if (cardStep === 0) {
      return {
        opacity: 0,
        xPercent: index === 0 ? -50 : index === 1 ? -18 : 8,
        y: 42,
        scale: 0.82,
        rotate: index === 0 ? 0 : index === 1 ? 8 : 14,
        filter: "blur(16px)",
      };
    }

    if (cardStep === 1) {
      if (index === 0) {
        return {
          opacity: 1,
          xPercent: -50,
          y: 0,
          scale: 1,
          rotate: 0,
          filter: "blur(0px)",
        };
      }
      return {
        opacity: 0,
        xPercent: index === 1 ? -18 : 8,
        y: 32,
        scale: 0.78,
        rotate: index === 1 ? 8 : 14,
        filter: "blur(14px)",
      };
    }

    if (cardStep === 2) {
      if (index === 0) {
        return {
          opacity: 0.9,
          xPercent: isCompactViewport ? -68 : -82,
          y: 10,
          scale: 0.84,
          rotate: isCompactViewport ? -5.5 : -7,
          filter: "blur(0px)",
        };
      }
      if (index === 1) {
        return {
          opacity: 1,
          xPercent: -50,
          y: 0,
          scale: 1,
          rotate: 0,
          filter: "blur(0px)",
        };
      }
      return {
        opacity: 0,
        xPercent: isCompactViewport ? -22 : -10,
        y: 34,
        scale: 0.82,
        rotate: isCompactViewport ? 8 : 12,
        filter: "blur(14px)",
      };
    }

    if (cardStep === 3) {
      if (index === 0) {
        return {
          opacity: 0.86,
          xPercent: isCompactViewport ? -76 : -98,
          y: 10,
          scale: 0.78,
          rotate: isCompactViewport ? -6 : -8,
          filter: "blur(0px)",
        };
      }
      if (index === 1) {
        return {
          opacity: 0.94,
          xPercent: isCompactViewport ? -58 : -63,
          y: 2,
          scale: 0.89,
          rotate: isCompactViewport ? -2.4 : -3,
          filter: "blur(0px)",
        };
      }
      return {
        opacity: 1,
        xPercent: isCompactViewport ? -40 : -35,
        y: 6,
        scale: 0.95,
        rotate: isCompactViewport ? 4.2 : 5.5,
        filter: "blur(0px)",
      };
    }

    return {
      opacity: 0,
      xPercent: -50,
      y: 74,
      scale: 0.9,
      rotate: 0,
      filter: "blur(14px)",
    };
  };

  const toGsapTarget = (target: CardTarget) => ({
    autoAlpha: target.opacity,
    // x must stay 0: if the element mounts with a percentage translate in its
    // inline style, GSAP parses it as a pixel offset and stacks it under every
    // xPercent tween, shoving the whole card fan half a card-width off-center.
    x: 0,
    xPercent: target.xPercent,
    y: target.y,
    scale: target.scale,
    rotate: target.rotate,
    filter: target.filter,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const updateViewport = () => setIsCompactViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentHidden(document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useLayoutEffect(() => {
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const target = getCardTarget(index);
      const previous = lastCardTargetsRef.current[index] || {
        opacity: 0,
        xPercent: -50,
        y: 80,
        scale: 0.9,
        rotate: 0,
        filter: "blur(14px)",
      };
      gsap.killTweensOf(card);
      if (!motionEnabled || isDocumentHidden) {
        gsap.set(card, toGsapTarget(target));
        lastCardTargetsRef.current[index] = target;
        return;
      }
      gsap.fromTo(card, toGsapTarget(previous), {
        ...toGsapTarget(target),
        duration: cardStep <= 1 ? 1.18 : 1.28,
        ease: cardStep >= 4 ? "expo.inOut" : "power4.out",
        immediateRender: false,
      });
      lastCardTargetsRef.current[index] = target;
    });
  }, [
    cardStep,
    finalStack,
    isCompactViewport,
    isDocumentHidden,
    motionEnabled,
  ]);

  return (
    <div className="relative flex h-full w-full flex-1 overflow-hidden">
      <input
        type="file"
        accept="application/pdf"
        multiple
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-start px-4 pb-5 pt-4 sm:px-6 sm:pt-5 md:px-10 md:pt-5">
        <div
          key={introCards[activeIndex].key}
          className="flex w-full justify-center px-10 sm:px-0"
        >
          <AnimatedHeadlineWords
            text={introCards[activeIndex].headline}
            headlineIndex={activeIndex}
            motionEnabled={motionEnabled}
            onFirstWord={onHeadlineStart}
            onComplete={onHeadlineComplete}
          />
        </div>

        <div className="relative mt-1 h-[clamp(238px,46dvh,404px)] w-full sm:mt-2">
          {introCards.map((card, index) => {
            const isUpload = index === 2;
            return (
              <div
                key={card.key}
                data-intro-card={card.key}
                ref={(node) => {
                  if (node) cardRefs.current[index] = node;
                }}
                className={`absolute left-1/2 top-0 origin-top ${
                  isUpload ? "pointer-events-auto" : "pointer-events-none"
                }`}
                style={{
                  opacity: 0,
                  // translateY only — a -50% translateX here would be parsed
                  // by GSAP as a pixel offset and permanently mis-center the
                  // card fan (GSAP centers via xPercent in toGsapTarget).
                  transform: "translateY(80px) scale(0.9)",
                  filter: "blur(14px)",
                  zIndex: finalStack
                    ? index === 2
                      ? 30
                      : 10 + index * 10
                    : index === activeIndex
                      ? 30
                      : 10 + index,
                }}
              >
                <div className="origin-top scale-[0.7] sm:scale-[0.64] md:scale-[0.73] lg:scale-[0.82] xl:scale-[0.89]">
                  <PatternCard
                    onClick={isUpload ? openFilePicker : undefined}
                    onDragOver={
                      isUpload
                        ? (event) => {
                            event.preventDefault();
                            setIsDragging(true);
                          }
                        : undefined
                    }
                    onDragLeave={
                      isUpload ? () => setIsDragging(false) : undefined
                    }
                    onDrop={isUpload ? handleDrop : undefined}
                    isDragging={isUpload && isDragging}
                    bgClass={card.bgClass || card.theme.bg}
                    SvgComponent={card.theme.SvgComponent}
                    bloomColor={card.theme.bloom}
                    bloomOpacity={card.theme.bloomOpacity}
                    animateDots={cardStep > index}
                  >
                    <div className="absolute bottom-[38px] left-[38px] right-[38px] z-20 flex flex-col gap-[7px] pointer-events-none">
                      <div
                        className={`mb-2 w-fit rounded-full border p-3 shadow-lg transition-colors ${card.iconClass}`}
                      >
                        {card.icon}
                      </div>
                      <div
                        className={`text-[27px] font-medium leading-[1.04] tracking-tight ${card.textClass}`}
                      >
                        {splitCardTitle(card.title)}
                      </div>
                      <div
                        className={`text-[17px] font-light leading-[1.25] tracking-tight opacity-70 ${card.subtextClass}`}
                      >
                        {card.subtitle}
                      </div>
                    </div>
                  </PatternCard>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex h-14 items-center gap-2">
          {introCards.map((card, index) => (
            <span
              key={`${card.key}-dot`}
              className={`h-1.5 rounded-full transition-[width,opacity,transform,background-color] duration-300 ${
                index === activeIndex ? "w-8 bg-[#ff6e00]" : "w-1.5 bg-white/25"
              } ${index <= activeIndex ? "opacity-100" : "opacity-30"} ${
                index === activeIndex ? "scale-110" : "scale-100"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function StudyView() {
  const { t } = useTranslation();
  const motionEnabled = useMotionPreference();
  const pdfUrl = useStore((state) => state.pdfUrl);
  const setPdfUrl = useStore((state) => state.setPdfUrl);
  const setPdfScale = useStore((state) => state.setPdfScale);
  const setPdfPage = useStore((state) => state.setPdfPage);
  const setPdfTotalPages = useStore((state) => state.setPdfTotalPages);
  const activeLearningBookId = useStore((state) => state.activeLearningBookId);
  const setActiveLearningBookId = useStore(
    (state) => state.setActiveLearningBookId,
  );
  const activeProject = useStore((state) => state.activeProject);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const learnerName = useStore((state) => state.learnerName);
  const activeUserId = useStore((state) => state.activeUserId);
  const activeDocumentId = useStore((state) => state.activeDocumentId);
  const setActiveDocumentId = useStore((state) => state.setActiveDocumentId);
  const removeAnnotationsForDocument = useStore(
    (state) => state.removeAnnotationsForDocument,
  );
  const setSelectedTextContext = useStore(
    (state) => state.setSelectedTextContext,
  );
  const askTutorQuery = useStore((state) => state.askTutorQuery);
  const [isDragging, setIsDragging] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    isMobileStudyViewport,
  );
  const [isChatOpen, setIsChatOpen] = useState(
    () => Boolean(pdfUrl) || isMobileStudyViewport(),
  );
  const [isChatFullscreen, setIsChatFullscreen] = useState(false);
  const [isMobilePdfOpen, setIsMobilePdfOpen] = useState(false);
  const [introCardStep, setIntroCardStep] = useState(0);
  const [introHeadlineIndex, setIntroHeadlineIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startedHeadlineRefs = useRef<Set<number>>(new Set());
  const completedHeadlineRefs = useRef<Set<number>>(new Set());
  const introTimersRef = useRef<number[]>([]);
  const activeIngestionCountRef = useRef(0);
  const cancelledIngestionDocumentIdsRef = useRef<Set<string>>(new Set());
  const chatSurfaceRef = useRef<HTMLElement | null>(null);
  const chatPanelFrameRef = useRef<HTMLDivElement | null>(null);
  const minimizedChatButtonRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenReturnFocusRef = useRef<HTMLElement | null>(null);
  const documentObjectUrlRef = useRef<string | null>(null);
  const documentObjectUrlIdRef = useRef<string | null>(null);

  const activeBook = useLiveQuery(
    () =>
      activeLearningBookId
        ? db.learningBooks.get(activeLearningBookId)
        : db.learningBooks.get(generalStudyBookIdForUser(activeUserId)),
    [activeLearningBookId, activeUserId],
  );
  const activeBookId = activeBook?.id || activeLearningBookId;
  const bookDocuments = useLiveQuery(
    () =>
      activeBookId
        ? db.learningDocuments.where("bookId").equals(activeBookId).toArray()
        : Promise.resolve([]),
    [activeBookId],
  );
  const areBookDocumentsLoaded = bookDocuments !== undefined;
  const orderedDocuments = React.useMemo(
    () => [...(bookDocuments || [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [bookDocuments],
  );
  const activeDocument =
    orderedDocuments.find((document) => document.id === activeDocumentId) ||
    null;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(MOBILE_STUDY_MEDIA_QUERY);
    const syncMobileViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
      if (mediaQuery.matches) {
        setIsChatOpen(true);
      } else {
        setIsMobilePdfOpen(false);
      }
    };

    syncMobileViewport();
    mediaQuery.addEventListener("change", syncMobileViewport);
    return () => mediaQuery.removeEventListener("change", syncMobileViewport);
  }, []);

  useEffect(() => {
    if (activeLearningBookId) return;
    let cancelled = false;
    void brainOrchestrator
      .ensureSessionLearningBook(
        learnerName || "Learner",
        "General Study",
        activeUserId,
      )
      .then((book) => {
        if (cancelled) return;
        if (!book.userId) {
          void db.learningBooks.update(book.id, { userId: activeUserId });
        }
        setActiveLearningBookId(book.id);
        setActiveProject(book.title);
      })
      .catch((error) =>
        console.warn("[StudyView] General Study bootstrap failed:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [
    activeLearningBookId,
    learnerName,
    activeUserId,
    setActiveLearningBookId,
    setActiveProject,
  ]);

  useEffect(() => {
    if (!areBookDocumentsLoaded) return;
    if (!activeBookId || orderedDocuments.length === 0) {
      if (activeDocumentId) setActiveDocumentId(null);
      return;
    }
    if (
      activeDocumentId &&
      orderedDocuments.some((document) => document.id === activeDocumentId)
    ) {
      return;
    }
    const preferred =
      orderedDocuments.find(
        (document) => document.id === activeBook?.activeDocumentId,
      ) || orderedDocuments[0];
    setActiveDocumentId(preferred.id);
  }, [
    activeBook?.activeDocumentId,
    activeBookId,
    activeDocumentId,
    areBookDocumentsLoaded,
    orderedDocuments,
    setActiveDocumentId,
  ]);

  useEffect(() => {
    if (!areBookDocumentsLoaded) return;

    if (
      activeDocument?.id &&
      documentObjectUrlIdRef.current === activeDocument.id &&
      documentObjectUrlRef.current
    ) {
      if (useStore.getState().pdfUrl !== documentObjectUrlRef.current) {
        setPdfUrl(documentObjectUrlRef.current);
      }
      return;
    }

    if (!activeDocument) {
      setPdfUrl(null);
      setPdfPage(1);
      setPdfTotalPages(0);
      documentObjectUrlRef.current = null;
      documentObjectUrlIdRef.current = null;
      return;
    }

    let url = "";
    try {
      url = getCachedDocumentObjectUrl(activeDocument) || "";
    } catch (error) {
      console.warn("[StudyView] Could not open stored PDF blob:", error);
      setPdfUrl(null);
      setPdfPage(1);
      setPdfTotalPages(0);
      documentObjectUrlRef.current = null;
      documentObjectUrlIdRef.current = null;
      return;
    }
    if (!url) {
      setPdfUrl(null);
      setPdfPage(1);
      setPdfTotalPages(0);
      documentObjectUrlRef.current = null;
      documentObjectUrlIdRef.current = null;
      return;
    }
    documentObjectUrlRef.current = url;
    documentObjectUrlIdRef.current = activeDocument.id;
    if (useStore.getState().pdfUrl !== url) {
      setPdfUrl(url);
    }
    setPdfScale(activeDocument.scale || 1);
    setPdfPage(activeDocument.lastViewedPage || 1);
    setPdfTotalPages(activeDocument.totalPages || 0);
    setIsChatOpen(true);
  }, [
    activeDocument?.id,
    activeDocument?.blob,
    activeDocument?.fileUrl,
    activeDocument?.lastViewedPage,
    activeDocument?.scale,
    activeDocument?.totalPages,
    areBookDocumentsLoaded,
    setPdfPage,
    setPdfScale,
    setPdfTotalPages,
    setPdfUrl,
  ]);

  const clearIntroTimers = useCallback(() => {
    introTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    introTimersRef.current = [];
  }, []);

  const scheduleIntro = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    introTimersRef.current.push(timer);
  }, []);

  useEffect(() => {
    if (pdfUrl) {
      clearIntroTimers();
      setIsChatOpen(true);
      return;
    }
    startedHeadlineRefs.current = new Set();
    completedHeadlineRefs.current = new Set();
    clearIntroTimers();
    if (!motionEnabled) {
      setIntroHeadlineIndex(2);
      setIntroCardStep(4);
      return;
    }
    setIntroHeadlineIndex(0);
    setIntroCardStep(0);
    return clearIntroTimers;
  }, [clearIntroTimers, motionEnabled, pdfUrl]);

  const handleIntroHeadlineStart = useCallback(
    (index: number) => {
      if (pdfUrl || startedHeadlineRefs.current.has(index)) return;
      startedHeadlineRefs.current.add(index);
      setIntroCardStep(Math.max(1, Math.min(3, index + 1)));
    },
    [pdfUrl],
  );

  const handleIntroHeadlineComplete = useCallback(
    (index: number) => {
      if (pdfUrl || completedHeadlineRefs.current.has(index)) return;
      completedHeadlineRefs.current.add(index);

      if (index === 0) {
        scheduleIntro(() => setIntroHeadlineIndex(1), 220);
        return;
      }

      if (index === 1) {
        scheduleIntro(() => setIntroHeadlineIndex(2), 240);
        return;
      }

      scheduleIntro(() => setIntroCardStep(4), 520);
    },
    [pdfUrl, scheduleIntro],
  );

  useEffect(() => {
    if (!isChatFullscreen) return;
    fullscreenReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = chatSurfaceRef.current;
    const focusTimer = window.setTimeout(() => frame?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      fullscreenReturnFocusRef.current?.focus?.();
      fullscreenReturnFocusRef.current = null;
    };
  }, [isChatFullscreen]);

  const openFilePicker = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const revealChatNode = (
    node: HTMLElement,
    from: { y: number; scale: number; filter: string },
    duration: number,
  ) => {
    gsap.killTweensOf(node);
    if (!motionEnabled || document.hidden) {
      gsap.set(node, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
      });
      return;
    }
    gsap.fromTo(
      node,
      { autoAlpha: 0, ...from },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        duration,
        ease: "power4.out",
      },
    );
  };

  const ensureActiveBook = async (): Promise<LearningBook> => {
    if (activeBook) {
      if (!activeBook.userId) {
        await db.learningBooks.update(activeBook.id, { userId: activeUserId });
        return { ...activeBook, userId: activeUserId };
      }
      return activeBook;
    }
    if (activeLearningBookId) {
      const existing = await db.learningBooks
        .get(activeLearningBookId)
        .catch((): undefined => undefined);
      if (existing) {
        if (!existing.userId) {
          await db.learningBooks.update(existing.id, { userId: activeUserId });
          return { ...existing, userId: activeUserId };
        }
        return existing;
      }
    }
    const book = await brainOrchestrator.ensureSessionLearningBook(
      learnerName || "Learner",
      activeProject || "General Study",
      activeUserId,
    );
    if (!book.userId) {
      await db.learningBooks.update(book.id, { userId: activeUserId });
      const scopedBook = { ...book, userId: activeUserId };
      setActiveLearningBookId(scopedBook.id);
      setActiveProject(scopedBook.title);
      return scopedBook;
    }
    setActiveLearningBookId(book.id);
    setActiveProject(book.title);
    return book;
  };

  const updateBookDocumentLinks = async (
    bookId: string,
    documentId: string | null,
  ): Promise<void> => {
    const book = await db.learningBooks
      .get(bookId)
      .catch((): undefined => undefined);
    const documents = await db.learningDocuments
      .where("bookId")
      .equals(bookId)
      .toArray()
      .catch((): LearningDocument[] => []);
    const documentIds = documents.map((document) => document.id);
    await db.learningBooks.update(bookId, {
      userId: activeUserId,
      documentIds,
      activeDocumentId: documentId || undefined,
      updatedAt: Date.now(),
      source: book?.source === "chat" ? "mixed" : book?.source || "mixed",
    });
  };

  const beginDocumentIngestion = () => {
    activeIngestionCountRef.current += 1;
    setIsIngesting(true);
  };

  const finishDocumentIngestion = () => {
    activeIngestionCountRef.current = Math.max(
      0,
      activeIngestionCountRef.current - 1,
    );
    setIsIngesting(activeIngestionCountRef.current > 0);
  };

  const isDocumentIngestionCancelled = (documentId: string) =>
    cancelledIngestionDocumentIdsRef.current.has(documentId);

  const ingestDocument = async (
    file: File,
    documentRecord: LearningDocument,
    book: LearningBook,
  ) => {
    cancelledIngestionDocumentIdsRef.current.delete(documentRecord.id);
    beginDocumentIngestion();
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentId", documentRecord.id);
      formData.append("bookId", book.id);
      formData.append("title", documentRecord.title);

      const apiKey = useStore.getState().apiKey;
      const res = await fetch("/api/documents/ingest", {
        method: "POST",
        body: formData,
        headers: learnerRequestHeaders(
          useStore.getState().activeUserId,
          apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        ),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (isDocumentIngestionCancelled(documentRecord.id)) return;
      console.info("Document classification:", data.classification);

      const extractedText = String(data.content || "").trim();
      const serverDocument = data.serverDocument || null;
      const nextDocument: Partial<LearningDocument> = {
        userId: activeUserId,
        storageProvider: serverDocument ? "server-local" : "indexeddb-cache",
        fileUrl: serverDocument?.fileUrl,
        textUrl: serverDocument?.textUrl,
        textPreview: serverDocument?.textPreview || extractedText,
        extractedText: serverDocument?.textPreview || extractedText,
        blob: serverDocument ? undefined : documentRecord.blob,
        classification: data.classification,
        extractionMode: data.extractionMode,
        totalPages: data.totalPages,
        processingStatus: "ready",
        updatedAt: Date.now(),
      };
      await db.learningDocuments.update(documentRecord.id, nextDocument);
      if (isDocumentIngestionCancelled(documentRecord.id)) return;

      if (data.content && data.content.trim()) {
        const updatedBook =
          await brainOrchestrator.updateLearningBookFromConversation({
            userId: activeUserId,
            userName: book.userName || learnerName || "Learner",
            activeProject: book.title,
            activeBookId: book.id,
            activeDocumentId: documentRecord.id,
            conversationId: `document:${documentRecord.id}`,
            documentContexts: [
              {
                id: documentRecord.id,
                title: documentRecord.title,
                classification: data.classification,
                extractionMode: data.extractionMode,
                extractedText,
              },
            ],
            userMessage: `I uploaded ${documentRecord.title}, a document classified as ${data.classification} using ${data.extractionMode || "document extraction"}.`,
            assistantMessage: `I have ingested the document. Here is the extracted text context:\n\n${extractedText.slice(0, 10000)}`,
            apiKey,
          });
        if (updatedBook) {
          setActiveLearningBookId(updatedBook.id);
          setActiveProject(updatedBook.title);
        }
      }
    } catch (e) {
      if (!isDocumentIngestionCancelled(documentRecord.id)) {
        console.error("Ingestion failed:", e);
        await db.learningDocuments.update(documentRecord.id, {
          processingStatus: "failed",
          error: e instanceof Error ? e.message : String(e),
          updatedAt: Date.now(),
        });
      }
    } finally {
      finishDocumentIngestion();
      cancelledIngestionDocumentIdsRef.current.delete(documentRecord.id);
    }
  };

  const attachDocuments = async (files: File[]) => {
    const pdfFiles = files.filter((file) => file.type === "application/pdf");
    if (!pdfFiles.length) return;
    const book = await ensureActiveBook();
    const now = Date.now();
    const documentRecords = pdfFiles.map(
      (file, index): LearningDocument => ({
        id: `doc:${crypto.randomUUID()}`,
        userId: activeUserId,
        bookId: book.id,
        title: file.name.replace(/\.pdf$/i, "").trim() || "Untitled PDF",
        mimeType: file.type || "application/pdf",
        size: file.size,
        storageProvider: "indexeddb-cache",
        blob: file.slice(0, file.size, file.type || "application/pdf"),
        processingStatus: "processing",
        createdAt: now + index,
        updatedAt: now + pdfFiles.length - index,
        lastViewedPage: 1,
      }),
    );
    const activeUploadedDocumentId = documentRecords[0]?.id;
    await db.learningDocuments.bulkPut(documentRecords);
    await updateBookDocumentLinks(book.id, activeUploadedDocumentId || null);
    setActiveLearningBookId(book.id);
    setActiveProject(book.title);
    setActiveDocumentId(activeUploadedDocumentId || null);
    setSelectedTextContext("");
    setIsChatOpen(true);
    setIsMobilePdfOpen(false);
    documentRecords.forEach((documentRecord, index) => {
      void ingestDocument(pdfFiles[index], documentRecord, book);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.some((file) => file.type === "application/pdf")) {
      void attachDocuments(files);
    }
    e.currentTarget.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.some((file) => file.type === "application/pdf")) {
      void attachDocuments(files);
    }
  };

  const selectDocument = async (document: LearningDocument) => {
    setActiveLearningBookId(document.bookId);
    if (activeBook) setActiveProject(activeBook.title);
    setActiveDocumentId(document.id);
    setSelectedTextContext("");
    await updateBookDocumentLinks(document.bookId, document.id);
  };

  const removeDocument = async (documentId: string) => {
    const document = orderedDocuments.find((item) => item.id === documentId);
    if (!document) return;
    const removedActiveDocument = documentId === activeDocumentId;
    cancelledIngestionDocumentIdsRef.current.add(documentId);
    if (removedActiveDocument) {
      setSelectedTextContext("");
    }
    await db.learningDocuments.delete(documentId);
    removeAnnotationsForDocument(documentId);
    const remainingDocuments = orderedDocuments.filter(
      (item) => item.id !== documentId,
    );
    const nextDocument = removedActiveDocument
      ? remainingDocuments[0] || null
      : remainingDocuments.find((item) => item.id === activeDocumentId) ||
        remainingDocuments[0] ||
        null;
    revokeCachedDocumentObjectUrl(documentId);
    await updateBookDocumentLinks(document.bookId, nextDocument?.id || null);
    setActiveDocumentId(nextDocument?.id || null);
    if (!nextDocument) {
      setPdfUrl(null);
      setPdfPage(1);
      setPdfTotalPages(0);
      setIsMobilePdfOpen(false);
    }
  };

  const shouldRenderChatSurface = isChatOpen;
  const documentSurfaceLayout = pdfUrl
    ? isMobilePdfOpen
      ? "flex min-h-0 flex-1 md:min-h-[42dvh]"
      : "hidden md:flex md:min-h-[42dvh]"
    : isChatOpen
      ? "hidden md:flex md:min-h-[46dvh]"
      : "flex min-h-[calc(100dvh-5rem)]";

  const openMobilePdf = () => {
    setIsMobilePdfOpen(true);
    setIsChatOpen(true);
  };

  const returnToMobileChat = () => {
    setIsMobilePdfOpen(false);
    setIsChatOpen(true);
  };

  const closeChat = () => {
    setIsChatFullscreen(false);
    if (isMobileViewport && pdfUrl) {
      setIsMobilePdfOpen(true);
      return;
    }
    setIsChatOpen(false);
  };

  useLayoutEffect(() => {
    if (!shouldRenderChatSurface || !chatSurfaceRef.current) return;
    revealChatNode(
      chatSurfaceRef.current,
      { y: 28, scale: 0.985, filter: "blur(12px)" },
      0.86,
    );
  }, [motionEnabled, shouldRenderChatSurface]);

  useLayoutEffect(() => {
    if (!isChatOpen || !chatPanelFrameRef.current) return;
    revealChatNode(
      chatPanelFrameRef.current,
      {
        y: 16,
        scale: 0.985,
        filter: "blur(8px)",
      },
      0.42,
    );
  }, [isChatOpen, motionEnabled]);

  useLayoutEffect(() => {
    if (isChatOpen || !minimizedChatButtonRef.current) return;
    revealChatNode(
      minimizedChatButtonRef.current,
      { y: 8, scale: 0.9, filter: "blur(8px)" },
      0.42,
    );
  }, [isChatOpen, motionEnabled, pdfUrl]);

  useEffect(() => {
    if (askTutorQuery.trim()) {
      setIsChatOpen(true);
      setIsMobilePdfOpen(false);
    }
  }, [askTutorQuery]);

  return (
    <div className="relative flex h-full w-full flex-col gap-3 overflow-hidden bg-[#050505] px-3 pb-3 pt-16 md:gap-5 md:overflow-y-auto md:px-5 md:pb-6 md:pt-20 xl:h-[100dvh] xl:flex-row xl:gap-8 xl:overflow-hidden xl:px-8 xl:pb-8 xl:pt-24">
      <div
        data-testid="study-document-surface"
        className={`relative w-full shrink flex-col overflow-hidden shadow-none transition-[flex-basis,width,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] xl:h-full xl:min-h-0 ${
          pdfUrl
            ? "gap-1 rounded-none border border-transparent bg-transparent"
            : "rounded-none border-0 bg-transparent"
        } ${documentSurfaceLayout}`}
      >
        {pdfUrl ? (
          <>
            <input
              type="file"
              accept="application/pdf"
              multiple
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
            />
            <div
              data-testid="pdf-reader-region"
              className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#1a1a1a] bg-[#0A0A0B] shadow-none"
            >
              <div
                role="toolbar"
                aria-label="PDF documents"
                data-testid="pdf-document-toolbar"
                className="relative z-0 flex min-h-9 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0A0A0B] py-1 pl-2 pr-12 shadow-none md:pr-2"
              >
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-1 custom-scroll">
                  {orderedDocuments.map((document) => (
                    <div
                      key={document.id}
                      data-testid="pdf-document-chip"
                      className={`group flex h-7 max-w-[9.5rem] shrink-0 items-center rounded-full border px-1 shadow-none [box-shadow:none] md:max-w-[11rem] ${
                        document.id === activeDocumentId
                          ? "border-white bg-white text-black"
                          : "border-zinc-200 bg-white/95 text-black hover:border-white hover:bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void selectDocument(document)}
                        aria-pressed={document.id === activeDocumentId}
                        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-0.5 pr-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                        title={document.title}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                            document.id === activeDocumentId
                              ? "bg-black text-white"
                              : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          <FileText size={9} strokeWidth={2.1} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.66rem] font-semibold leading-none tracking-normal">
                            {document.title}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeDocument(document.id)}
                        aria-label={`Remove ${document.title}`}
                        title={`Remove ${document.title}`}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 shadow-none [box-shadow:none] transition-colors hover:bg-zinc-200 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/40"
                      >
                        <X size={13} strokeWidth={2.2} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={openFilePicker}
                  aria-label="Add PDF"
                  title="Add PDF"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-500 bg-transparent text-zinc-400 shadow-none [box-shadow:none] transition-colors hover:border-zinc-200 hover:bg-white hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Plus size={17} strokeWidth={1.9} />
                </button>
                <button
                  type="button"
                  onClick={returnToMobileChat}
                  aria-label="Return to tutor chat"
                  className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-zinc-500 bg-transparent px-2 text-[0.66rem] font-semibold text-zinc-300 shadow-none [box-shadow:none] transition-colors hover:border-zinc-200 hover:bg-white hover:text-zinc-800 focus:outline-none md:hidden"
                >
                  <MessageSquare size={12} strokeWidth={2} />
                  Chat
                </button>
                {!isChatOpen && (
                  <button
                    ref={minimizedChatButtonRef}
                    type="button"
                    onClick={() => setIsChatOpen(true)}
                    aria-label="Open tutor chat"
                    data-testid="pdf-toolbar-chat-button"
                    title="Open tutor chat"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-transparent text-zinc-400 shadow-none [box-shadow:none] transition-colors hover:border-zinc-200 hover:bg-white hover:text-zinc-800 focus:outline-none"
                  >
                    <MessageSquare size={13} strokeWidth={2} />
                  </button>
                )}
              </div>
              <div data-testid="pdf-viewer-frame" className="min-h-0 flex-1">
                <PdfViewer />
              </div>
            </div>
          </>
        ) : (
          <StudyIntroSplash
            cardStep={introCardStep}
            headlineIndex={introHeadlineIndex}
            motionEnabled={motionEnabled}
            isDragging={isDragging}
            isIngesting={isIngesting}
            fileInputRef={fileInputRef}
            setIsDragging={setIsDragging}
            openFilePicker={openFilePicker}
            handleDrop={handleDrop}
            handleFileChange={handleFileChange}
            onHeadlineStart={handleIntroHeadlineStart}
            onHeadlineComplete={handleIntroHeadlineComplete}
            t={t}
          />
        )}

        {!isChatOpen && !pdfUrl && (
          <button
            ref={minimizedChatButtonRef}
            type="button"
            onClick={() => setIsChatOpen(true)}
            aria-label="Open tutor chat"
            className="group absolute bottom-5 right-5 z-[70] flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-[#0a0a0a] text-white opacity-0 shadow-[0_18px_48px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)] outline-none transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-[#ff6e00]/45 hover:shadow-[0_22px_54px_rgba(255,110,0,0.2)] active:scale-95 md:bottom-6 md:right-6"
          >
            <span className="absolute inset-[2px] rounded-full bg-[linear-gradient(180deg,#242427_0%,#111113_52%,#050505_100%)]" />
            <span
              className="absolute inset-[5px] rounded-full opacity-35 mix-blend-overlay"
              style={{
                backgroundImage:
                  "radial-gradient(circle at center, rgba(255,255,255,0.9) 1px, transparent 1px)",
                backgroundSize: "4px 4px",
              }}
            />
            <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_15%,rgba(255,110,0,0.3),transparent_45%)] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
            <MessageSquare className="relative z-10 h-5 w-5 text-zinc-100" />
          </button>
        )}
      </div>

      {shouldRenderChatSurface && (
        <aside
          ref={chatSurfaceRef}
          data-testid="study-chat-surface"
          role={isChatFullscreen ? "dialog" : undefined}
          aria-modal={isChatFullscreen ? "true" : undefined}
          aria-label={isChatFullscreen ? "Fullscreen tutor chat" : undefined}
          tabIndex={isChatFullscreen ? -1 : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isChatFullscreen) {
              event.stopPropagation();
              setIsChatFullscreen(false);
            }
          }}
          className={`${
            isChatFullscreen
              ? "fixed inset-0 z-[90] flex bg-[#050505] p-3 md:p-6"
              : `${isMobilePdfOpen ? "hidden md:flex" : "flex"} h-full max-h-none w-full flex-1 md:h-auto md:max-h-[54dvh] md:flex-none xl:h-[calc(100%-0.5rem)] xl:max-h-none xl:w-[36%] xl:max-w-[560px] xl:flex-none xl:self-center`
          } min-h-0 origin-bottom-right flex-col gap-2 md:min-h-[360px] md:gap-3`}
        >
          {pdfUrl && (
            <section
              aria-label="Attached PDF context"
              data-testid="mobile-pdf-context"
              className="mr-10 flex shrink-0 flex-col gap-2 rounded-lg border border-white/10 bg-[#0A0A0B] p-2 md:mr-0 md:hidden"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black">
                  <FileText size={13} strokeWidth={2.1} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.62rem] font-semibold uppercase text-zinc-500">
                    Attached PDF
                  </p>
                  <p className="truncate text-xs font-medium text-zinc-100">
                    {activeDocument?.title || "Study document"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openMobilePdf}
                  className="h-8 shrink-0 rounded-md border border-white/15 bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-zinc-200 focus:outline-none"
                >
                  View PDF
                </button>
              </div>
              {orderedDocuments.length > 1 && (
                <div
                  aria-label="Switch attached PDF"
                  className="flex min-w-0 gap-1.5 overflow-x-auto custom-scroll"
                >
                  {orderedDocuments.map((document) => (
                    <button
                      key={`mobile-context-${document.id}`}
                      type="button"
                      aria-label={`Use ${document.title} as attached PDF context`}
                      aria-pressed={document.id === activeDocumentId}
                      onClick={() => void selectDocument(document)}
                      className={`h-7 max-w-[10rem] shrink-0 truncate rounded-md border px-2 text-[0.68rem] font-medium transition-colors ${
                        document.id === activeDocumentId
                          ? "border-white bg-white text-black"
                          : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25 hover:bg-white/10"
                      }`}
                    >
                      {document.title}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {!pdfUrl && (
            <section
              aria-label="Attach PDF context"
              data-testid="mobile-pdf-attach"
              className="mr-10 flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-[#0A0A0B] p-2 md:mr-0 md:hidden"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-black">
                <FileText size={13} strokeWidth={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.62rem] font-semibold uppercase text-zinc-500">
                  Study context
                </p>
                <p className="truncate text-xs font-medium text-zinc-100">
                  Ask freely or attach PDFs
                </p>
              </div>
              <button
                type="button"
                onClick={openFilePicker}
                aria-label="Attach PDF"
                className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-white/15 bg-white px-3 text-xs font-semibold text-black transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <Plus size={13} strokeWidth={2.2} />
                Attach
              </button>
            </section>
          )}
          <div
            key="chat-panel"
            ref={chatPanelFrameRef}
            className={`min-h-0 flex-1 overflow-hidden bg-[#fdfdfd] text-[#050505] ring-1 ring-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] origin-bottom ${
              isChatFullscreen ? "rounded-2xl" : "rounded-3xl"
            }`}
          >
            <ChatPanel
              onClose={closeChat}
              isFullscreen={isChatFullscreen}
              onToggleFullscreen={() =>
                setIsChatFullscreen((fullscreen) => !fullscreen)
              }
            />
          </div>
        </aside>
      )}
    </div>
  );
}
