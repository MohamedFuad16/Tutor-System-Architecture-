import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const {
  AUDIO_OVERVIEW_DEEPGRAM_MODEL,
  AUDIO_OVERVIEW_DEEPGRAM_SPEED,
  audioOverviewIdFor,
  audioOverviewPublicSrcFor,
  buildAudioOverviewDryRunReport,
  buildAudioOverviewSpeechInput,
  builtInBookAudioOverviewPlan,
  userBrainAudioOverviewPlan,
} = await import("../scripts/user-brain-audio-overview-plan.mjs");

const revisionViewSource = readFileSync(
  `${repoRoot}/src/views/RevisionView.tsx`,
  "utf8",
);
const tutorBookSource = readFileSync(
  `${repoRoot}/src/lib/tutorBook.json`,
  "utf8",
);
const userBrainBookSource = readFileSync(
  `${repoRoot}/src/lib/userBrainArchitectureBook.ts`,
  "utf8",
);
const ffprobeAvailable =
  spawnSync("which", ["ffprobe"], { encoding: "utf8" }).status === 0;
const afinfoAvailable =
  spawnSync("which", ["afinfo"], { encoding: "utf8" }).status === 0;

const measuredAudioDurationSeconds = (filePath) => {
  if (ffprobeAvailable) {
    const result = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        filePath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return Math.round(Number(result.stdout.trim()));
  }

  const result = spawnSync("afinfo", [filePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const durationMatch = result.stdout.match(/estimated duration:\s*([0-9.]+)/i);
  assert.ok(
    durationMatch,
    `Could not read duration from afinfo for ${filePath}`,
  );
  return Math.round(Number(durationMatch[1]));
};

const expectedBooks = [
  {
    bookId: "tutor-book",
    bookTitle: "Tutor System Architecture",
    titles: builtInBookAudioOverviewPlan
      .filter((entry) => entry.bookId === "tutor-book")
      .map((entry) => entry.chapterTitle),
  },
  {
    bookId: "user-brain-architecture",
    bookTitle: "User Brain Architecture",
    titles: builtInBookAudioOverviewPlan
      .filter((entry) => entry.bookId === "user-brain-architecture")
      .map((entry) => entry.chapterTitle),
  },
  {
    bookId: "app-design-language",
    bookTitle: "App Design Language",
    titles: [
      "Wireframe Connections",
      "Theme System",
      "UI Component Snapshots",
      "Operator Controls And Why They Exist",
    ],
  },
];

test("stored audio overview plan remains internally consistent", () => {
  assert.equal(AUDIO_OVERVIEW_DEEPGRAM_MODEL, "aura-2-odysseus-en");
  assert.equal(AUDIO_OVERVIEW_DEEPGRAM_SPEED, 1);
  // Not every chapter ships a stored guide: chapters whose earlier recording
  // covered a different subject were left without audio rather than given a
  // mismatched one. Coverage is therefore a subset, not one-per-chapter.
  assert.ok(userBrainAudioOverviewPlan.length > 0);

  const expectedTotal = expectedBooks.reduce(
    (sum, book) => sum + book.titles.length,
    0,
  );
  assert.equal(builtInBookAudioOverviewPlan.length, expectedTotal);

  const outputFiles = new Set();
  const overviewIds = new Set();

  for (const book of expectedBooks) {
    const rows = builtInBookAudioOverviewPlan.filter(
      (entry) => entry.bookId === book.bookId,
    );
    assert.equal(rows.length, book.titles.length);
    assert.deepEqual(
      rows.map((entry) => entry.chapterTitle),
      book.titles,
    );

    // Chapter indices stay strictly increasing, but need not be contiguous —
    // chapters without a subject-matching recording simply have no entry.
    let previousChapterIndex = -1;
    rows.forEach((entry) => {
      assert.equal(entry.bookTitle, book.bookTitle);
      assert.ok(
        entry.chapterIndex > previousChapterIndex,
        `${book.bookId} audio rows must stay ordered by chapterIndex`,
      );
      previousChapterIndex = entry.chapterIndex;
      assert.match(entry.outputFile, /^[a-z0-9-]+\.mp3$/);
      assert.equal(entry.assetStatus, "stored");
      assert.equal(entry.transcript.includes("```"), false);
      assert.ok(buildAudioOverviewSpeechInput(entry).length >= 2800);
      assert.ok(
        buildAudioOverviewSpeechInput(entry).split(/\s+/).filter(Boolean)
          .length >= 450,
      );
      assert.ok((entry.transcript.match(/[.!?]/g) || []).length >= 7);
      assert.ok(
        entry.durationSeconds >= 180 && entry.durationSeconds <= 245,
        `${entry.outputFile} should stay inside the 3-4 minute audio window`,
      );
      assert.match(entry.durationLabel, /about (3|4) min/);
      assert.match(
        audioOverviewPublicSrcFor(entry),
        /^\/audio-overviews\/.+\.mp3$/,
      );
      assert.equal(
        audioOverviewPublicSrcFor(entry),
        `/audio-overviews/${entry.outputFile}`,
      );
      outputFiles.add(entry.outputFile);
      overviewIds.add(audioOverviewIdFor(entry));
    });
  }

  assert.equal(outputFiles.size, expectedTotal);
  assert.equal(overviewIds.size, expectedTotal);
  assert.match(
    revisionViewSource,
    /chapterTitle ===\s+chapter\.title/,
    "Rewritten chapters must only attach audio from the same chapter edition",
  );
  // The books explain the title-match guard rather than carrying a stale
  // "audio regeneration pending" note; the manifest is title-matched again.
  assert.match(tutorBookSource, /matches the current chapter title/);
  assert.match(userBrainBookSource, /title-matched stored audio/);
  assert.doesNotMatch(tutorBookSource, /regenerated, title-matched MP3/);
  assert.doesNotMatch(userBrainBookSource, /regenerated audio guides/);
});

test("audio overview dry run report distinguishes stored and missing assets", () => {
  const existingFiles = new Set(["user-brain-runtime-overview.mp3"]);
  const report = buildAudioOverviewDryRunReport({ existingFiles });

  assert.equal(report.total, builtInBookAudioOverviewPlan.length);
  assert.equal(report.present, 1);
  assert.equal(report.missing, builtInBookAudioOverviewPlan.length - 1);

  const presentRows = report.rows.filter((row) => row.fileStatus === "present");
  assert.equal(presentRows.length, 1);
  assert.equal(presentRows[0].assetStatus, "stored");
  assert.equal(presentRows[0].durationSeconds, 207);

  const missingRows = report.rows.filter((row) => row.fileStatus === "missing");
  assert.ok(missingRows.every((row) => row.assetStatus === "stored"));
});

test("stored audio assets are checked into the local public directory", () => {
  const audioDir = `${repoRoot}/public/audio-overviews`;
  const checkedInFiles = new Set(readdirSync(audioDir));

  for (const entry of builtInBookAudioOverviewPlan) {
    assert.equal(
      existsSync(`${audioDir}/${entry.outputFile}`),
      true,
      `${entry.outputFile} should exist`,
    );
    assert.equal(checkedInFiles.has(entry.outputFile), true);
  }
});

test(
  "stored audio assets match their 3-4 minute manifest durations",
  { skip: !ffprobeAvailable && !afinfoAvailable },
  () => {
    const audioDir = `${repoRoot}/public/audio-overviews`;

    for (const entry of builtInBookAudioOverviewPlan) {
      const measuredSeconds = measuredAudioDurationSeconds(
        `${audioDir}/${entry.outputFile}`,
      );
      assert.ok(
        measuredSeconds >= 180 && measuredSeconds <= 245,
        `${entry.outputFile} measured ${measuredSeconds}s`,
      );
      assert.equal(
        measuredSeconds,
        entry.durationSeconds,
        `${entry.outputFile} manifest duration should match the checked-in MP3`,
      );
    }
  },
);

test("stored audio overview exposes one visible player", () => {
  assert.match(revisionViewSource, /const StoredAudioOverview/);
  assert.match(revisionViewSource, /const resolveAudioOverviewSrc/);
  assert.match(revisionViewSource, /className="sr-only"/);
  assert.match(revisionViewSource, /Preparing audio guide/);
  assert.match(revisionViewSource, /Open the local MP3 guide/);
  assert.doesNotMatch(
    revisionViewSource,
    /This same player is retrying in the background/,
  );
  assert.doesNotMatch(revisionViewSource, /Retrying through this player/);
  assert.doesNotMatch(revisionViewSource, /controls=\{showNativeControls\}/);
  assert.doesNotMatch(revisionViewSource, /Native fallback available/);
  assert.doesNotMatch(revisionViewSource, /native fallback controls/i);
  assert.doesNotMatch(revisionViewSource, /fallback play/i);
});

test("audio overview generator dry-run does not require a Deepgram key", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-user-brain-audio-overviews.mjs", "--dry-run"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DEEPGRAM_API_KEY: "" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Built-in book audio guide plan/);
  assert.match(result.stdout, /Provider: deepgram/);
  assert.match(result.stdout, /aura-2-odysseus-en/);
  assert.match(
    result.stdout,
    new RegExp(
      `${builtInBookAudioOverviewPlan.length} present, 0 missing, ${builtInBookAudioOverviewPlan.length} planned`,
    ),
  );
  assert.match(result.stdout, /user-brain-runtime-overview\.mp3 .*207s/);
});

test("audio overview generator dry-run can filter by book", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/generate-user-brain-audio-overviews.mjs",
      "--dry-run",
      "--book",
      "app-design-language",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DEEPGRAM_API_KEY: "" },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Provider: deepgram/);
  assert.match(result.stdout, /app-design-language chapter 1/);
  assert.match(result.stdout, /4 planned/);
});
