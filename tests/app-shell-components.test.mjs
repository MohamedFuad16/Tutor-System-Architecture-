import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readSource = (path) => readFileSync(`${repoRoot}/${path}`, "utf8");

const appSource = readSource("src/App.tsx");
const navigationSource = readSource("src/components/Navigation.tsx");
const settingsSource = readSource("src/components/SettingsModal.tsx");
const motionSource = readSource("src/hooks/useMotionPreference.ts");
const chatSource = readSource("src/components/ChatPanel.tsx");
const analyticsSource = readSource("src/views/AnalyticsView.tsx");

test("App shell exposes the Graphify-routed page set and guards admin routing", () => {
  assert.match(
    appSource,
    /const VALID_VIEWS = new Set\(\["study", "analytics", "revision", "admin"\]\);/,
  );
  assert.match(appSource, /if \(!VALID_VIEWS\.has\(activeView as string\)\)/);
  assert.match(
    appSource,
    /if \(accessMode === "user" && activeView === "admin"\)/,
  );

  for (const [view, variant] of [
    ["study", "rise"],
    ["analytics", "scale"],
    ["revision", "slide"],
    ["admin", "admin"],
  ]) {
    assert.match(
      appSource,
      new RegExp(
        `activeView === "${view}"[\\s\\S]*variant="${variant}"[\\s\\S]*motionEnabled=\\{motionEnabled\\}`,
      ),
    );
  }
});

test("App keyboard navigation ignores text entry and admin shortcut is gated", () => {
  assert.match(appSource, /const handleKeyDown = \(e: KeyboardEvent\)/);
  assert.match(appSource, /target instanceof HTMLInputElement/);
  assert.match(appSource, /target instanceof HTMLTextAreaElement/);
  assert.match(appSource, /target\.isContentEditable/);
  assert.match(appSource, /e\.ctrlKey \|\|\s+e\.metaKey \|\|\s+e\.altKey/);
  assert.match(appSource, /if \(e\.key === "1"\) setActiveView\("study"\)/);
  assert.match(
    appSource,
    /if \(e\.key === "4" && accessMode === "admin"\) setActiveView\("admin"\)/,
  );
});

test("GSAP route transitions respect reduced-motion settings and clean up", () => {
  assert.match(
    appSource,
    /import \{ useMotionPreference \} from "\.\/hooks\/useMotionPreference";/,
  );
  assert.match(appSource, /const motionEnabled = useMotionPreference\(\);/);
  assert.match(appSource, /duration: motionEnabled \? 0\.3 : 0,/);
  assert.match(appSource, /const visibilityFallback = window\.setTimeout/);
  assert.match(appSource, /window\.clearTimeout\(visibilityFallback\)/);
  assert.match(appSource, /tween\.kill\(\)/);

  assert.match(
    motionSource,
    /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)/,
  );
  assert.match(
    motionSource,
    /return animationsEnabled && !prefersReducedMotion;/,
  );
});

test("Navigation component exposes accessible page buttons and motion gating", () => {
  assert.match(
    navigationSource,
    /const motionEnabled = useMotionPreference\(\);/,
  );
  // Motion gating is on the active-pill tween (the rotating border was removed).
  assert.match(navigationSource, /duration: motionEnabled \? 0\.42 : 0,/);
  assert.match(
    navigationSource,
    /window\.matchMedia\?\.\("\(pointer: coarse\)"\)/,
  );
  assert.match(navigationSource, /type="button"/);
  assert.match(
    navigationSource,
    /aria-current=\{isActive \? "page" : undefined\}/,
  );
  assert.match(navigationSource, /id: "study"/);
  assert.match(navigationSource, /id: "analytics"/);
  assert.match(navigationSource, /id: "revision"/);
  assert.match(navigationSource, /accessMode === "admin"/);
});

test("Settings icon-only controls expose labels, pressed state, and reduced-motion animation", () => {
  assert.match(
    settingsSource,
    /const motionEnabled = useMotionPreference\(\);/,
  );
  assert.match(settingsSource, /if \(!motionEnabled\) return;/);
  assert.match(settingsSource, /duration: motionEnabled \? 0\.28 : 0,/);
  assert.match(
    settingsSource,
    /type="button"\s+aria-label=\{t\("app_settings"\)\}/,
  );
  assert.match(settingsSource, /aria-label="Close settings"/);
  assert.match(settingsSource, /aria-label="Toggle animations"/);
  assert.match(settingsSource, /aria-pressed=\{inputAnimations\}/);
});

test("Shared analytics and chat surfaces declare ARIA and keyboard contracts", () => {
  assert.match(analyticsSource, /role=\{role\}/);
  assert.match(
    analyticsSource,
    /aria-live=\{role === "alert" \? "assertive" : "polite"\}/,
  );
  assert.match(analyticsSource, /aria-describedby=\{describedBy\}/);
  assert.match(analyticsSource, /aria-label=\{label\}/);
  assert.match(analyticsSource, /role="region"/);
  assert.match(analyticsSource, /role="tooltip"/);

  assert.match(chatSource, /aria-live="polite"/);
  assert.match(chatSource, /aria-label="Close tutor chat"/);
  assert.match(chatSource, /aria-label="Open tutor tools"/);
  assert.match(chatSource, /aria-label="Send message"/);
  assert.match(chatSource, /onKeyDown=\{\(e\) =>/);
  assert.match(chatSource, /e\.key === "Enter"/);
});
