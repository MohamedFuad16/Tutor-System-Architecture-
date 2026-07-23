import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { gsap } from "gsap";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsButton } from "../src/components/SettingsModal";
import { useStore } from "../src/store";

let fetchMock: ReturnType<typeof vi.fn>;

const deferredFetch = () => {
  let resolveFetch!: (value: { ok: boolean }) => void;
  const promise = new Promise<{ ok: boolean }>((resolve) => {
    resolveFetch = resolve;
  });
  return { promise, resolveFetch };
};

const resetSettingsStore = () => {
  localStorage.clear();
  useStore.setState({
    accessMode: "user",
    activeView: "study",
    planTier: "free",
    apiKey: "",
    serperApiKey: "",
    deepgramApiKey: "",
    learnerName: "Learner",
    ttsVoice: "aura-asteria-en",
    misoTtsApiUrl: "http://127.0.0.1:8080",
    aiModel: "deepseek/deepseek-v4-flash",
    animationsEnabled: true,
    systemPrompt: "",
    language: "en",
    chatUsage: {
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      estimated: false,
      requests: 0,
    },
    voiceUsage: {
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
    },
    webUsage: {
      provider: "serper",
      requests: 0,
      searchRequests: 0,
      newsRequests: 0,
      sourcesReviewed: 0,
      failures: 0,
      cost: 0,
      estimated: true,
    },
    totalTokens: 0,
    estimatedCost: 0,
  });
};

const openSettings = async () => {
  const user = userEvent.setup();
  render(<SettingsButton />);
  await user.click(screen.getByRole("button", { name: "App Settings" }));
  return user;
};

