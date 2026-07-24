import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gsap } from "gsap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Navigation } from "../src/components/Navigation";
import { useStore, type ViewState } from "../src/store";

type MatchMediaController = {
  listeners: Set<() => void>;
  setMatches: (matches: boolean) => void;
};

const routeCases: ReadonlyArray<{
  id: ViewState;
  label: string;
}> = [
  { id: "study", label: "Study" },
  { id: "analytics", label: "Analytics" },
  { id: "revision", label: "Revision" },
  { id: "admin", label: "Admin" },
];

const userRouteCases = routeCases.filter(({ id }) => id !== "admin");
const nonRevisionUserRouteCases = userRouteCases.filter(
  ({ id }) => id !== "revision",
);

const resetNavigationStore = () => {
  useStore.setState({
    accessMode: "user",
    activeView: "study",
    animationsEnabled: false,
    language: "en",
  });
};

const renderNavigation = ({
  accessMode = "user",
  activeView = "study",
  animationsEnabled = false,
}: {
  accessMode?: "user" | "admin";
  activeView?: ViewState;
  animationsEnabled?: boolean;
} = {}) => {
  useStore.setState({ accessMode, activeView, animationsEnabled });
  return render(<Navigation />);
};

const buttonFor = (label: string) =>
  screen.getByRole("button", { name: label });

const navShell = () => buttonFor("Study").parentElement as HTMLDivElement;

const installMatchMedia = ({
  reducedMotion = false,
  coarsePointer = false,
}: {
  reducedMotion?: boolean;
  coarsePointer?: boolean;
} = {}): MatchMediaController => {
  const listeners = new Set<() => void>();
  let reduced = reducedMotion;

  vi.stubGlobal("matchMedia", (query: string) => {
    const isReducedMotion = query.includes("prefers-reduced-motion");
    const isCoarsePointer = query.includes("pointer: coarse");
    return {
      get matches() {
        return isReducedMotion ? reduced : isCoarsePointer && coarsePointer;
      },
      media: query,
      onchange: null as
        | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown)
        | null,
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "change" && isReducedMotion) listeners.add(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "change" && isReducedMotion) listeners.delete(listener);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  return {
    listeners,
    setMatches: (matches: boolean) => {
      reduced = matches;
      for (const listener of listeners) listener();
    },
  };
};

beforeEach(() => {
  resetNavigationStore();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Navigation rendered route contract", () => {
  it("renders the user route set by default", () => {
    renderNavigation();

    expect(screen.getAllByRole("button")).toHaveLength(3);
    for (const { label } of userRouteCases) {
      expect(buttonFor(label)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("renders the admin route only for admin access", () => {
    renderNavigation({ accessMode: "admin" });

    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(buttonFor("Admin")).toBeInTheDocument();
  });

  it("uses real button elements instead of links for every route", () => {
    renderNavigation({ accessMode: "admin" });

    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    }
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the compact glass shell classes stable", () => {
    renderNavigation();

    expect(navShell()).toHaveClass(
      "relative",
      "flex",
      "w-full",
      "items-center",
      "rounded-full",
      "overflow-hidden",
    );
  });

  it("uses the darker revision shell background only on the revision route", () => {
    renderNavigation({ activeView: "revision" });

    expect(navShell()).toHaveStyle({
      background: "rgba(10, 10, 12, 0.85)",
    });
  });

  it.each(nonRevisionUserRouteCases)(
    "uses the default shell background on the %s route",
    ({ id }) => {
      renderNavigation({ activeView: id });

      expect(navShell()).toHaveStyle({
        background: "rgba(28, 28, 30, 0.4)",
      });
    },
  );

  it.each(routeCases)("marks %s active with aria-current", ({ id, label }) => {
    renderNavigation({ accessMode: "admin", activeView: id });

    expect(buttonFor(label)).toHaveAttribute("aria-current", "page");
    for (const route of routeCases.filter((route) => route.id !== id)) {
      expect(buttonFor(route.label)).not.toHaveAttribute("aria-current");
    }
  });

  it.each(routeCases)(
    "moves active state after clicking %s",
    async ({ id, label }) => {
      const user = userEvent.setup();
      renderNavigation({ accessMode: "admin" });

      await user.click(buttonFor(label));

      expect(useStore.getState().activeView).toBe(id);
      expect(buttonFor(label)).toHaveAttribute("aria-current", "page");
    },
  );

  it("removes the Admin button when access drops back to user mode", () => {
    const { rerender } = renderNavigation({ accessMode: "admin" });

    expect(buttonFor("Admin")).toBeInTheDocument();
    act(() => {
      useStore.setState({ accessMode: "user" });
    });
    rerender(<Navigation />);

    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("hides the active pill when the active route is not rendered", () => {
    renderNavigation({ accessMode: "user", activeView: "admin" });

    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      autoAlpha: 0,
    });
  });

  it("keeps icons decorative inside named route buttons", () => {
    renderNavigation({ accessMode: "admin" });

    for (const { label } of routeCases) {
      const button = buttonFor(label);
      expect(button.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(button).toHaveAccessibleName(label);
    }
  });
});

describe("Navigation motion and active-pill behavior", () => {
  it("never spins a rotating border (the liquid border was removed)", () => {
    renderNavigation({ animationsEnabled: true });

    expect(gsap.to).not.toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ rotate: 360 }),
    );
  });

  it("uses zero-duration active-pill movement when motion is disabled", () => {
    renderNavigation({ activeView: "analytics", animationsEnabled: false });

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        autoAlpha: 1,
        duration: 0,
        ease: "power3.out",
      }),
    );
  });

  it("uses spring-like active-pill movement when motion is enabled", () => {
    renderNavigation({ activeView: "analytics", animationsEnabled: true });

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        autoAlpha: 1,
        duration: 0.42,
        ease: "power3.out",
      }),
    );
  });

  it("stops motion when reduced-motion media preference is active", () => {
    installMatchMedia({ reducedMotion: true });

    renderNavigation({ animationsEnabled: true });

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ duration: 0 }),
    );
    expect(gsap.to).not.toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ rotate: 360 }),
    );
  });

  it("reacts to reduced-motion preference changes after mount", () => {
    const media = installMatchMedia({ reducedMotion: false });
    const { rerender } = renderNavigation({ animationsEnabled: true });

    act(() => {
      media.setMatches(true);
    });
    rerender(<Navigation />);

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ duration: 0 }),
    );
  });

  it("registers and removes the active-pill resize listener", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderNavigation();

    expect(addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
  });

  it("repositions the active pill on window resize", () => {
    renderNavigation({ activeView: "analytics" });
    vi.mocked(gsap.to).mockClear();

    fireEvent.resize(window);

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ autoAlpha: 1 }),
    );
  });
});

