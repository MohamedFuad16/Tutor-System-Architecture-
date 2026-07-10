import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RevisionView } from "../src/views/RevisionView";
import {
  db,
  type Flashcard,
  type LearningBook,
  type LearningBookConcept,
  type LearningEntry,
} from "../src/memory/longterm.memory";
import { useStore } from "../src/store";

const { recordFlashcardReviewEvidenceMock } = vi.hoisted(() => ({
  recordFlashcardReviewEvidenceMock: vi.fn(async () => undefined),
}));

vi.mock("../src/memory/revision.evidence", () => ({
  recordFlashcardReviewEvidence: recordFlashcardReviewEvidenceMock,
}));

const now = () => Date.now();

const generatedBook = (): LearningBook => ({
  id: "book:revision-rendered",
  sessionId: "session:revision-rendered",
  title: "Rendered Retrieval Book",
  userName: "Learner",
  source: "chat",
  overview: "A generated revision book from prior tutor interactions.",
  summary: "Retrieval practice and spacing work together.",
  knowledgeSummary: "Practice recalling ideas across increasing intervals.",
  chapters: [
    {
      id: "chapter:retrieval",
      title: "Retrieval Foundations",
      summary: "Recall strengthens access to stored knowledge.",
      conceptIds: ["concept:retrieval"],
      conversationCount: 1,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "chapter:spacing",
      title: "Spacing Strategy",
      summary: "Distributed practice improves long-term retention.",
      conceptIds: ["concept:retrieval"],
      conversationCount: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  conceptIds: ["concept:retrieval"],
  conversationCount: 2,
  createdAt: now(),
  updatedAt: now(),
});

const generatedConcept = (): LearningBookConcept => ({
  id: "concept:retrieval",
  bookId: "book:revision-rendered",
  name: "Retrieval Practice",
  summary: "Actively recalling an answer strengthens later access.",
  mastery: 0.4,
  confidence: 0.5,
  parentConcepts: [],
  childConcepts: ["Spacing"],
  evidence: ["Rendered tutor exchange"],
  firstSeenAt: now(),
  updatedAt: now(),
});

const generatedEntry = (): LearningEntry => ({
  id: "entry:revision-rendered",
  bookId: "book:revision-rendered",
  conversationId: "conversation:revision-rendered",
  timestamp: now(),
  userName: "Learner",
  userMessage: "How should I study this?",
  assistantSummary: "Use active recall followed by spaced review.",
  conversationSummary: "The learner connected retrieval and spacing.",
  learnedConcepts: ["Retrieval Practice"],
  risks: [],
  model: "test-model",
  confidence: 0.8,
});

const dueFlashcard = (): Flashcard => ({
  id: "flashcard:revision-rendered",
  bookId: "book:revision-rendered",
  bookTitle: "Rendered Retrieval Book",
  conceptId: "concept:retrieval",
  front: "What makes retrieval practice effective?",
  back: "It requires reconstructing knowledge instead of rereading it.",
  nextReviewAt: now() - 60_000,
});

const seedGeneratedRevisionData = async () => {
  await db.learningBooks.put(generatedBook());
  await db.learningBookConcepts.put(generatedConcept());
  await db.learningEntries.put(generatedEntry());
  await db.flashcards.put(dueFlashcard());
};

const resetRevisionStore = () => {
  localStorage.clear();
  useStore.setState({
    accessMode: "user",
    activeDocumentId: null,
    activeLearningBookId: null,
    activeProject: "General Study",
    activeView: "revision",
    animationsEnabled: false,
  });
};

const renderRevision = () => render(<RevisionView />);

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetRevisionStore();
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

describe("rendered RevisionView flows", () => {
  it("updates the generated-book library when Dexie records arrive after mount", async () => {
    renderRevision();

    expect(
      screen.getByRole("button", {
        name: "Open built-in book Tutor System Architecture",
      }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", {
          name: "Open built-in book Tutor System Architecture",
        })
        .querySelector('[role="button"]'),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Generated learning books" }),
    ).toBeNull();

    await act(async () => {
      await seedGeneratedRevisionData();
    });

    expect(
      await screen.findByRole("region", { name: "Generated learning books" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open learning book Rendered Retrieval Book",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 concepts")).toBeInTheDocument();
    expect(screen.getByText("1 cards")).toBeInTheDocument();
  });

  it("opens a generated learning book, renders mapped notes, and navigates chapters", async () => {
    const user = userEvent.setup();
    await seedGeneratedRevisionData();
    renderRevision();

    await user.click(
      await screen.findByRole("button", {
        name: "Open learning book Rendered Retrieval Book",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "Retrieval Foundations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Recall strengthens access to stored knowledge."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Retrieval Practice").length,
    ).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: /Next/ }));

    expect(
      screen.getByRole("heading", { name: "Spacing Strategy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Distributed practice improves long-term retention."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Back to Library" })[0],
    );
    expect(
      await screen.findByRole("button", {
        name: "Open learning book Rendered Retrieval Book",
      }),
    ).toBeInTheDocument();
  });

  it("reviews a due flashcard and persists the next review before evidence recording", async () => {
    const user = userEvent.setup();
    useStore.setState({
      brainRuntimeSettings: {
        ...useStore.getState().brainRuntimeSettings,
        bktTransitProbability: 0.23,
        bktSlipProbability: 0.04,
        bktGuessProbability: 0.13,
      },
    });
    await seedGeneratedRevisionData();
    renderRevision();

    await user.click(
      await screen.findByRole("button", {
        name: "Open learning book Rendered Retrieval Book",
      }),
    );

    expect(screen.getByText("1 due now · 1 total")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Show flashcard answer" }),
    );
    expect(
      screen.getByText(
        "It requires reconstructing knowledge instead of rereading it.",
      ),
    ).toBeInTheDocument();

    const beforeReview = (
      await db.flashcards.get("flashcard:revision-rendered")
    )?.nextReviewAt;
    await user.click(screen.getByRole("button", { name: "GOOD" }));

    await waitFor(async () => {
      const updated = await db.flashcards.get("flashcard:revision-rendered");
      expect(updated?.nextReviewAt).toBeGreaterThan(beforeReview || 0);
    });
    expect(recordFlashcardReviewEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "flashcard:revision-rendered" }),
      4,
      expect.objectContaining({
        runtimeSettings: expect.objectContaining({
          bktTransitProbability: 0.23,
          bktSlipProbability: 0.04,
          bktGuessProbability: 0.13,
        }),
      }),
    );
  });

  it("exposes the Admin dashboard library card only in admin mode and routes through Zustand", async () => {
    const user = userEvent.setup();
    useStore.setState({ accessMode: "admin" });
    renderRevision();

    const adminCard = screen.getByRole("button", {
      name: /Admin Dashboard/,
    });
    expect(adminCard).toBeInTheDocument();

    await user.click(adminCard);
    expect(useStore.getState().activeView).toBe("admin");
  });
});
