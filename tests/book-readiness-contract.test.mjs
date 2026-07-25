import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const readSource = (path) => readFileSync(`${repoRoot}/${path}`, "utf8");

const tutorBook = JSON.parse(readSource("src/lib/tutorBook.json"));
const audioOverviewManifest = JSON.parse(
  readSource("src/lib/chapterAudioOverviews.json"),
);
const userBrainBookSource = readSource("src/lib/userBrainArchitectureBook.ts");
const adminViewSource = readSource("src/views/AdminView.tsx");
const revisionViewSource = readSource("src/views/RevisionView.tsx");
const memoryOrchestratorSource = readSource(
  "src/memory/memory.orchestrator.ts",
);
const architectureDoc = readSource("TUTOR_ARCHITECTURE.md");

const userBrainChapterTitles = [
  ...userBrainBookSource.matchAll(/title: "([^"]+)"/g),
].map((match) => match[1]);

test("built-in architecture books stay arranged as reader-first guides", () => {
  assert.deepEqual(
    tutorBook.map((chapter) => chapter.title),
    [
      "Chapter 0: How To Use This Architecture Guide",
      "Chapter 1: The Product And Its Learning Loop",
      "Chapter 2: Technology And Service Map",
      "Chapter 3: Frontend Ownership And State",
      "Chapter 4: Study, PDFs, And Source Context",
      "Chapter 5: Foreground Teaching And Tool Delegation",
      "Chapter 6: Local Memory And The Learner Ledger",
      "Chapter 7: Revision Books And Active Recall",
      "Chapter 8: Admin, Learners, And Interpretation",
      "Chapter 9: One Complete Background Workflow",
      "Chapter 10: Models, Voice, And Provider Boundaries",
      "Chapter 11: What Is Completed And What Is Not",
      "Chapter 12: Maintenance, Safety, And Release Gates",
    ],
  );

  assert.deepEqual(userBrainChapterTitles, [
    "Chapter 1: What The Learner Brain Is",
    "Chapter 2: The Data Model For One Learner",
    "Chapter 3: From Conversation To Adaptation",
    "Chapter 4: Context, Retrieval, And Sources",
    "Chapter 5: Learning Books And Revision Material",
    "Chapter 6: Voice And Asynchronous Tools",
    "Chapter 7: Admin And Multi-Learner Oversight",
    "Chapter 8: Current Status And What Is Not Claimed",
    "Chapter 9: Glossary And References",
  ]);

  assert.match(revisionViewSource, /Wireframe Connections/);
  assert.match(revisionViewSource, /Theme System/);
  assert.match(revisionViewSource, /UI Component Snapshots/);
  assert.match(revisionViewSource, /Operator Controls And Why They Exist/);
});

test("Admin center introduction stays short and plain", () => {
  const introCopies = [
    "Select a learner, inspect their knowledge map, and follow the evidence behind each interpretation.",
    "Inspect the few operational signals needed to explain behavior and judge local readiness.",
  ];

  for (const copy of introCopies) {
    assert.match(
      adminViewSource,
      new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.ok(copy.length <= 105, "Admin preface should stay concise");
    assert.equal(copy.split(".").filter(Boolean).length, 1);
  }
});

test("Deepgram voice boundary is documented across architecture books", () => {
  const chapterTools = tutorBook[2].content;
  const chapterProviders = tutorBook[10].content;

  assert.match(chapterTools, /Deepgram Nova and Aura/);
  assert.match(chapterTools, /one TTS WebSocket per conversation/);
  assert.match(chapterProviders, /Streaming speech-to-text/);
  assert.match(chapterProviders, /Streaming text-to-speech/);
  assert.match(chapterProviders, /universal sub-200 ms response/);
  assert.match(userBrainBookSource, /Deepgram provides streaming speech/);
  assert.match(userBrainBookSource, /one WebSocket per conversation/);
  // MisoTTS was removed from the product, so the books must not describe it.
  assert.doesNotMatch(userBrainBookSource, /MisoTTS/);
  // The two runtime voice modes must be documented in the book.
  assert.match(userBrainBookSource, /deepgram-duplex/);
  assert.match(userBrainBookSource, /openai-realtime/);
  assert.match(architectureDoc, /Deepgram/i);
});

test("architecture book text keeps Graphify local and defines the Chapter 2 flowchart style", () => {
  const toolsChapter = tutorBook[2].content;
  const userBrainLedgerChapter = userBrainBookSource.match(
    /title: "Chapter 2: The Data Model For One Learner",\n    content: `([\s\S]*?)`,\n  \}/,
  )?.[1];

  assert.ok(userBrainLedgerChapter, "User Brain Chapter 2 should exist");
  assert.match(toolsChapter, /\|\s*Graphify\s*\|/);
  assert.match(toolsChapter, /not learner data/);
  assert.match(userBrainLedgerChapter, /Learner identity/);
  assert.match(userBrainLedgerChapter, /flowchart LR/);
  assert.match(userBrainLedgerChapter, /local profile has a \\`userId\\`/);
  assert.match(userBrainLedgerChapter, /server-owned learner store/);
  assert.match(userBrainLedgerChapter, /brain\.sqlite/);
  // The storage boundary must be stated the same way everywhere.
  assert.match(userBrainLedgerChapter, /system of record/);
});