beforeEach(() => {
  resetSettingsStore();
  fetchMock = vi.fn(async () => {
    throw new Error("Unexpected provider validation request in SettingsModal");
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rendered SettingsModal", () => {
  it("renders the settings trigger as an icon-only fixed button", () => {
    render(<SettingsButton />);

    const button = screen.getByRole("button", { name: "App Settings" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("fixed", "right-4", "top-[4.35rem]", "z-50");
    expect(button.querySelector("svg")).toBeInTheDocument();
    expect(button).not.toHaveTextContent("App Settings");
  });

  it("starts the trigger border spin when motion is enabled", () => {
    render(<SettingsButton />);

    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      rotate: 0,
    });
    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        rotate: 360,
        duration: 4,
        repeat: -1,
        ease: "none",
      }),
    );
  });

  it("does not start the trigger border spin when animations are disabled", () => {
    useStore.setState({ animationsEnabled: false });
    render(<SettingsButton />);

    expect(gsap.set).toHaveBeenCalledWith(expect.any(HTMLDivElement), {
      rotate: 0,
    });
    expect(gsap.to).not.toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ rotate: 360 }),
    );
  });

  it("uses the revision-aware trigger surface while Revision is active", () => {
    useStore.setState({ activeView: "revision" });
    render(<SettingsButton />);

    const button = screen.getByRole("button", { name: "App Settings" });
    expect(button.querySelector(".w-full.h-full.rounded-full")).toHaveStyle({
      background: "rgba(10, 10, 12, 0.85)",
    });
  });

  it("opens and closes from the close button and Cancel action", async () => {
    const user = userEvent.setup();
    render(<SettingsButton />);

    await user.click(screen.getByRole("button", { name: "App Settings" }));
    expect(
      screen.getByRole("heading", { name: "App Settings" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("heading", { name: "App Settings" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "App Settings" }));
    expect(
      screen.getByRole("heading", { name: "App Settings" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "App Settings" })).toBeNull();
  });

  it("closes from the backdrop when not validating", async () => {
    await openSettings();

    fireEvent.click(document.querySelector(".fixed.inset-0.z-\\[100\\]")!);

    expect(screen.queryByRole("heading", { name: "App Settings" })).toBeNull();
  });

  it("renders the modal frame with bounded scrolling layout classes", async () => {
    await openSettings();

    const frame = screen
      .getByRole("heading", { name: "App Settings" })
      .closest(".pointer-events-auto");
    expect(frame).toHaveClass(
      "max-h-[min(720px,calc(100dvh-2rem))]",
      "max-w-2xl",
      "overflow-hidden",
    );
  });

  it("animates the modal and active tab panel when opened", async () => {
    await openSettings();

    expect(gsap.fromTo).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ autoAlpha: 0 }),
      expect.objectContaining({ autoAlpha: 1, ease: "power2.out" }),
    );
    expect(gsap.fromTo).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ y: 16, scale: 0.975 }),
      expect.objectContaining({ y: 0, scale: 1, ease: "power4.out" }),
    );
  });

  it("uses zero-duration modal animation when motion is disabled", async () => {
    useStore.setState({ animationsEnabled: false });

    await openSettings();

    expect(gsap.fromTo).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ autoAlpha: 0 }),
      expect.objectContaining({ duration: 0 }),
    );
  });

  it("switches between General, Usage, and Persona tabs", async () => {
    const user = await openSettings();

    expect(screen.getByLabelText("App Language")).toBeInTheDocument();
    expect(screen.getByLabelText("Learner Name")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByText("Plan and milestones")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Plus.*daily requests/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    expect(screen.getByText("AI Persona Studio")).toBeInTheDocument();
    expect(screen.getByText("Live prompt")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Socratic Python mentor" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByLabelText("App Language")).toBeInTheDocument();
  });

  it("resets the active tab to General when reopened", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    expect(screen.getByText("AI Persona Studio")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "App Settings" }));

    expect(screen.getByLabelText("App Language")).toBeInTheDocument();
    expect(screen.queryByText("AI Persona Studio")).toBeNull();
  });

  it("animates the active tab pill when tabs change", async () => {
    const user = await openSettings();
    vi.mocked(gsap.to).mockClear();

    await user.click(screen.getByRole("button", { name: "Usage" }));

    expect(gsap.killTweensOf).toHaveBeenCalledWith(expect.any(HTMLSpanElement));
    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLSpanElement),
      expect.objectContaining({
        autoAlpha: 1,
        duration: 0.2,
        ease: "power3.out",
      }),
    );
  });

  it("shows the access mode selector with user selected by default", async () => {
    await openSettings();

    expect(screen.getByRole("button", { name: "user" })).toHaveClass(
      "text-white",
    );
    expect(screen.getByRole("button", { name: "admin" })).toHaveClass(
      "text-zinc-500",
    );
  });

  it("hides admin provider controls in user mode", async () => {
    await openSettings();

    expect(screen.getByText(/Free allowance/i)).toBeInTheDocument();
    expect(screen.queryByText("OpenRouter API Key")).toBeNull();
    expect(screen.queryByText("Serper API Key")).toBeNull();
    expect(screen.queryByText("Deepgram API Key")).toBeNull();
    expect(screen.queryByText("TTS Voice Selection")).toBeNull();
    expect(screen.queryByText("MisoTTS API URL")).toBeNull();
    expect(screen.queryByText("AI Model")).toBeNull();
  });

  it("shows the compact user allowance summary on the General tab", async () => {
    await openSettings();

    expect(screen.getByText("Free allowance")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("left today")).toBeInTheDocument();
    expect(
      screen.getByText("0 used of 40 daily tutor requests."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Plus.*daily requests/i }),
    ).toBeNull();
  });

  it("resets unsaved user edits when cancelled and reopened", async () => {
    const user = await openSettings();
    const learnerName = screen.getByLabelText("Learner Name");

    await user.clear(learnerName);
    await user.type(learnerName, "Temporary Name");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "App Settings" }));

    expect(screen.getByLabelText("Learner Name")).toHaveValue("Learner");
  });

  it("saves a blank learner name through the store fallback", async () => {
    const user = await openSettings();

    await user.clear(screen.getByLabelText("Learner Name"));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(useStore.getState().learnerName).toBe("Learner");
    expect(localStorage.getItem("learner_name")).toBe("Learner");
  });

  it("exposes provider controls in admin mode", async () => {
    useStore.setState({ accessMode: "admin" });

    await openSettings();

    expect(screen.getByText("OpenRouter API Key")).toBeInTheDocument();
    expect(screen.getByText("Serper API Key")).toBeInTheDocument();
    expect(screen.getByText("Deepgram API Key")).toBeInTheDocument();
    expect(screen.getByText("TTS Voice Selection")).toBeInTheDocument();
    expect(screen.getByText("MisoTTS API URL")).toBeInTheDocument();
    expect(screen.getByText("AI Model")).toBeInTheDocument();
  });

  it("renders admin provider inputs with safe input types and placeholders", async () => {
    useStore.setState({ accessMode: "admin" });

    await openSettings();

    expect(screen.getByPlaceholderText("sk-or-v1-...")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByPlaceholderText("SERPER_API_KEY")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByPlaceholderText("DEEPGRAM_API_KEY")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByPlaceholderText("http://127.0.0.1:8080"),
    ).toHaveAttribute("type", "url");
  });

  it("renders all expected admin voice and model choices", async () => {
    useStore.setState({ accessMode: "admin" });

    await openSettings();

    expect(
      screen.getByRole("option", { name: "MisoTTS 8B (Vast local API)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenAI gpt-4o-mini-tts (Premium)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "DeepSeek V4 Flash" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "GPT-4o (Smart)" }),
    ).toBeInTheDocument();
  });

  it("saves user-mode language, learner name, and animation preference without provider validation", async () => {
    const user = await openSettings();

    await user.selectOptions(screen.getByLabelText("App Language"), "ko");
    await user.clear(screen.getByLabelText("Learner Name"));
    await user.type(screen.getByLabelText("Learner Name"), "Ada Lovelace");

    const animationToggle = screen.getByRole("button", {
      name: "Toggle animations",
    });
    expect(animationToggle).toHaveAttribute("aria-pressed", "true");
    await user.click(animationToggle);
    expect(animationToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(useStore.getState().language).toBe("ko");
    expect(useStore.getState().learnerName).toBe("Ada Lovelace");
    expect(useStore.getState().animationsEnabled).toBe(false);
    expect(localStorage.getItem("learning_ai_language")).toBe("ko");
    expect(localStorage.getItem("learner_name")).toBe("Ada Lovelace");
    expect(localStorage.getItem("animations_enabled")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "App Settings" })).toBeNull();
  });

  it("updates the translated trigger label after saving language", async () => {
    const user = await openSettings();

    await user.selectOptions(screen.getByLabelText("App Language"), "ja");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      screen.getByRole("button", { name: "アプリ設定" }),
    ).toBeInTheDocument();
  });

  it("saves admin settings without provider validation when OpenRouter key is empty", async () => {
    useStore.setState({ accessMode: "admin" });
    const user = await openSettings();

    await user.type(
      screen.getByPlaceholderText("SERPER_API_KEY"),
      "serper-live",
    );
    await user.type(
      screen.getByPlaceholderText("DEEPGRAM_API_KEY"),
      "deepgram-live",
    );
    await user.clear(screen.getByPlaceholderText("http://127.0.0.1:8080"));
    await user.type(
      screen.getByPlaceholderText("http://127.0.0.1:8080"),
      "http://127.0.0.1:9090",
    );
    // Select each control by an option it uniquely owns, so the assertion is
    // robust to added selects (e.g. the voice-mode picker) rather than pinned
    // to a brittle combobox index.
    const comboboxes = screen.getAllByRole("combobox");
    const selectWithOption = (optionValue: string) =>
      comboboxes.find((combobox) =>
        Array.from(combobox.querySelectorAll("option")).some(
          (option) => (option as HTMLOptionElement).value === optionValue,
        ),
      )!;
    await user.selectOptions(selectWithOption("aura-luna-en"), "aura-luna-en");
    await user.selectOptions(selectWithOption("gpt-4o"), "gpt-4o");
    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.type(
      screen.getByPlaceholderText(/You are a precise, professional tutor/i),
      "Use crisp Socratic hints.",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useStore.getState().apiKey).toBe("");
    expect(useStore.getState().serperApiKey).toBe("serper-live");
    expect(useStore.getState().deepgramApiKey).toBe("deepgram-live");
    expect(useStore.getState().misoTtsApiUrl).toBe("http://127.0.0.1:9090");
    expect(useStore.getState().ttsVoice).toBe("aura-luna-en");
    expect(useStore.getState().aiModel).toBe("gpt-4o");
    expect(useStore.getState().systemPrompt).toBe("Use crisp Socratic hints.");
  });

  it("validates and saves a non-empty OpenRouter admin key", async () => {
    useStore.setState({ accessMode: "admin" });
    fetchMock.mockResolvedValueOnce({ ok: true });
    const user = await openSettings();

    await user.type(
      screen.getByPlaceholderText("sk-or-v1-..."),
      "sk-or-v1-live",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "App Settings" }),
      ).toBeNull(),
    );
    expect(useStore.getState().apiKey).toBe("sk-or-v1-live");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-v1-live",
          "X-Title": "Cosmic Obsidian AI Tutor",
        }),
      }),
    );
  });

  it("keeps the admin modal open when provider validation fails", async () => {
    useStore.setState({ accessMode: "admin" });
    fetchMock.mockResolvedValueOnce({ ok: false });
    const user = await openSettings();

    await user.type(
      screen.getByPlaceholderText("sk-or-v1-..."),
      "sk-or-v1-invalid",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText("Invalid API Key or OpenRouter is unreachable."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "App Settings" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-v1-invalid",
        }),
      }),
    );
    expect(useStore.getState().apiKey).toBe("");
  });

  it("keeps controls disabled and the modal open while provider validation is pending", async () => {
    useStore.setState({ accessMode: "admin" });
    const pending = deferredFetch();
    fetchMock.mockReturnValueOnce(pending.promise);
    const user = await openSettings();

    await user.type(
      screen.getByPlaceholderText("sk-or-v1-..."),
      "sk-or-v1-slow",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByRole("button", { name: "Validating..." }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close settings" }),
    ).toBeDisabled();

    fireEvent.click(document.querySelector(".fixed.inset-0.z-\\[100\\]")!);
    expect(
      screen.getByRole("heading", { name: "App Settings" }),
    ).toBeInTheDocument();

    pending.resolveFetch({ ok: false });
    expect(
      await screen.findByText("Invalid API Key or OpenRouter is unreachable."),
    ).toBeInTheDocument();
  });

  it("surfaces provider validation network errors", async () => {
    useStore.setState({ accessMode: "admin" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const user = await openSettings();

    await user.type(
      screen.getByPlaceholderText("sk-or-v1-..."),
      "sk-or-v1-down",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("offline")).toBeInTheDocument();
    expect(useStore.getState().apiKey).toBe("");
  });

  it("shows user plan cards and changes the persisted plan from Usage", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));
    await user.click(
      screen.getByRole("button", { name: /Plus.*180.*daily requests/i }),
    );

    expect(useStore.getState().planTier).toBe("plus");
    expect(localStorage.getItem("plan_tier")).toBe("plus");
    expect(screen.getByText("Plus allowance")).toBeInTheDocument();
    expect(screen.getAllByText("180").length).toBeGreaterThanOrEqual(1);
  });

  it("can switch user plan controls from Plus to Pro without closing the modal", async () => {
    useStore.setState({ planTier: "plus" });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));
    await user.click(
      screen.getByRole("button", { name: /Pro.*600.*daily requests/i }),
    );

    expect(useStore.getState().planTier).toBe("pro");
    expect(screen.getByText("Pro allowance")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "App Settings" }),
    ).toBeInTheDocument();
  });

  it("calculates user allowance and milestones from chat, web, and voice usage", async () => {
    useStore.setState({
      chatUsage: {
        ...useStore.getState().chatUsage,
        requests: 5,
      },
      webUsage: {
        ...useStore.getState().webUsage,
        requests: 2,
      },
      voiceUsage: {
        ...useStore.getState().voiceUsage,
        connectionSeconds: 900,
      },
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));

    expect(screen.getByText("33")).toBeInTheDocument();
    expect(
      screen.getByText("7 used of 40 daily tutor requests."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("49m studied in this browser."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 hr next")).toBeInTheDocument();
  });

  it("caps service milestone progress at the three-hour milestone", async () => {
    useStore.setState({
      chatUsage: {
        ...useStore.getState().chatUsage,
        requests: 50,
      },
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));

    expect(screen.getByText("3h studied in this browser.")).toBeInTheDocument();
    expect(screen.getByText("3 hrs complete")).toBeInTheDocument();
  });

  it("shows admin usage analytics instead of user plan controls", async () => {
    useStore.setState({
      accessMode: "admin",
      chatUsage: {
        ...useStore.getState().chatUsage,
        inputTokens: 1200,
        outputTokens: 345,
        requests: 8,
        cost: 0.1234,
      },
      voiceUsage: {
        ...useStore.getState().voiceUsage,
        connectionSeconds: 60,
        ttsCharacters: 160,
        cost: 0.02,
      },
      webUsage: {
        ...useStore.getState().webUsage,
        requests: 3,
        sourcesReviewed: 9,
        cost: 0.01,
      },
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));

    expect(screen.getByText("Usage analytics")).toBeInTheDocument();
    expect(screen.getByText("$0.1534")).toBeInTheDocument();
    expect(
      screen.getByText("1.5K chat tokens · 3 web calls"),
    ).toBeInTheDocument();
    expect(screen.getByText("Chat Tokens")).toBeInTheDocument();
    expect(screen.queryByText("Plan and milestones")).toBeNull();
  });

  it("resets admin usage analytics from the Usage tab", async () => {
    useStore.setState({
      accessMode: "admin",
      chatUsage: {
        ...useStore.getState().chatUsage,
        inputTokens: 100,
        outputTokens: 50,
        requests: 2,
        cost: 0.04,
      },
      voiceUsage: {
        ...useStore.getState().voiceUsage,
        connectionSeconds: 120,
        cost: 0.03,
      },
      webUsage: {
        ...useStore.getState().webUsage,
        requests: 1,
        cost: 0.01,
      },
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Usage" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(useStore.getState().chatUsage.requests).toBe(0);
    expect(useStore.getState().voiceUsage.connectionSeconds).toBe(0);
    expect(useStore.getState().webUsage.requests).toBe(0);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("fills the persona description from preset chips", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.click(
      screen.getByRole("button", { name: "Research paper tutor" }),
    );

    expect(
      screen.getByPlaceholderText("I want an AI tutor specialized in..."),
    ).toHaveValue("Research paper tutor");
  });

  it("lets typed persona descriptions replace a preset before generation", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.click(
      screen.getByRole("button", { name: "Concise exam coach" }),
    );
    const personaInput = screen.getByPlaceholderText(
      "I want an AI tutor specialized in...",
    );
    await user.clear(personaInput);
    await user.type(personaInput, "linear algebra oral exam coach");

    expect(personaInput).toHaveValue("linear algebra oral exam coach");
  });

  it("does not call persona generation when the description is blank", async () => {
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Persona prompt generated/i)).toBeNull();
  });

  it("generates a persona prompt and leaves it ready to save", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        prompt: "You are a concise research tutor. Do not use emojis.",
      }),
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.type(
      screen.getByPlaceholderText("I want an AI tutor specialized in..."),
      "research tutor",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByText(
        "Persona prompt generated. Press Save to apply it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/You are a precise, professional tutor/i),
    ).toHaveValue("You are a concise research tutor. Do not use emojis.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate-persona",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ description: "research tutor" }),
      }),
    );
  });

  it("saves a generated admin persona prompt after generation", async () => {
    useStore.setState({ accessMode: "admin" });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prompt: "Generated admin tutor prompt." }),
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.type(
      screen.getByPlaceholderText("I want an AI tutor specialized in..."),
      "admin prompt writer",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByText(
      "Persona prompt generated. Press Save to apply it.",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(useStore.getState().systemPrompt).toBe(
      "Generated admin tutor prompt.",
    );
    expect(screen.queryByRole("heading", { name: "App Settings" })).toBeNull();
  });

  it("sends an OpenRouter auth header when generating a persona with an admin key", async () => {
    useStore.setState({ accessMode: "admin", apiKey: "sk-or-v1-admin" });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ prompt: "Admin persona prompt" }),
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.type(
      screen.getByPlaceholderText("I want an AI tutor specialized in..."),
      "admin tutor",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await screen.findByText(
      "Persona prompt generated. Press Save to apply it.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/generate-persona",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-v1-admin",
        }),
      }),
    );
  });

  it("surfaces persona generation failures without saving the prompt", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Persona service unavailable" }),
    });
    const user = await openSettings();

    await user.click(screen.getByRole("button", { name: "Persona Studio" }));
    await user.type(
      screen.getByPlaceholderText("I want an AI tutor specialized in..."),
      "blocked tutor",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByText("Persona service unavailable"),
    ).toBeInTheDocument();
    expect(useStore.getState().systemPrompt).toBe("");
    expect(consoleError).toHaveBeenCalledWith(expect.any(Error));
    consoleError.mockRestore();
  });
});