describe("Navigation pointer spotlight behavior", () => {
  it("activates the spotlight on mouse enter", () => {
    renderNavigation();

    fireEvent.mouseEnter(navShell());

    expect(
      navShell().querySelector("div[style*='radial-gradient']"),
    ).toHaveStyle({
      opacity: "1",
    });
  });

  it("deactivates the spotlight on mouse leave", () => {
    renderNavigation();

    fireEvent.mouseEnter(navShell());
    fireEvent.mouseLeave(navShell());

    expect(
      navShell().querySelector("div[style*='radial-gradient']"),
    ).toHaveStyle({
      opacity: "0",
    });
  });

  it("tracks fine-pointer mouse position in the spotlight gradient", () => {
    renderNavigation();
    vi.spyOn(navShell(), "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 10,
      left: 20,
      right: 220,
      bottom: 110,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseMove(navShell(), { clientX: 70, clientY: 40 });

    const gradients = navShell().querySelectorAll(
      "div[style*='radial-gradient']",
    );
    expect(gradients[0]).toHaveStyle({
      background:
        "radial-gradient(140px circle at 50px 30px, rgba(255,255,255,0.10), transparent 70%)",
    });
  });

  it("ignores mouse movement on coarse pointers", () => {
    installMatchMedia({ coarsePointer: true });
    renderNavigation();

    fireEvent.mouseMove(navShell(), { clientX: 70, clientY: 40 });

    const gradients = navShell().querySelectorAll(
      "div[style*='radial-gradient']",
    );
    expect(gradients[0]).toHaveStyle({
      background:
        "radial-gradient(140px circle at 0px 0px, rgba(255,255,255,0.10), transparent 70%)",
    });
  });

  it("removes spotlight transition timing when motion is disabled", () => {
    renderNavigation({ animationsEnabled: false });

    const gradients = navShell().querySelectorAll(
      "div[style*='radial-gradient']",
    );
    expect(gradients[0]).toHaveStyle({ transitionDuration: "0ms" });
  });

  it("uses the animated spotlight transition timing when motion is enabled", () => {
    renderNavigation({ animationsEnabled: true });

    const gradients = navShell().querySelectorAll(
      "div[style*='radial-gradient']",
    );
    expect(gradients[0]).toHaveStyle({ transitionDuration: "300ms" });
  });
});

describe("Navigation store integration", () => {
  it("preserves unrelated learner settings while changing route", async () => {
    const user = userEvent.setup();
    useStore.setState({ learnerName: "Ada", language: "en" });
    renderNavigation();

    await user.click(buttonFor("Revision"));

    expect(useStore.getState().activeView).toBe("revision");
    expect(useStore.getState().learnerName).toBe("Ada");
    expect(useStore.getState().language).toBe("en");
  });

  it("does not persist activeView to localStorage during route changes", async () => {
    const user = userEvent.setup();
    renderNavigation();

    await user.click(buttonFor("Analytics"));

    expect(localStorage.getItem("activeView")).toBeNull();
    expect(localStorage.getItem("learningai-active-view")).toBeNull();
  });

  it("keeps the route button order stable for users", () => {
    renderNavigation();

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["StudyStudy", "AnalyticsAnalytics", "RevisionRevision"]);
  });

  it("keeps the route button order stable for admins", () => {
    renderNavigation({ accessMode: "admin" });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual([
      "StudyStudy",
      "AnalyticsAnalytics",
      "RevisionRevision",
      "AdminAdmin",
    ]);
  });

  it("keeps every visible route focusable", () => {
    renderNavigation({ accessMode: "admin" });

    for (const button of screen.getAllByRole("button")) {
      button.focus();
      expect(button).toHaveFocus();
    }
  });

  it("keeps every route on the responsive flex sizing contract", () => {
    renderNavigation({ accessMode: "admin" });

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass(
        "min-w-0",
        "flex-1",
        "sm:min-w-[4.35rem]",
        "sm:flex-none",
      );
    }
  });

  it("keeps active and inactive route palettes distinct", () => {
    renderNavigation({ activeView: "study" });

    expect(buttonFor("Study")).toHaveClass("text-white");
    expect(buttonFor("Analytics")).toHaveClass(
      "text-zinc-400",
      "hover:text-zinc-200",
      "hover:bg-white/5",
    );
  });
});
