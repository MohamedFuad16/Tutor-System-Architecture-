import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Message } from "../src/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel } from "../src/components/ChatPanel";
import {
  db,
  type BookChatThread,
  type LearningBook,
  type LearningDocument,
} from "../src/memory/longterm.memory";
import { useStore } from "../src/store";

const mocks = vi.hoisted(() => ({
  addOrUpdateConcept: vi.fn(),
  buildBrainContextPacket: vi.fn(),
  cacheArtifact: vi.fn(),
  createFlashcardForStorage: vi.fn(),
  getRelevantContext: vi.fn(),
  playClick: vi.fn(),
  playHover: vi.fn(),
  recordEvaluatedAnswerEvidenceBatch: vi.fn(),
  recordGeneratedFlashcardsArtifact: vi.fn(),
  recordMemoryEvent: vi.fn(),
  recordModelRunEvent: vi.fn(),
  recordToolJobEvent: vi.fn(),
  recordUnavailableCitationState: vi.fn(),
  recordWebSourceArtifact: vi.fn(),
  trackInteraction: vi.fn(),
  updateLearningBookFromConversation: vi.fn(),
  updateLearningBookTitle: vi.fn(),
}));

vi.mock("../src/lib/audio", () => ({
  audio: {
    playClick: mocks.playClick,
    playHover: mocks.playHover,
  },
}));

vi.mock("../src/memory/brain.context", () => ({
  buildBrainContextPacket: mocks.buildBrainContextPacket,
}));

vi.mock("../src/memory/memory.orchestrator", () => ({
  brainOrchestrator: {
    addOrUpdateConcept: mocks.addOrUpdateConcept,
    getRelevantContext: mocks.getRelevantContext,
    trackInteraction: mocks.trackInteraction,
    updateLearningBookFromConversation:
      mocks.updateLearningBookFromConversation,
    updateLearningBookTitle: mocks.updateLearningBookTitle,
  },
}));

vi.mock("../src/memory/artifact.records", () => ({
  recordGeneratedFlashcardsArtifact: mocks.recordGeneratedFlashcardsArtifact,
  recordUnavailableCitationState: mocks.recordUnavailableCitationState,
  recordWebSourceArtifact: mocks.recordWebSourceArtifact,
}));

vi.mock("../src/memory/memory.events", () => ({
  recordMemoryEvent: mocks.recordMemoryEvent,
}));

vi.mock("../src/memory/model.runs", () => ({
  recordModelRunEvent: mocks.recordModelRunEvent,
}));

vi.mock("../src/memory/tool.jobs", () => ({
  recordToolJobEvent: mocks.recordToolJobEvent,
}));

vi.mock("../src/memory/answer.evidence", () => ({
  recordEvaluatedAnswerEvidenceBatch: mocks.recordEvaluatedAnswerEvidenceBatch,
}));

vi.mock("../src/memory/flashcard.concepts", () => ({
  createFlashcardForStorage: mocks.createFlashcardForStorage,
}));

const now = 1_777_777_777_000;

const brainContextPacket = {
  requestId: "chat-expanded-render",
  proofAttemptId: undefined as string | undefined,
  context: "Expanded rendered test brain context.",
  contextChars: 36,
  documentIds: ["doc:active"],
  readyDocumentIds: ["doc:active"],
  contextDocumentIds: ["doc:active"],
  documentCount: 1,
  readyDocumentCount: 1,
  unreadyDocumentCount: 0,
  omittedReadyDocumentCount: 0,
  rawContextChars: 36,
  memoryContextChars: 8,
  activeBookContextChars: 14,
  documentContextChars: 14,
  compacted: false,
};

const baseMessages = (): Message[] => [
  {
    id: "assistant:init",
    role: "assistant",
    content: "Ready to study.",
  },
];

const completeAssistant = (overrides: Partial<Message> = {}): Message => ({
  id: "assistant:complete",
  role: "assistant",
  content: "Spaced retrieval improves durable recall.",
  phase: "complete",
  reasoningSteps: [
    { id: "step:ready", content: "Ready with the final answer." },
  ],
  sources: [],
  ...overrides,
});

