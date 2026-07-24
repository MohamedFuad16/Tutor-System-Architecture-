import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BRAIN_RUNTIME_SETTINGS } from "../src/lib/brainRuntimeSettings";
import {
  db,
  type LearningBook,
  type LearningBookConcept,
} from "../src/memory/longterm.memory";
import { useStore } from "../src/store";
import { AdminView } from "../src/views/AdminView";

const { recordStoredAudioOverviewArtifactsMock } = vi.hoisted(() => ({
  recordStoredAudioOverviewArtifactsMock: vi.fn(async () => []),
}));

vi.mock("../src/memory/artifact.records", async () => {
  const actual = await vi.importActual<
    typeof import("../src/memory/artifact.records")
  >("../src/memory/artifact.records");

  return {
    ...actual,
    recordStoredAudioOverviewArtifacts: recordStoredAudioOverviewArtifactsMock,
  };
});

const systemActivityPayload = {
  generatedAt: "2026-06-05T10:00:00.000Z",
  localOnly: true,
  retention: { limit: 250, strategy: "ring-buffer" },
  summary: {
    total: 2,
    byKind: { model: 1, memory: 1 },
    byStatus: { completed: 2 },
    latestError: null as Record<string, unknown> | null,
    latestEventAt: Date.parse("2026-06-05T10:00:00.000Z"),
    retentionLimit: 250,
  },
  meters: {
    providers: {
      openRouter: true,
      openRouterByok: false,
      deepgram: false,
    },
    graph: { status: "ready" },
    tuning: { activityRefreshMs: 5000 },
  },
  events: [
    {
      id: "activity:model",
      timestamp: Date.parse("2026-06-05T10:00:00.000Z"),
      kind: "model",
      status: "completed",
      title: "Tutor reply completed",
      requestId: "request:rendered-admin",
      model: "test-model",
      durationMs: 42,
    },
    {
      id: "activity:memory",
      timestamp: Date.parse("2026-06-05T09:59:59.000Z"),
      kind: "memory",
      status: "completed",
      title: "Learning memory saved",
      requestId: "request:rendered-admin",
    },
  ],
};

type FetchMock = ReturnType<
  typeof vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >
>;

