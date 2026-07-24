import React, { useLayoutEffect, useRef, useState } from "react";
import { useStore, ViewState } from "../store";
import { BookOpen, Zap, Activity, ShieldCheck } from "lucide-react";
import { gsap } from "gsap";
import { useTranslation } from "../lib/translations";
import { useMotionPreference } from "../hooks/useMotionPreference";

export function Navigation() {
  const { activeView, setActiveView, accessMode } = useStore();
  const { t } = useTranslation();
  const motionEnabled = useMotionPreference();
  const navContainerRef = useRef<HTMLDivElement>(null);
  const activePillRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<
    Partial<Record<ViewState, HTMLButtonElement | null>>
  >({});
  const [spotlight, setSpotlight] = useState({
    x: 0,
    y: 0,
    active: false,
  });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSpotlight({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    });
  };

  const navItems: { id: ViewState; label: string; icon: React.ReactNode }[] = [
    { id: "study", label: t("study"), icon: <BookOpen size={14} /> },
    { id: "analytics", label: t("analytics"), icon: <Activity size={14} /> },
    { id: "revision", label: t("revision"), icon: <Zap size={14} /> },
    ...(accessMode === "admin"
      ? [
          {
            id: "admin" as ViewState,
            label: t("admin"),
            icon: <ShieldCheck size={14} />,
          },
        ]
      : []),
  ];

  useLayoutEffect(() => {
    const updateActivePill = () => {
      const container = navContainerRef.current;
      const pill = activePillRef.current;
      const button = buttonRefs.current[activeView];
      if (!container || !pill || !button) {
        if (activePillRef.current) {
          gsap.set(activePillRef.current, { autoAlpha: 0 });
        }
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      gsap.to(pill, {
        autoAlpha: 1,
        x: buttonRect.left - containerRect.left,
        y: buttonRect.top - containerRect.top,
        width: buttonRect.width,
        height: buttonRect.height,
        duration: motionEnabled ? 0.42 : 0,
        ease: "power3.out",
      });
    };

    updateActivePill();
    window.addEventListener("resize", updateActivePill);
    return () => window.removeEventListener("resize", updateActivePill);
  }, [activeView, accessMode, motionEnabled]);

  return (
    <div className="absolute left-1/2 top-4 z-50 w-[calc(100%-1.25rem)] max-w-[28rem] -translate-x-1/2 pointer-events-auto sm:w-fit">
      <div
        ref={navContainerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() =>
          setSpotlight((current) => ({ ...current, active: true }))
        }
        onMouseLeave={() =>
          setSpotlight((current) => ({ ...current, active: false }))
        }
        className="relative flex w-full items-center justify-between gap-1 overflow-hidden rounded-full p-1 shadow-2xl transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-300 sm:justify-center"
        style={{
          background:
            activeView === "revision"
              ? "rgba(10, 10, 12, 0.85)"
              : "rgba(28, 28, 30, 0.4)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow:
            "0 20px 50px -10px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.1)",
        }}
      >
        <div
          ref={activePillRef}
          className="pointer-events-none absolute left-0 top-0 z-[8] rounded-full border border-white/15 bg-white/[0.12] opacity-0 shadow-[0_1px_6px_rgba(0,0,0,0.25)]"
        />

        {/* Clean rounded hairline ring — inset box-shadow follows the pill's
            rounded-full shape exactly, so there are no boxy corners at the ends. */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            boxShadow:
              "inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 1px rgba(255,255,255,0.08)",
          }}
        />

        {/* Mouse-tracking spotlight — a single soft highlight, clipped to the
            rounded pill so it never reads as a square glow at the edges. */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
          <div
            className="absolute inset-0 transition-opacity"
            style={{
              opacity: spotlight.active ? 1 : 0,
              transitionDuration: motionEnabled ? "300ms" : "0ms",
              background: `radial-gradient(140px circle at ${spotlight.x}px ${spotlight.y}px, rgba(255,255,255,0.10), transparent 70%)`,
            }}
          />
        </div>

        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              type="button"
              key={item.id}
              ref={(node) => {
                buttonRefs.current[item.id] = node;
              }}
              onClick={() => setActiveView(item.id)}
              aria-label={item.label}
              className={`relative z-10 flex min-w-0 flex-1 transform-gpu select-none items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-[9.5px] font-medium transition-colors focus:outline-none sm:min-w-[4.35rem] sm:flex-none sm:gap-[0.3125rem] sm:px-[0.5625rem] sm:py-1.5 sm:text-[10.5px] ${
                isActive
                  ? "text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              }`}
              style={{ contain: "layout paint" }}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="relative z-[15] flex items-center justify-center gap-1.5 sm:gap-1.5">
                {item.icon}
                <span className="hidden sm:inline-block">{item.label}</span>
                <span className="sm:hidden">{item.label.split(" ")[0]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