test("user brain book keeps artifact and audio control scope accurate", () => {
  const retrievalChapter = userBrainBookSource.match(
    /title: "Chapter 4: Context, Retrieval, And Sources",\n    content: `([\s\S]*?)`,\n  \}/,
  )?.[1];
  const voiceAudioOverview = audioOverviewManifest.find(
    (overview) =>
      overview.bookId === "user-brain-architecture" &&
      overview.chapterTitle === "Chapter 6: Voice And Asynchronous Tools",
  );

  assert.ok(retrievalChapter, "User Brain artifact chapter should exist");
  assert.match(retrievalChapter, /Artifacts store provenance/);
  assert.match(retrievalChapter, /traceable/);
  assert.match(retrievalChapter, /semantic claim-to-source entailment/i);
  assert.ok(voiceAudioOverview, "User Brain voice audio overview should exist");
  assert.match(voiceAudioOverview.transcript, /custom controls/);
  assert.match(
    voiceAudioOverview.transcript,
    /native audio element stays hidden/,
  );
  assert.doesNotMatch(
    voiceAudioOverview.transcript,
    /native browser controls/i,
  );
});

test("every stored audio guide title-matches its current chapter", () => {
  const tutorStatusChapter = tutorBook[11].content;
  const userBrainStatusChapter = userBrainBookSource.match(
    /title: "Chapter 8: Current Status And What Is Not Claimed",\n    content: `([\s\S]*?)`,\n  \}/,
  )?.[1];

  assert.ok(userBrainStatusChapter, "User Brain status chapter should exist");
  assert.match(
    tutorStatusChapter,
    /stored audio only when an audio manifest title matches the current chapter title/,
  );
  assert.match(userBrainStatusChapter, /title-matched stored audio/);

  // The guard in RevisionView only attaches audio when the manifest title equals
  // the chapter title, so a drifted manifest silently drops the guide. Assert
  // every entry still resolves to a real chapter with the exact title.
  const bookChapterTitles = {
    "tutor-book": tutorBook.map((chapter) => chapter.title),
    "user-brain-architecture": userBrainChapterTitles,
  };
  for (const overview of audioOverviewManifest) {
    const titles = bookChapterTitles[overview.bookId];
    if (!titles) continue;
    assert.equal(
      overview.chapterTitle,
      titles[overview.chapterIndex],
      `${overview.outputFile} must title-match ${overview.bookId}[${overview.chapterIndex}]`,
    );
  }
});

test("generated revision-book summaries preserve Markdown structure", () => {
  assert.match(memoryOrchestratorSource, /const compactMarkdownText/);
  assert.match(
    memoryOrchestratorSource,
    /replace\(\s*\/\\r\\n\/g,\s*"\\n"\s*\)/,
  );
  assert.match(
    memoryOrchestratorSource,
    /replace\(\s*\/\\n\{4,\}\/g,\s*"\\n\\n\\n"\s*\)/,
  );
  assert.match(
    memoryOrchestratorSource,
    /proposedChapterSummary = compactMarkdownText/,
  );
  assert.match(
    memoryOrchestratorSource,
    /proposedConversationSummary = compactMarkdownText/,
  );
  assert.match(
    memoryOrchestratorSource,
    /proposedKnowledgeSummary = compactMarkdownText/,
  );
  assert.doesNotMatch(
    memoryOrchestratorSource,
    /proposedChapterSummary = compactText/,
  );
});

test("audio overview contract keeps one visible player and 3-4 minute guides", () => {
  assert.match(revisionViewSource, /const StoredAudioOverview/);
  assert.match(revisionViewSource, /const resolveAudioOverviewSrc/);
  assert.match(revisionViewSource, /className="sr-only"/);
  assert.match(revisionViewSource, /Preparing audio guide/);
  assert.match(revisionViewSource, /Open the local MP3 guide/);
  assert.doesNotMatch(revisionViewSource, /native fallback controls/i);
  assert.doesNotMatch(revisionViewSource, /fallback play/i);
  assert.doesNotMatch(revisionViewSource, /controls=\{showNativeControls\}/);

  for (const overview of audioOverviewManifest) {
    const words = overview.transcript.trim().split(/\s+/).filter(Boolean);
    assert.ok(
      overview.durationSeconds >= 180 && overview.durationSeconds <= 245,
      `${overview.outputFile} must stay in the 3-4 minute guide window`,
    );
    assert.ok(
      words.length >= 450,
      `${overview.outputFile} should remain a plain-language long-form guide`,
    );
    assert.match(overview.durationLabel, /about (3|4) min/);
    assert.equal(
      overview.audioSrc,
      `/audio-overviews/${overview.outputFile}`,
      `${overview.outputFile} must resolve to the checked-in public MP3 path`,
    );
  }
});