const activityResponse = () =>
  new Response(JSON.stringify(systemActivityPayload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  close = vi.fn(() => {
    this.onclose?.(new CloseEvent("close"));
  });

  open() {
    this.onopen?.(new Event("open"));
  }

  message(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

let fetchMock: FetchMock;

const resetAdminStore = () => {
  useStore.setState({
    accessMode: "admin",
    activeBetaProofAttemptId: null,
    activeLearningBookId: null,
    activeProject: "Rendered Admin QA",
    activeView: "admin",
    animationsEnabled: false,
    betaProofTrafficApproval: null,
    brainRuntimeSettings: { ...DEFAULT_BRAIN_RUNTIME_SETTINGS },
    voiceAgentEvents: [],
    webSearchEvents: [],
  });
};

const renderAdmin = () => render(<AdminView />);

const clickTab = (name: string) => {
  fireEvent.click(screen.getAllByRole("button", { name })[0]);
};

const activityRequest = () =>
  fetchMock.mock.calls.find(([input]) =>
    String(input).includes("/api/debug/system-activity"),
  );

beforeEach(async () => {
  localStorage.clear();
  Object.assign(systemActivityPayload.meters.providers, {
    openRouter: true,
    openRouterByok: false,
    deepgram: false,
  });
  await db.delete();
  await db.open();
  resetAdminStore();
  MockWebSocket.instances = [];
  fetchMock = vi.fn(async () => activityResponse());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await db.delete();
});

describe("rendered AdminView page flows", () => {
  it("opens with a per-learner knowledge overview and interpretation guide", async () => {
    renderAdmin();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Knowledge, evidence, and learning patterns",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("admin-brain-overview"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Start with a learner, then inspect the evidence",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Learner")).toBeInTheDocument();
    expect(screen.getByText("Mapped concepts")).toBeInTheDocument();
    expect(screen.getByText("Verified evidence")).toBeInTheDocument();
    expect(screen.getByText("Learner concept graph")).toBeInTheDocument();
    expect(screen.getByText("Local identity boundary")).toBeInTheDocument();
  });

  it("shows the activity loading state before a successful local response", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementationOnce(() => pending.promise);

    renderAdmin();
    clickTab("System Activity");

    expect(
      screen.getByRole("heading", { level: 1, name: "System Activity" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Loading")).toBeInTheDocument();

    await act(async () => {
      pending.resolve(activityResponse());
      await pending.promise;
    });

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.getAllByText("Tutor reply completed").length).toBeGreaterThan(
      0,
    );
  });

  it("renders an actionable activity error when the debug route fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("offline", { status: 503, statusText: "Unavailable" }),
    );

    renderAdmin();
    clickTab("System Activity");

    expect(
      await screen.findByText("System activity unavailable (503)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("adds the local debug token to activity requests", async () => {
    localStorage.setItem("tutor_debug_token", "rendered-debug-token");

    renderAdmin();

    await waitFor(() => expect(activityRequest()).toBeDefined());
    const request = activityRequest();
    const headers = new Headers(request?.[1]?.headers);

    expect(headers.get("X-Debug-Token")).toBe("rendered-debug-token");
    expect(String(request?.[0])).toMatch(/\/api\/debug\/system-activity$/);
  });

  it("omits the debug-token header when no local token is stored", async () => {
    renderAdmin();

    await waitFor(() => expect(activityRequest()).toBeDefined());
    const headers = new Headers(activityRequest()?.[1]?.headers);

    expect(headers.has("X-Debug-Token")).toBe(false);
    expect(
      fetchMock.mock.calls.every(
        ([input]) => !/openrouter|deepgram|serpapi|serper/i.test(String(input)),
      ),
    ).toBe(true);
  });

  it("manually refreshes the activity request from the polling control", async () => {
    renderAdmin();
    clickTab("System Activity");

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Auto-refresh 5s/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("navigates among model, memory, and evidence admin tabs", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");

    expect(
      screen.getAllByText("Advanced debugging").length,
    ).toBeGreaterThanOrEqual(2);

    clickTab("Model Runs");
    expect(
      screen.getByRole("heading", { level: 1, name: "Model Runs" }),
    ).toBeInTheDocument();

    clickTab("Memory Events");
    expect(
      screen.getByRole("heading", { level: 1, name: "Memory Events" }),
    ).toBeInTheDocument();

    clickTab("Evidence Ledger");
    expect(
      screen.getByRole("heading", { level: 1, name: "Evidence Ledger" }),
    ).toBeInTheDocument();
  });

  it("keeps the learner graph canvas tall enough and exposes node values to assistive tech", async () => {
    const now = Date.now();
    const book: LearningBook = {
      id: "book:learner-graph-rendered",
      sessionId: "session:learner-graph-rendered",
      title: "Learner Graph Rendered",
      userName: "Learner",
      source: "chat" as const,
      overview: "Graph test",
      summary: "Graph test",
      knowledgeSummary: "Graph test",
      chapters: [],
      conceptIds: Array.from({ length: 12 }, (_, index) => `concept:${index}`),
      conversationCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.learningBooks.put(book);
    await db.learningBookConcepts.bulkPut(
      Array.from(
        { length: 12 },
        (_, index): LearningBookConcept => ({
          id: `concept:${index}`,
          bookId: book.id,
          name: `Concept ${index + 1}`,
          summary: `Concept ${index + 1} summary`,
          mastery: index / 12,
          confidence: 0.5,
          parentConcepts: index > 0 ? [`Concept ${index}`] : [],
          childConcepts: index < 11 ? [`Concept ${index + 2}`] : [],
          evidence: [],
          firstSeenAt: now,
          updatedAt: now,
        }),
      ),
    );

    renderAdmin();

    await waitFor(() =>
      expect(screen.getAllByText("Concept 12").length).toBeGreaterThan(0),
    );
    const graph = screen.getByRole("img", {
      name: /Learner learner concept graph/i,
    });
    expect(within(graph).getByText("Concept 12")).toBeInTheDocument();
    expect(graph.querySelector("svg")).toHaveAttribute(
      "viewBox",
      "0 0 850 430",
    );
    expect(
      within(graph)
        .getAllByText(/Concept 12: mastery 92 percent, confidence 50 percent/i)
        .some((node) => Boolean(node.closest(".sr-only"))),
    ).toBe(true);
  });

  it("keeps learner-brain logic controls visible and updates local BKT runtime knobs", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");
    clickTab("Brain Overview");

    expect(screen.getByText("Learning Algorithm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open tuning" }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Runtime Tuning" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Evidence and BKT controls",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review Required/i }));
    fireEvent.change(screen.getByLabelText("BKT transit prior"), {
      target: { value: "0.18" },
    });
    fireEvent.change(screen.getByLabelText("BKT slip prior"), {
      target: { value: "0.07" },
    });
    fireEvent.change(screen.getByLabelText("BKT guess prior"), {
      target: { value: "0.24" },
    });

    expect(useStore.getState().brainRuntimeSettings).toMatchObject({
      masteryEvidencePolicy: "review_required",
      bktTransitProbability: 0.18,
      bktSlipProbability: 0.07,
      bktGuessProbability: 0.24,
    });
  });

  it("renders the local beta diagnostics snapshot surface", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");

    clickTab("Beta Diagnostics");

    expect(
      screen.getByRole("heading", { level: 1, name: "Beta Diagnostics" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Diagnostic snapshot and export",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /it does not sync to AWS or claim cloud-beta readiness/i,
      ),
    ).toBeInTheDocument();
  });

  it("keeps the provider drill locked when OpenRouter only advertises BYOK support", async () => {
    systemActivityPayload.meters.providers.openRouter = false;
    systemActivityPayload.meters.providers.openRouterByok = true;
    systemActivityPayload.meters.providers.deepgram = true;
    useStore.setState({ apiKey: "", deepgramApiKey: "" });

    renderAdmin();
    await screen.findByTestId("admin-brain-overview");
    clickTab("Beta Diagnostics");

    expect(await screen.findByText("chat key missing")).toBeInTheDocument();
    expect(screen.getByText("voice key seen")).toBeInTheDocument();
    expect(screen.getByText("keys/setup needed")).toBeInTheDocument();
  });

  it("runs the local brain wiring rehearsal without provider traffic", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");
    clickTab("Beta Diagnostics");
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Diagnostic snapshot and export",
      }),
    ).toBeInTheDocument();

    const callsBeforeRehearsal = fetchMock.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: "Run local rehearsal" }),
    );

    expect(await screen.findByText("synthetic ready")).toBeInTheDocument();
    expect(screen.getByText("no durable rows")).toBeInTheDocument();
    expect(screen.getByText("excluded from live coverage")).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeRehearsal);
    expect(
      fetchMock.mock.calls.every(
        ([input]) => !/openrouter|deepgram|serpapi|serper/i.test(String(input)),
      ),
    ).toBe(true);
  });

  it("exports diagnostics through a browser-local JSON download", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:rendered-admin-diagnostics");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    renderAdmin();
    await screen.findByTestId("admin-brain-overview");
    clickTab("Beta Diagnostics");
    fireEvent.click(
      screen.getByRole("button", { name: "Export diagnostics JSON" }),
    );

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(
      "blob:rendered-admin-diagnostics",
    );
    expect(
      screen.getByText(/Prepared local diagnostics export with \d+ rows\./),
    ).toBeInTheDocument();
  });

  it("routes Back to Library through the Zustand view state", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");

    fireEvent.click(screen.getByRole("button", { name: "Back to Library" }));

    expect(useStore.getState().activeView).toBe("study");
  });

  it("opens the debug WebSocket after health succeeds and renders log events", async () => {
    renderAdmin();
    await screen.findByTestId("admin-brain-overview");

    clickTab("Server Console");

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toMatch(/\/ws\/debug$/);

    act(() => socket.open());
    expect(screen.getByText("Connected")).toBeInTheDocument();

    act(() => {
      socket.message(
        JSON.stringify({
          type: "info",
          msg: "Rendered console event",
          timestamp: Date.parse("2026-06-05T10:00:00.000Z"),
        }),
      );
    });

    expect(screen.getByText("Rendered console event")).toBeInTheDocument();
  });

  it("shows the offline console message when the backend health check fails", async () => {
    fetchMock
      .mockResolvedValueOnce(activityResponse())
      .mockRejectedValueOnce(new Error("backend unavailable"));

    renderAdmin();
    await screen.findByTestId("admin-brain-overview");
    clickTab("Server Console");

    expect(
      await screen.findByText(
        "Server console is offline. Start the Tutor backend to stream live logs.",
      ),
    ).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