const userMessage = (content = "What is retrieval practice?"): Message => ({
  id: `user:${content.slice(0, 8)}`,
  role: "user",
  content,
});

const sourceOne = {
  id: "source:one",
  url: "https://example.com/retrieval",
  domain: "example.com",
  title: "Retrieval Practice Guide",
  snippet: "Practice recall to strengthen long-term memory.",
};

const sourceTwo = {
  id: "source:two",
  url: "https://research.test/spacing",
  domain: "research.test",
  title: "Spacing Effect Notes",
  snippet: "Spacing and retrieval can compound.",
};

const learningBook = (overrides: Partial<LearningBook> = {}): LearningBook => ({
  id: "book:active",
  sessionId: "session:rendered-chat-expanded",
  title: "Rendered Chat Book",
  userName: "Learner",
  source: "chat",
  overview: "",
  summary: "",
  knowledgeSummary: "",
  chapters: [],
  conceptIds: [],
  conversationCount: 0,
  activeDocumentId: "doc:active",
  documentIds: ["doc:active"],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const learningDocument = (
  overrides: Partial<LearningDocument> = {},
): LearningDocument => ({
  id: "doc:active",
  bookId: "book:active",
  title: "Rendered PDF",
  mimeType: "application/pdf",
  size: 256,
  extractedText: "Retrieval practice strengthens recall.",
  classification: "paper",
  extractionMode: "test",
  processingStatus: "ready",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const threadFor = (messages: Message[]): BookChatThread => ({
  id: "thread:book:active",
  bookId: "book:active",
  bookTitle: "Rendered Chat Book",
  title: "Rendered Chat Book",
  messages,
  createdAt: now,
  updatedAt: now,
});

const makeChatStream = (events: Array<Record<string, unknown>>) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      events.forEach((event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      });
      controller.close();
    },
  });
};

const successEvents = () => [
  { type: "chunk", content: "Expanded " },
  { type: "chunk", content: "answer." },
  {
    type: "done",
    content: "Expanded answer.",
    usage: {
      provider: "openrouter",
      model: "test-model",
      inputTokens: 16,
      outputTokens: 5,
      cost: 0.001,
      estimated: true,
    },
  },
];

let chatRequestBodies: string[] = [];
let chatResponseFactory: () => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

class AudioStub {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  play = vi.fn(async () => undefined);

  constructor(src = "") {
    this.src = src;
  }
}

const resetChatStore = () => {
  useStore.setState({
    accessMode: "user",
    activeView: "study",
    activeProject: "Rendered Chat Book",
    activeLearningBookId: "book:active",
    activeDocumentId: "doc:active",
    activeBetaProofAttemptId: null,
    animationsEnabled: false,
    apiKey: "openrouter-test-key",
    askTutorQuery: "",
    betaProofTrafficApproval: null,
    deepgramApiKey: "",
    isVoiceActive: false,
    language: "en",
    learnerName: "Learner",
    messages: baseMessages(),
    selectedTextContext: "",
    serperApiKey: "serper-test-key",
    systemPrompt: "",
    ttsVoice: "aura-asteria-en",
    webSearchEvents: [],
    voiceAgentEvents: [],
  });
  useStore.getState().resetUsageAnalytics();
};

const seedLibrary = async ({
  books = [learningBook()],
  documents = [learningDocument()],
  messages = baseMessages(),
}: {
  books?: LearningBook[];
  documents?: LearningDocument[];
  messages?: Message[];
} = {}) => {
  await db.learningBooks.bulkPut(books);
  await db.learningDocuments.bulkPut(documents);
  await db.bookChatThreads.put(threadFor(messages));
};

const seedThread = async (messages: Message[]) => {
  await db.bookChatThreads.put(threadFor(messages));
  useStore.setState({ messages });
};

const renderChatPanel = (props: { onClose?: () => void } = {}) =>
  render(<ChatPanel onClose={props.onClose} />);

const settleChatPanelEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
};

const settleBookThreadPersistence = async () => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await Promise.resolve();
  });
};

const chatPayload = (index = 0) =>
  JSON.parse(chatRequestBodies[index] || "{}") as Record<string, any>;

