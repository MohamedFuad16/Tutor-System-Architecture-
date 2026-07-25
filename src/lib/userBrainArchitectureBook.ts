const userBrainArchitectureBook = [
  {
    title: "Chapter 1: What The Learner Brain Is",
    content: `The learner brain is Tutor's durable, reviewable picture of one learner's study history. It is not a copy of the human brain, it is not a model's hidden memory, and it is not the Graphify repository map.

Tutor keeps a learner in a real-time conversation while slower work happens beside it. The diagram below is the runtime shape of that idea.

~~~interaction-runtime
user-brain-runtime
~~~

| Layer | Responsibility |
| --- | --- |
| Interaction tutor | Hold the conversation, explain, ask, and adapt in the moment. |
| Learner brain | Store learning books, concepts, evidence, mastery estimates, artifacts, and corrections. |
| Background worker | Retrieve information, run tools, summarize completed turns, and propose bounded updates. |
| Admin | Let an operator inspect why the system reached an interpretation. |

~~~mermaid
flowchart LR
  Action[Learner action] --> Context[Current source and history]
  Context --> Tutor[Interaction tutor]
  Tutor --> Records[Durable learner records]
  Records --> Next[Next explanation or review]
~~~

The goal is not to collect everything a learner says. The goal is to preserve useful learning state with enough evidence, source context, ownership, and correction history to make later teaching better.

Two rules hold throughout this book. First, durable learner records live on the server; the browser keeps a cache. Second, only evaluated learner work can change mastery — conversation alone cannot.`,
  },
  {
    title: "Chapter 2: The Data Model For One Learner",
    content: `The learner brain is organized as a ledger. Each durable interpretation should answer: what changed, what caused it, how certain is it, and how can it be corrected?

| Record | Practical meaning |
| --- | --- |
| Learning book | A subject or study thread that belongs to a learner. |
| Chapter and entry | Revision material created from completed teaching. |
| Learning-book concept | A concept and its relationships inside one book. |
| Persistent concept | A concept with mastery parameters and review history. |
| Evidence event | A learner action evaluated under an explicit contract. |
| Mastery delta | The exact change produced by accepted evidence. |
| Artifact | A generated or retrieved object such as notes, cards, code, audio, or a source card. |
| Correction event | A non-destructive request to review, quarantine, or supersede a record. |

~~~mermaid
flowchart LR
  learner["Learner identity"] --> books["Learning books"]
  books --> chapters["Chapters and entries"]
  books --> concepts["Concept relationships"]
  concepts --> evidence["Evidence attempts"]
  evidence --> mastery["Mastery estimates"]
  mastery --> review["Revision and teaching"]
~~~

Each local profile has a \`userId\`. That \`userId\` travels with HTTP requests and with the voice websocket handshake, and every new learner record carries it, so books, PDFs, conversations, concepts, evidence, mastery deltas, misconceptions, and background tasks never blend across profiles.

## Where The Data Actually Lives

Durable local records live in a server-owned learner store:

~~~text
data/users/<userId>/
  brain.sqlite
  documents/
  extracted-text/
  artifacts/
  exports/
~~~

SQLite is a small database kept as a server-side file; here it is the local bridge to a future cloud database. Dexie is a wrapper around browser IndexedDB, the browser's structured storage system.

**The server store is the system of record.** IndexedDB is cache, UI state, and non-destructive migration fallback — it is not the permanent home for full PDF files or full extracted text. If the two ever disagree, the server store wins. See the [official Dexie documentation](https://dexie.org/docs).`,
  },
  {
    title: "Chapter 3: From Conversation To Adaptation",
    content: `Tutor uses two speeds of adaptation, and keeping them apart is what makes the learner record trustworthy.

## Fast Interaction State

Hesitation, selected text, repeated questions, voice timing, and the active page may change the next explanation immediately. These signals are useful context, but they are not durable proof.

## Slow Learner State

A durable mastery change requires a learner action linked to a real concept and evaluated under a known evidence contract. In practice that means an evaluated answer or a flashcard review with an explicit outcome. Transcripts, model summaries, tool results, and retrieved sources are audit context only — they can never raise mastery on their own.

~~~mermaid
flowchart LR
  Explain[Explain] --> Try[Learner tries]
  Try --> Evaluate[Evaluate response]
  Evaluate --> Gate{Validated evidence?}
  Gate -->|yes| Update[Update mastery estimate]
  Gate -->|no| Context[Use only as teaching context]
  Update --> Adapt[Choose next teaching move]
  Context --> Adapt
~~~

Writes through this gate are fail-closed and idempotent: if any part of an evidence write cannot be completed, the whole update rolls back rather than leaving a half-recorded claim.

Tutor supports conservative evidence thresholds, Bayesian Knowledge Tracing, and a decay-sensitive BKT path. BKT estimates a hidden knowledge state from observable attempts using learn, slip, and guess probabilities. The original model is described by [Corbett and Anderson](https://doi.org/10.1007/BF01099821).

Tutor does not claim neural knowledge tracing or a scientifically validated cognitive diagnosis for every learner.`,
  },
  {
    title: "Chapter 4: Context, Retrieval, And Sources",
    content: `The context builder decides what the tutor should see before it answers. Typed chat and voice share one builder, so both surfaces reason over the same material.

~~~mermaid
flowchart TD
  Question[Learner question] --> Local{About current study material?}
  Local -->|yes| Study[Page, selection, active book, PDFs]
  Local -->|no or freshness required| Web[Background web tool]
  Study --> Answer[Interaction tutor answer]
  Web --> Normalize[Source-linked compact result]
  Normalize --> Answer
~~~

Local source questions prefer the active page, selected text, active learning book, and uploaded documents. Current facts such as prices, news, schedules, or recent research require web retrieval.

## What Travels In The Packet

The context packet carries the active user, book, document IDs, a document manifest, excerpts, semantic memory, learner model state, and request and proof IDs. It is assembled slightly differently for the two surfaces: the voice packet is ordered and compacted harder, because a spoken turn has a much smaller budget than a typed one.

PDFs are extracted once at upload into page-indexed markdown. When the learner is reading a page, that page's text is injected as an explicit \`CURRENT PAGE N of M\` block alongside a trimmed whole-document excerpt, so a question like "what is on this page?" is answered from the real page rather than the opening of the file. A rendered page image remains available as an on-demand tool for visual questions.

## Provenance Is Not Proof

Artifacts store provenance: which request created an item, which source rows were available, and which limited verifier ran. Provenance makes a result traceable. It does not automatically prove that every sentence is true.

| Citation state | Meaning |
| --- | --- |
| \`verified\` | A named verifier passed for its stated, limited scope. |
| \`not_checked\` | Provenance exists, but no supported verifier has passed. |
| \`unsupported\` or \`unavailable\` | The current verifier cannot evaluate the item. |
| \`conflicting\` | Saved source and claim fields disagree. |

Semantic claim-to-source entailment and document-wide grounding are still partly completed work.`,
  },
  {
    title: "Chapter 5: Learning Books And Revision Material",
    content: `A learning book should still be useful after the conversation has been forgotten. It is not a transcript dump.

Each generated chapter aims to contain:

1. a clear big idea;
2. an explanation of the mechanism;
3. related concepts and distinctions;
4. a worked example;
5. a flowchart or code sample when the subject benefits from one;
6. an active-recall check.

~~~mermaid
flowchart LR
  Turn[Completed tutor turn] --> Extract[Extract teachable ideas]
  Extract --> Organize[Organize chapter]
  Organize --> Explain[Explanation and example]
  Organize --> Visual[Diagram or code]
  Explain --> Review[Recall check]
  Visual --> Review
~~~

Generated content is saved as an artifact with source metadata. When document excerpts exist, the system can save bounded source-span anchors. These anchors support review; they do not yet prove full semantic agreement.

Built-in books like this one ship with the app and are rendered from the same Markdown pipeline as generated books, so diagrams, tables, and code blocks behave identically everywhere. A chapter plays its stored audio guide only when an audio manifest entry matches that chapter's current title — a deliberate guard so a renamed chapter never plays a recording about a different subject.

Reliable notebook-quality output from very short or weakly grounded conversations remains partly completed.`,
  },
  {
    title: "Chapter 6: Voice And Asynchronous Tools",
    content: `Voice is where the two-speed design becomes audible. A fast interaction tutor keeps talking while a slower background worker does the heavy lifting, and the result is folded back into the same conversation.

~~~mermaid
sequenceDiagram
  participant U as Learner
  participant V as Voice session
  participant F as Interaction tutor
  participant B as Background worker
  U->>V: Speech
  V->>F: Streaming transcript
  F->>U: Acknowledge and begin teaching
  F->>B: Queue current fact, code, PDF, or analysis work
  B-->>F: Compact source-linked result
  F->>U: Insert a natural continuation
~~~

## The Two Voice Modes

Voice mode is a runtime setting, not a build flag.

| Mode | What it is |
| --- | --- |
| \`deepgram-duplex\` (default) | Deepgram streaming speech-to-text and Aura text-to-speech around the two-model split above. This is the product path. |
| \`openai-realtime\` | A test and comparison path that connects the browser straight to OpenAI's Realtime API over WebRTC for true full-duplex speech. It is deliberately not the default and bills at premium realtime rates. |

Deepgram provides streaming speech recognition and Aura text-to-speech. Its [streaming TTS documentation](https://developers.deepgram.com/docs/streaming-text-to-speech) recommends one WebSocket per conversation, which lets Tutor avoid a new connection for every sentence and supports controls such as flush and clear.

## The Models Behind The Lanes

Three models are chosen in Settings and share one OpenRouter key: a **chat model** for typed study, a **voice foreground model** that is the interaction tutor, and a **background smart model** used by both surfaces for delegated work. Typed chat reaches the same background worker through a \`delegate_to_background\` tool, so the split is not voice-only.

The foreground model must acknowledge delegated work — "I will check that and let you know" — and continue the lesson while the job runs. When the result arrives it should use a natural bridge such as "Also," or "One more useful detail." Raw JSON, Markdown markers, and provider labels are stripped before speech.

## Where Voice Runs

The duplex path needs a long-lived WebSocket host, which a serverless deployment cannot provide. In production the browser opens the voice socket against a dedicated voice server over \`wss://\`, while the rest of the app can stay serverless.

Repeatable latency and duplex-quality proof across real regions and provider keys is still partly completed. No route claims a universal sub-200 ms response; latency belongs in a measured report with p50, p95, failure rate, provider, region, and hardware.`,
  },
  {
    title: "Chapter 7: Admin And Multi-Learner Oversight",
    content: `Admin is a decision-support surface, not a wall of database tables. The first view lets an operator select a learner and understand their local knowledge map.

~~~mermaid
flowchart LR
  Select[Select learner] --> Books[Books and subjects]
  Books --> Graph[Concept relationship graph]
  Graph --> Signals[Mastery, confidence, attempts]
  Signals --> Patterns[Strengths, gaps, review needs]
  Patterns --> Evidence[Inspect supporting rows]
~~~

## How To Read The Signals

- **Mastery** is an evidence-linked probability or score, not a school grade.
- **Confidence** is how strongly local records support the interpretation.
- **Attempts** show how much direct learner evidence exists.
- **Misconceptions** are hypotheses requiring review.
- **Last activity** helps distinguish a new gap from knowledge that may have decayed.

Because every model call, tool job, retrieval, memory write, artifact, and background task carries the same request ID, an operator can follow one learner action all the way across chat, voice, tools, and memory instead of guessing which rows belong together.

The concept graph resembles Graphify visually because both draw nodes and relationships, but they describe different worlds. Graphify maps code for maintainers. The learner graph maps study concepts for teaching.

Diagnostics keep two things apart on purpose: a synthetic rehearsal that checks wiring in memory and cannot raise readiness, and a coherent provider-key proof that requires real runs sharing one book, thread, and proof attempt. Authenticated users and hard data isolation remain partly completed; organization-wide cloud administration is deferred.`,
  },
  {
    title: "Chapter 8: Current Status And What Is Not Claimed",
    content: `This chapter is the honest audit. Read it before trusting any capability claim elsewhere in the book.

## Completed Locally

- Local learner profiles with stable user IDs.
- Server-side per-user folders, SQLite learner stores, PDF files, page-indexed extracted text, and generated artifacts.
- Local learner books, concepts, entries, documents, chat archives, and flashcards.
- Evidence events, mastery deltas, BKT-backed updates, and correction overlays.
- User-scoped, source-first context packets shared by typed chat and voice, including current-page injection.
- Tool, model, retrieval, memory, artifact, and background-job ledgers correlated by request ID.
- The two-model split on both surfaces: the voice duplex broker and the typed-chat \`delegate_to_background\` tool.
- Revision books with diagrams, code rendering, flashcards, and title-matched stored audio guides.
- Admin inspection and local-beta diagnostics.

## Partly Completed

- Rich chapter generation from sparse conversations.
- Semantic verification of every generated claim.
- Real-provider typed-chat and live-voice proof across a repeatable test matrix.
- Measured latency and duplex-quality evidence across regions and provider keys.
- Cloud authentication and secure production identity beyond local profiles.

## Not Claimed

- Neural knowledge tracing or validated cognitive diagnosis.
- A universal latency guarantee for any voice route.
- Proof that every generated sentence is factually true; provenance is traceability, not truth.

## Deferred

- Cloud as the system of record, tenant isolation, backup, cross-device sync, production queues, and organization dashboards.`,
  },
  {
    title: "Chapter 9: Glossary And References",
    content: `## Glossary

| Term | Full meaning |
| --- | --- |
| Active book | The learning book whose documents, chat history, and summaries receive priority in the current context packet. |
| Artifact | Generated or retrieved material such as notes, cards, code, audio, images, or source cards. |
| Background smart model | The stronger model that both typed chat and voice delegate slow or complex work to. |
| Background worker | The asynchronous lane that runs delegated work and returns a compact result to the conversation. |
| Barge-in | The learner interrupting spoken output so playback stops and listening resumes. |
| Bayesian Knowledge Tracing (BKT) | A probabilistic method that estimates whether a learner knows a skill from attempts, learning transitions, slips, and guesses. |
| Citation state | The recorded result of a limited source-integrity check for an artifact. |
| Confidence | The strength of local support for an interpretation; it is not certainty. |
| Context packet | The bounded set of book, PDF, page, selection, memory, and interaction data sent with a tutor request. |
| Correction overlay | A non-destructive record that marks data for review, quarantine, or replacement. |
| Deepgram Aura | A Deepgram text-to-speech model family used for streamed audio output. |
| Deepgram Nova | A Deepgram speech-to-text model family used for streaming transcription. |
| \`delegate_to_background\` | The typed-chat tool that hands a heavy sub-task to the background smart model. |
| \`deepgram-duplex\` | The default voice mode: Deepgram speech plus the two-model interaction/background split. |
| Dexie | The JavaScript library used to work with browser IndexedDB. Tutor uses it for cache, UI state, and offline fallback rows. |
| Evidence contract | The exact conditions a learner action must satisfy before it can change durable mastery. |
| Evidence event | A stored learner attempt and its validation result. |
| Graphify | The generated repository architecture graph used by maintainers; it maps code, not learners. |
| Interaction tutor | The fast foreground model that holds the live conversation on either surface. |
| Learner brain | Tutor's durable, auditable record of one user's learning material, evidence, estimates, and corrections. |
| Learning book | A learner-owned collection of chapters, concepts, documents, and conversation-derived material. |
| Mastery delta | The before-and-after learner-state change caused by accepted evidence. |
| Misconception candidate | A reviewable hypothesis that a learner may hold an incorrect model; it is not automatically treated as fact. |
| Model run | A ledger row describing a model request, status, timing, and provider metadata. |
| \`openai-realtime\` | The test-only speech-to-speech voice mode running over WebRTC. |
| Provenance | Information describing where an artifact or record came from and which request produced it. |
| Request ID | A correlation identifier used to follow one interaction across model, tool, retrieval, and memory rows. |
| Retrieval event | A record of context selected from local or external sources. |
| Source span | A bounded excerpt anchor saved to help inspect support for generated notes. |
| SQLite | The server-side local database file that is the system of record for durable learner rows. |
| Tenant isolation | Security rules that prevent one authenticated user's data from being read as another user's data. |
| Tool job | A bounded capability request such as search, page inspection, code work, or artifact generation. |
| Trace | An app activity record used for debugging; it is not proof of private model reasoning or factual truth. |
| User ID | The local profile identifier that keeps books, documents, context, and evidence scoped to the active user. |
| Voice foreground model | The model configured as the interaction tutor for spoken conversation. |
| WebSocket | A persistent two-way network connection used for streaming events or audio. |

## References

- [Dexie and IndexedDB documentation](https://dexie.org/docs)
- [Deepgram streaming speech-to-text documentation](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Deepgram streaming text-to-speech documentation](https://developers.deepgram.com/docs/streaming-text-to-speech)
- [OpenAI tool-use guide](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI Realtime and audio guide](https://developers.openai.com/api/docs/guides/realtime)
- [Corbett and Anderson, Knowledge Tracing](https://doi.org/10.1007/BF01099821)

These references explain the general technologies and research. The current source, tests, and measured runtime evidence remain the authority for what Tutor actually implements.`,
  },
];

export default userBrainArchitectureBook;