const expectOneChatRequest = async () => {
  await waitFor(() => expect(chatRequestBodies).toHaveLength(1));
  return chatPayload();
};

const expectRenderedText = async (text: string, timeout = 3000) => {
  await waitFor(
    () => {
      const matches = screen.getAllByText((_content, element) =>
        Boolean(element?.textContent?.includes(text)),
      );
      expect(matches.length).toBeGreaterThan(0);
    },
    { timeout },
  );
};

const setChatEvents = (events: Array<Record<string, unknown>>) => {
  chatResponseFactory = () =>
    new Response(makeChatStream(events), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
};

beforeEach(async () => {
  vi.clearAllMocks();
  chatRequestBodies = [];
  chatResponseFactory = () =>
    new Response(makeChatStream(successEvents()), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  mocks.buildBrainContextPacket.mockResolvedValue(brainContextPacket);
  mocks.getRelevantContext.mockResolvedValue("");
  mocks.updateLearningBookFromConversation.mockResolvedValue(undefined);
  mocks.updateLearningBookTitle.mockImplementation(
    async (bookId: string, title: string) => ({
      id: bookId,
      title,
    }),
  );
  mocks.createFlashcardForStorage.mockResolvedValue({
    flashcard: {
      id: "card:expanded",
      bookId: "book:active",
      front: "Rendered front",
      back: "Rendered back",
      nextReviewAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  await db.delete();
  await db.open();
  resetChatStore();
  await seedLibrary();

  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });

  vi.stubGlobal("Audio", AudioStub);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );

  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/health")) {
      return Response.json({
        providers: {
          deepgram: true,
          openRouter: true,
          openRouterByok: true,
        },
      });
    }

    if (url === "/api/pricing") {
      return Response.json({
        openRouter: { models: {}, fetchedAt: new Date(now).toISOString() },
        deepgram: {},
      });
    }

    if (url === "/api/chat") {
      chatRequestBodies.push(String(init?.body || ""));
      return chatResponseFactory();
    }

    if (url.startsWith("/api/tts")) {
      return new Response(new Blob(["audio"], { type: "audio/mpeg" }), {
        status: 200,
        headers: {
          "X-Usage-Input-Chars": "42",
          "X-Usage-Model": "aura-asteria-en",
          "X-Usage-Provider": "deepgram",
        },
      });
    }

    if (url === "/api/generate-flashcards") {
      return Response.json({
        cards: [{ front: "What strengthens recall?", back: "Retrieval." }],
      });
    }

    if (url === "/api/title") {
      return Response.json({ title: "Voice recap" });
    }

    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await db.delete();
});

describe("rendered ChatPanel expanded suite", () => {
  it("renders the tutor header and active learning book title", async () => {
    renderChatPanel();
    expect(await screen.findByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("Rendered Chat Book")).toBeInTheDocument();
  });

  it("renders the optional close button and calls onClose", async () => {
    const onClose = vi.fn();
    renderChatPanel({ onClose });
    await screen.findByText("Tutor");

    fireEvent.click(screen.getByRole("button", { name: "Close tutor chat" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("exposes the default chat input, voice button, tools button, and send button", async () => {
    renderChatPanel();
    await settleChatPanelEffects();

    expect(screen.getByPlaceholderText("Ask...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start voice input" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open tutor tools" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toBeInTheDocument();
  });

  it("renders selected PDF context as a chip and clears it from the store", async () => {
    useStore.setState({ selectedTextContext: "A highlighted page claim." });
    renderChatPanel();
    await screen.findByText("From PDF Selection");

    expect(screen.getByText(/A highlighted page claim/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear selected PDF context" }),
    );

    expect(useStore.getState().selectedTextContext).toBe("");
    await waitFor(() =>
      expect(screen.queryByText("From PDF Selection")).not.toBeInTheDocument(),
    );
  });

  it("loads an askTutorQuery into the textarea and clears the handoff state", async () => {
    useStore.setState({ askTutorQuery: "Explain the margin note." });
    renderChatPanel();

    const input = await screen.findByPlaceholderText("Ask...");
    await waitFor(() => expect(input).toHaveValue("Explain the margin note."));
    expect(useStore.getState().askTutorQuery).toBe("");
  });

  it("clears a draft when a new PDF selection arrives", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Draft before selection" } });
    expect(input).toHaveValue("Draft before selection");

    act(() => {
      useStore.getState().setSelectedTextContext("Fresh selected paragraph.");
    });

    await waitFor(() => expect(input).toHaveValue(""));
    expect(await screen.findByText("From PDF Selection")).toBeInTheDocument();
  });

  it("renders live proof capture badges with ready PDF and provider state", async () => {
    useStore.setState({ activeBetaProofAttemptId: "proof:expanded" });
    renderChatPanel();

    expect(await screen.findByText("Live proof capture")).toBeInTheDocument();
    expect(await screen.findByText(/Ready PDFs \d+/)).toBeInTheDocument();
    expect(screen.getByText("Approve traffic in Admin")).toBeInTheDocument();
    expect(screen.getByText("Voice capture ready")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter key set")).toBeInTheDocument();
  });

  it("does not treat OpenRouter BYOK support as a configured runtime key", async () => {
    useStore.setState({
      activeBetaProofAttemptId: "proof:byok-only",
      apiKey: "",
    });
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/health")) {
          return Response.json({
            providers: {
              deepgram: true,
              openRouter: false,
              openRouterByok: true,
            },
          });
        }
        if (url === "/api/pricing") {
          return Response.json({
            openRouter: { models: {}, fetchedAt: new Date(now).toISOString() },
            deepgram: {},
          });
        }
        if (url === "/api/chat") {
          chatRequestBodies.push(String(init?.body || ""));
          return chatResponseFactory();
        }
        return Response.json({});
      },
    );

    renderChatPanel();

    expect(
      await screen.findByText("OpenRouter key missing"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Deepgram server fallback"),
    ).toBeInTheDocument();
  });

  it("shows the loaded proof prompt badge while the proof text is in the input", async () => {
    useStore.setState({ activeBetaProofAttemptId: "proof:expanded" });
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, {
      target: { value: "Provider-key proof turn: verify chat row." },
    });

    expect(await screen.findByText("Proof prompt loaded")).toBeInTheDocument();
  });

  it("opens the library context dropdown with the active book row", async () => {
    renderChatPanel();
    await screen.findByText("Tutor");

    fireEvent.click(screen.getByRole("button", { name: /Rendered Chat Book/ }));

    expect(
      screen.getByText("Library Context (Press Enter to Rename)"),
    ).toBeInTheDocument();
    expect(await screen.findByText("0 chats · 0 chapters")).toBeInTheDocument();
  });

  it("submits an active book rename through the rendered dropdown input", async () => {
    renderChatPanel();
    await screen.findByText("Tutor");

    fireEvent.click(screen.getByRole("button", { name: /Rendered Chat Book/ }));
    const renameInput = screen.getByPlaceholderText("Rename current book...");
    fireEvent.change(renameInput, { target: { value: "Renamed Context" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.updateLearningBookTitle).toHaveBeenCalledWith(
        "book:active",
        "Renamed Context",
        "Learner",
        "chat",
      ),
    );
    expect(useStore.getState().activeProject).toBe("Renamed Context");
  });

  it("switches active library context from the rendered book list", async () => {
    await seedLibrary({
      books: [
        learningBook(),
        learningBook({
          id: "book:second",
          title: "Second Context",
          activeDocumentId: "doc:second",
          documentIds: ["doc:second"],
          updatedAt: now + 1,
        }),
      ],
      documents: [
        learningDocument(),
        learningDocument({
          id: "doc:second",
          bookId: "book:second",
          title: "Second PDF",
        }),
      ],
    });
    renderChatPanel();
    await screen.findByText("Tutor");

    fireEvent.click(screen.getByRole("button", { name: /Rendered Chat Book/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Second Context/ }),
    );

    expect(useStore.getState().activeLearningBookId).toBe("book:second");
    expect(useStore.getState().activeProject).toBe("Second Context");
    await settleBookThreadPersistence();
  });

  it("renders a stored learner message bubble", async () => {
    await seedThread([baseMessages()[0], userMessage("Define spacing.")]);
    renderChatPanel();

    expect(await screen.findByText("Define spacing.")).toBeInTheDocument();
  });

  it("renders assistant action buttons for a stored answer", async () => {
    await seedThread([baseMessages()[0], completeAssistant()]);
    renderChatPanel();

    expect(
      await screen.findByText("Spaced retrieval improves durable recall."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add to Graph/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Read aloud with Asteria" }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("generates flashcards from the rendered assistant action", async () => {
    await seedThread([baseMessages()[0], completeAssistant()]);
    renderChatPanel();
    await screen.findByText("Spaced retrieval improves durable recall.");

    fireEvent.click(screen.getByRole("button", { name: /Create Flashcard/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/generate-flashcards",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText("Flashcards successfully generated!"),
    ).toBeInTheDocument();
  });

  it("opens Revision from an assistant message that already has flashcards", async () => {
    await seedThread([
      baseMessages()[0],
      completeAssistant({ hasFlashcards: true }),
    ]);
    renderChatPanel();
    await screen.findByText("Flashcards successfully generated!");

    fireEvent.click(screen.getByRole("button", { name: "View Book" }));

    expect(useStore.getState().activeView).toBe("revision");
    expect(localStorage.getItem("revision_open_book_id")).toBe("book:active");
  });

  it("renders the assistant usage footer with tokens and cost", async () => {
    await seedThread([
      baseMessages()[0],
      completeAssistant({
        usage: {
          provider: "openrouter",
          model: "test-model",
          inputTokens: 12,
          outputTokens: 8,
          cost: 0.01,
          estimated: true,
        },
      }),
    ]);
    renderChatPanel();

    expect(await screen.findByText(/tokens · \$0\.01/)).toBeInTheDocument();
  });

  it("shows a retrieving reasoning trace preview", async () => {
    await seedThread([
      completeAssistant({
        phase: "retrieving",
        content: "",
        reasoningSteps: [
          {
            id: "step:retrieving",
            content: "Retrieving relevant contextual knowledge...",
          },
        ],
      }),
    ]);
    renderChatPanel();

    expect(await screen.findByText("Reasoning trace")).toBeInTheDocument();
    expect(screen.getByText("Searching")).toBeInTheDocument();
    expect(
      screen.getByText("Retrieving relevant contextual knowledge..."),
    ).toBeInTheDocument();
  });

  it("expands an in-flight reasoning trace and renders the loading row", async () => {
    await seedThread([
      completeAssistant({
        phase: "thinking",
        content: "",
        reasoningSteps: [
          { id: "step:thinking", content: "Linking concepts..." },
        ],
      }),
    ]);
    renderChatPanel();
    await screen.findByText("Reasoning trace");

    fireEvent.click(screen.getByRole("button", { name: /Reasoning trace/ }));

    await waitFor(() =>
      expect(screen.getAllByText("Linking concepts...").length).toBeGreaterThan(
        1,
      ),
    );
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("labels a tool-execution reasoning trace as running", async () => {
    await seedThread([
      completeAssistant({
        phase: "tool_execution",
        content: "",
        reasoningSteps: [{ id: "step:tool", content: "Executing tool call." }],
      }),
    ]);
    renderChatPanel();

    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Executing tool call.")).toBeInTheDocument();
  });

  it("filters the transient synthesizing step after a complete answer", async () => {
    await seedThread([
      completeAssistant({
        reasoningSteps: [
          { id: "step:synth", content: "Synthesizing final answer..." },
          { id: "step:done", content: "Ready with the final answer." },
        ],
      }),
    ]);
    renderChatPanel();
    await screen.findByText("Reasoning trace");

    fireEvent.click(screen.getByRole("button", { name: /Reasoning trace/ }));

    expect(screen.queryByText("Synthesizing final answer...")).toBeNull();
    expect(
      screen.getByText("Ready with the final answer."),
    ).toBeInTheDocument();
  });

  it("renders an active web-search panel inside reasoning", async () => {
    await seedThread([
      completeAssistant({
        phase: "web_search",
        content: "",
        reasoningSteps: [{ id: "step:web", content: "Searching the web." }],
        webSearch: {
          active: true,
          query: "retrieval practice evidence",
          mode: "search",
          status: "Searching web...",
          sources: [],
        },
      }),
    ]);
    renderChatPanel();
    await screen.findByText("Reviewing");

    fireEvent.click(screen.getByRole("button", { name: /Reasoning trace/ }));

    expect(await screen.findByText("Web Search")).toBeInTheDocument();
    expect(
      screen.getByText('"retrieval practice evidence"'),
    ).toBeInTheDocument();
    expect(screen.getByText("Searching web...")).toBeInTheDocument();
  });

  it("expands final source cards returned on an assistant answer", async () => {
    await seedThread([
      completeAssistant({
        sources: [sourceOne, sourceTwo],
      }),
    ]);
    renderChatPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: /2 sources reviewed/ }),
    );

    expect(
      await screen.findByText("Retrieval Practice Guide"),
    ).toBeInTheDocument();
    expect(screen.getByText("Spacing Effect Notes")).toBeInTheDocument();
    expect(screen.getByText("research.test")).toBeInTheDocument();
  });

  it("renders a collapsed voice-session archive row", async () => {
    await seedThread([
      {
        id: "voice:session",
        role: "assistant",
        content: "",
        isVoice: true,
        voiceSession: {
          title: "Voice recap",
          turns: [
            { id: "turn:one", role: "user", content: "What did I ask?" },
            {
              id: "turn:two",
              role: "assistant",
              content: "You asked about recall.",
            },
          ],
          startedAt: now,
          durationSeconds: 65,
        },
      },
    ]);
    renderChatPanel();

    expect(await screen.findByText("Voice recap")).toBeInTheDocument();
    expect(screen.getByText("Voice · 2 messages · 1:05")).toBeInTheDocument();
  });

  it("expands a voice-session archive and renders turns", async () => {
    await seedThread([
      {
        id: "voice:session",
        role: "assistant",
        content: "",
        isVoice: true,
        voiceSession: {
          title: "Voice recap",
          turns: [
            { id: "turn:one", role: "user", content: "What did I ask?" },
            {
              id: "turn:two",
              role: "assistant",
              content: "You asked about recall.",
            },
          ],
          startedAt: now,
          durationSeconds: 8,
        },
      },
    ]);
    renderChatPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Voice recap/ }));

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.getByText("What did I ask?")).toBeInTheDocument();
    expect(screen.getByText("You asked about recall.")).toBeInTheDocument();
  });

  it("renders voice visual focus metadata when a voice archive opens", async () => {
    await seedThread([
      {
        id: "voice:session",
        role: "assistant",
        content: "",
        isVoice: true,
        voiceSession: {
          title: "Voice with visuals",
          turns: [
            { id: "turn:one", role: "assistant", content: "I found a page." },
          ],
          visualFocuses: [
            {
              id: "focus:web",
              kind: "web_search",
              status: "ready",
              title: "Visual source review",
              query: "memory graph",
              focusedTarget: "web source",
              imageCount: 2,
              timestamp: now,
            },
          ],
          startedAt: now,
          durationSeconds: 10,
        },
      },
    ]);
    renderChatPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: /Voice with visuals/ }),
    );

    expect(await screen.findByText("Voice visual focus")).toBeInTheDocument();
    expect(screen.getByText("Visual source review")).toBeInTheDocument();
    expect(screen.getByText("focus web source")).toBeInTheDocument();
    expect(screen.getByText("2 images")).toBeInTheDocument();
  });

  it("renders the empty transcript path for voice archives", async () => {
    await seedThread([
      {
        id: "voice:empty",
        role: "assistant",
        content: "",
        isVoice: true,
        voiceSession: {
          title: "Empty voice capture",
          turns: [],
          startedAt: now,
          durationSeconds: 0,
        },
      },
    ]);
    renderChatPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: /Empty voice capture/ }),
    );

    expect(
      await screen.findByText("No transcript captured."),
    ).toBeInTheDocument();
  });

  it("renders voice badges on stored voice messages", async () => {
    await seedThread([
      {
        id: "user:voice",
        role: "user",
        content: "Voice question",
        isVoice: true,
      },
      {
        id: "assistant:voice",
        role: "assistant",
        content: "Voice answer",
        isVoice: true,
      },
    ]);
    renderChatPanel();

    expect(await screen.findByText("Voice question")).toBeInTheDocument();
    expect(screen.getByText("Voice answer")).toBeInTheDocument();
    expect(screen.getAllByText("Voice")).toHaveLength(2);
  });

  it("uses the default Asteria read-aloud label", async () => {
    await seedThread([completeAssistant()]);
    renderChatPanel();

    const readButton = await screen.findByRole("button", {
      name: "Read aloud with Asteria",
    });

    expect(readButton).toHaveAttribute("title", "Read Aloud voice: Asteria.");
  });

  it("uses the MisoTTS read-aloud label and tooltip when configured", async () => {
    useStore.setState({ ttsVoice: "miso-tts-8b" });
    await seedThread([completeAssistant()]);
    renderChatPanel();

    const readButton = await screen.findByRole("button", {
      name: "Read aloud with MisoTTS 8B",
    });

    expect(readButton).toHaveAttribute(
      "title",
      "Read Aloud voice: MisoTTS 8B via local HTTP TTS. Custom Live Voice uses Deepgram Aura streaming TTS when configured.",
    );
    expect(screen.getAllByText("MisoTTS 8B").length).toBeGreaterThanOrEqual(1);
  });

  it("fetches TTS audio and toggles the read-aloud button into stop state", async () => {
    await seedThread([completeAssistant()]);
    renderChatPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: "Read aloud with Asteria" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tts",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(
            '"text":"Spaced retrieval improves durable recall."',
          ),
        }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Stop reading with Asteria" }),
    ).toBeInTheDocument();
  });

  it("does not send whitespace-only input", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await settleChatPanelEffects();
    expect(chatRequestBodies).toHaveLength(0);
  });

  it("plays hover audio for a valid active send button without validation copy", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Explain recall" } });
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Send message" }));

    expect(mocks.playHover).toHaveBeenCalledOnce();
    expect(screen.queryByText("Special characters are limited.")).toBeNull();
  });

  it("surfaces special-character validation for invalid input", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Explain ∑ notation" } });

    expect(
      screen.getByText("Special characters are limited."),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-active='true'][data-valid='false']"),
    ).toBeInTheDocument();
  });

  it("sends on Enter, clears the textarea, and plays click audio", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");
    await settleChatPanelEffects();

    fireEvent.change(input, { target: { value: "Explain retrieval" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const payload = await expectOneChatRequest();
    expect(payload.messages.at(-1)?.content).toBe("Explain retrieval");
    expect(input).toHaveValue("");
    expect(mocks.playClick).toHaveBeenCalledOnce();
    await expectRenderedText("Expanded answer.");
  });

  it("does not send on Shift+Enter", async () => {
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    await settleChatPanelEffects();
    expect(chatRequestBodies).toHaveLength(0);
    expect(input).toHaveValue("Line one");
  });

  it("adds the web-search system prefix and payload flag from the rendered skill chip", async () => {
    renderChatPanel();
    await screen.findByText("Tutor");

    fireEvent.click(screen.getByRole("button", { name: "Open tutor tools" }));
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = screen.getByPlaceholderText("Search the web...");
    fireEvent.change(input, { target: { value: "Find retrieval sources" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const payload = await expectOneChatRequest();
    expect(payload.webSearchExplicit).toBe(true);
    expect(payload.messages.at(-1)?.content).toContain(
      "explicitly selected the Web Search skill",
    );
    expect(screen.queryByText("Web Search")).toBeNull();
  }, 10000);

  it("attaches selected PDF text and active document context to chat payloads", async () => {
    useStore.setState({
      selectedTextContext: "Selected retrieval paragraph.",
    });
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Explain this" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const payload = await expectOneChatRequest();
    expect(payload.activeDocumentId).toBe("doc:active");
    expect(Array.isArray(payload.documentContexts)).toBe(true);
    expect(mocks.buildBrainContextPacket).toHaveBeenCalledWith(
      expect.objectContaining({ activeDocumentId: "doc:active" }),
    );
    expect(payload.messages.at(-1)?.content).toContain(
      "Regarding this selected text",
    );
    expect(payload.messages.at(-1)?.content).toContain(
      "Selected retrieval paragraph.",
    );
    expect(useStore.getState().selectedTextContext).toBe("");
  });

  it("renders streamed chunks and final done content from the chat API", async () => {
    setChatEvents([
      { type: "chunk", content: "First " },
      { type: "chunk", content: "draft" },
      {
        type: "done",
        content: "Final streamed answer.",
        usage: {
          provider: "openrouter",
          model: "test-model",
          inputTokens: 10,
          outputTokens: 6,
          cost: 0,
          estimated: true,
        },
      },
    ]);
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");
    await settleChatPanelEffects();

    fireEvent.change(input, { target: { value: "Stream please" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await expectRenderedText("Final streamed answer.");
    await waitFor(() => {
      const finalMessage = useStore
        .getState()
        .messages.find(
          (message) => message.content === "Final streamed answer.",
        );
      expect(finalMessage?.usage).toMatchObject({
        provider: "openrouter",
        model: "test-model",
        inputTokens: 10,
        outputTokens: 6,
        cost: 0,
      });
    });
  });

  it("renders streamed web-search sources and reviewed-source status", async () => {
    setChatEvents([
      {
        type: "web_search_started",
        searchId: "search:one",
        query: "retrieval practice",
        mode: "search",
      },
      {
        type: "web_result",
        searchId: "search:one",
        source: sourceOne,
      },
      {
        type: "web_sources_complete",
        searchId: "search:one",
        sources: [sourceOne],
      },
      { type: "done", content: "Source-backed answer.", sources: [sourceOne] },
    ]);
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");
    await settleChatPanelEffects();

    fireEvent.change(input, { target: { value: "Find sources" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await expectRenderedText("Source-backed answer.");
    await expectRenderedText("Reviewed 1 sources");
    fireEvent.click(screen.getByRole("button", { name: /Reasoning trace/ }));
    expect(
      await screen.findByText("Retrieval Practice Guide"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("example.com").length).toBeGreaterThanOrEqual(1);
  });

  it("records streamed tool and model run events without rendering provider output", async () => {
    setChatEvents([
      {
        type: "tool_job",
        id: "tool:one",
        toolName: "web_search",
        status: "completed",
        inputSummary: "query",
        outputSummary: "one source",
      },
      {
        type: "model_run",
        id: "model:one",
        provider: "openrouter",
        status: "completed",
        requestedModel: "test-model",
        usedModel: "test-model",
      },
      { type: "chunk", content: "Tool-backed answer." },
      { type: "done", content: "Tool-backed answer." },
    ]);
    renderChatPanel();
    const input = await screen.findByPlaceholderText("Ask...");

    fireEvent.change(input, { target: { value: "Use a tool" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await expectOneChatRequest();
    await waitFor(() =>
      expect(mocks.recordToolJobEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tool:one",
          toolName: "web_search",
          status: "completed",
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.recordModelRunEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "model:one",
          provider: "openrouter",
          status: "completed",
        }),
      ),
    );
    expect(screen.queryByText("openrouter")).not.toBeInTheDocument();
  });

  it("renders an HTTP chat error inside the assistant message", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      chatResponseFactory = () =>
        Response.json({ error: "Expanded HTTP failure." }, { status: 503 });
      renderChatPanel();
      const input = await screen.findByPlaceholderText("Ask...");
      await settleChatPanelEffects();

      fireEvent.change(input, { target: { value: "Break gracefully" } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(
        await screen.findByText(/Expanded HTTP failure/),
      ).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("renders the empty-readable-stream error path", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      chatResponseFactory = () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "text/event-stream" }),
          body: null,
        }) as Response;
      renderChatPanel();
      const input = await screen.findByPlaceholderText("Ask...");
      await settleChatPanelEffects();

      fireEvent.change(input, { target: { value: "No body please" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await expectOneChatRequest();
      await waitFor(
        () => expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error)),
        { timeout: 3000 },
      );
      await waitFor(
        () => {
          const renderedErrors = screen.getAllByText((_content, element) =>
            Boolean(
              element?.textContent?.includes(
                "No readable stream from chat API",
              ),
            ),
          );
          expect(renderedErrors.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
