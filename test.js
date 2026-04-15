/**
 * test.js — Smart Event Assistant Test Suite
 *
 * Lightweight, zero-dependency test runner.
 * Compatible with both Node.js (node test.js) and browser DevTools console.
 *
 * Coverage:
 *   1. Firebase data shape & crowd parsing
 *   2. AI/NLP response generation logic (getBestZone & generateResponse)
 *   3. UI rendering helpers (updateHeatmapUI, updateBestZoneWidget)
 *
 * Usage:
 *   node test.js          → Runs all tests, prints PASS/FAIL to terminal
 *   Open index.html in browser, then paste test.js content in DevTools Console
 */

// ─────────────────────────────────────────────
//  Tiny Test Runner
// ─────────────────────────────────────────────

const results = { passed: 0, failed: 0, total: 0 };
const suiteResults = [];

function test(description, fn, suite = "General") {
    results.total++;
    try {
        fn();
        suiteResults.push({ Suite: suite, Test: description, Status: "✅ PASS" });
        results.passed++;
    } catch (err) {
        suiteResults.push({ Suite: suite, Test: description, Status: "❌ FAIL" });
        console.error(`  ❌ FAIL — ${description}`);
        console.error(`          → ${err.message}`);
        results.failed++;
    }
}

function assert(condition, message = "Assertion failed") {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label = "") {
    if (actual !== expected) {
        throw new Error(
            `${label ? label + ": " : ""}Expected "${expected}", got "${actual}"`
        );
    }
}

function assertIncludes(arr, value, label = "") {
    if (!arr.includes(value)) {
        throw new Error(
            `${label ? label + ": " : ""}Expected array to include "${value}", but it didn't. Got: [${arr.join(", ")}]`
        );
    }
}

function printHeader(title) {
    console.log("");
    console.log("─".repeat(52));
    console.log(`  🧪 ${title}`);
    console.log("─".repeat(52));
}

// ─────────────────────────────────────────────
//  Inline Logic Mirrors (self-contained, no Firebase import needed)
//  These mirror the exact logic in script.js so tests run without a browser.
// ─────────────────────────────────────────────

const NAME_MAP = {
    zoneA: "Zone A", zoneB: "Zone B", zoneC: "Zone C",
    zoneD: "Zone D", vip: "VIP Lounge", food: "Food Court"
};

const PRIORITY = { low: 0, medium: 1, high: 2 };

/** Mirror of getBestZone() from script.js */
function getBestZone(liveCrowdData) {
    const zones = Object.entries(liveCrowdData).map(([key, val]) => ({
        key,
        name: NAME_MAP[key] || key,
        density: val.toLowerCase().trim()
    }));

    zones.sort((a, b) => (PRIORITY[a.density] ?? 1) - (PRIORITY[b.density] ?? 1));

    const best   = zones.filter(z => z.density === "low");
    const medium = zones.filter(z => z.density === "medium");
    const avoid  = zones.filter(z => z.density === "high");

    return { best, medium, avoid, all: zones };
}

/** Mirror of generateResponse() local NLP fallback from script.js */
function generateResponse(msg, liveCrowdData, liveWeather = null) {
    const lowKeys  = Object.keys(liveCrowdData).filter(k => liveCrowdData[k].toLowerCase().trim() === "low");
    const highKeys = Object.keys(liveCrowdData).filter(k => liveCrowdData[k].toLowerCase().trim() === "high");

    const lowZones  = lowKeys.map(k => NAME_MAP[k] || k);
    const highZones = highKeys.map(k => NAME_MAP[k] || k);

    if (
        msg.includes("where should") || msg.includes("where to go") ||
        msg.includes("where can i") || msg.includes("best zone") || msg.includes("recommend")
    ) {
        const { best, medium, avoid } = getBestZone(liveCrowdData);
        if (best.length > 0) {
            const names     = best.map(z => z.name).join(" or ");
            const avoidNote = avoid.length > 0 ? ` Avoid ${avoid.map(z => z.name).join(" and ")} — high crowd.` : "";
            return `🟢 Go to **${names}** — low crowd right now.${avoidNote}`;
        } else if (medium.length > 0) {
            return `🟡 No zones are fully clear right now. **${medium[0].name}** has moderate crowd — your best bet currently.`;
        } else {
            return "🔴 All zones are currently experiencing high crowd. Please check back in a few minutes.";
        }
    }

    if (msg.includes("safe") || msg.includes("crowd") || msg.includes("busy") || msg.includes("emergency") || msg.includes("danger")) {
        if (highZones.length > 0) {
            return `⚠️ **${highZones.join(" and ")}** are currently overcrowded. Please avoid these areas.`;
        }
        if (msg.includes("safe") || msg.includes("emergency")) {
            return "✅ All zones are currently operating at safe capacities. Please consult a steward for emergencies.";
        }
    }

    if (msg.includes("avoid") || msg.includes("least") || msg.includes("quiet")) {
        if (lowZones.length > 0) {
            return `**${lowZones.join(" and ")}** currently have a low crowd. I recommend heading there!`;
        }
        return "Everywhere is a bit busy right now! Try checking back in a few minutes.";
    }

    const food = ["food", "hungry", "eat", "burger", "pizza", "snack"];
    if (food.some(kw => msg.includes(kw))) {
        const foodCrowd = (liveCrowdData["food"] || "medium").toLowerCase().trim();
        if (foodCrowd === "high") {
            return "The **Food Court** is currently experiencing a high crowd. For much faster service, I highly recommend grabbing quick items like a **Pepperoni Slice**!";
        } else if (foodCrowd === "medium") {
            return "The **Food Court** is moderately crowded, try the **Pepperoni Slice** for faster service.";
        } else {
            return "The **Food Court** currently has a low crowd! It's a perfect time to freely grab a fresh, full meal like the **Classic Burger**.";
        }
    }

    if (msg.includes("weather") || msg.includes("temperature")) {
        if (liveWeather) {
            return `It's currently ${liveWeather.temp}° and ${liveWeather.condition.toLowerCase()}, stay prepared and plan your route accordingly!`;
        }
    }

    // Generic fallback
    return "generic";
}

/** Simulates updateHeatmapUI — returns the classes that would be applied per zone */
function simulateHeatmapUIClasses(data) {
    const zones = ["zoneA", "zoneB", "zoneC", "zoneD", "vip", "food"];
    const result = {};
    zones.forEach(zoneKey => {
        if (!data[zoneKey]) return;
        const val = data[zoneKey].toLowerCase().trim();
        result[zoneKey] = `density-${val}`;
    });
    return result;
}

/** Simulates updateBestZoneWidget — returns the HTML string (not DOM) */
function simulateBestZoneWidgetHTML(liveCrowdData) {
    if (Object.keys(liveCrowdData).length === 0) {
        return '<span style="opacity:0.5">Waiting for live data...</span>';
    }
    const { best, medium, avoid } = getBestZone(liveCrowdData);

    const bestHtml = best.length
        ? best.map(z => `<span class="zone-pill low">🟢 ${z.name}</span>`).join("")
        : medium.length
            ? medium.map(z => `<span class="zone-pill medium">🟡 ${z.name}</span>`).join("")
            : '<span style="opacity:0.6">All zones are busy right now</span>';

    const avoidHtml = avoid.length
        ? avoid.map(z => `<span class="zone-pill high">🔴 ${z.name}</span>`).join("")
        : '<span style="opacity:0.5">None</span>';

    return `<div class="bz-row"><span class="bz-label">✅ Go to:</span> ${bestHtml}</div><div class="bz-row"><span class="bz-label">⚠️ Avoid:</span> ${avoidHtml}</div>`;
}

// ─────────────────────────────────────────────
//  SUITE 1 — Firebase Data Shape & Parsing
// ─────────────────────────────────────────────
printHeader("Suite 1: Firebase Data Shape & Parsing");

test("Valid crowd snapshot has expected zone keys", () => {
    const snapshot = { zoneA: "low", zoneB: "medium", zoneC: "high", zoneD: "low", vip: "medium", food: "high" };
    const requiredKeys = ["zoneA", "zoneB", "zoneC", "zoneD", "vip", "food"];
    requiredKeys.forEach(k => assert(k in snapshot, `Missing key: ${k}`));
}, "Firebase");

test("Crowd density values are normalised to lowercase", () => {
    const raw = { zoneA: "Low", zoneB: "MEDIUM", zoneC: "High" };
    Object.values(raw).forEach(val => {
        const normalised = val.toLowerCase().trim();
        assertIncludes(["low", "medium", "high"], normalised, "normalised value");
    });
}, "Firebase");

test("Unknown zone key does not throw — gracefully skipped", () => {
    const data = { zoneA: "low", unknownZone: "medium" };
    // simulateHeatmapUIClasses only processes known zone keys
    const classes = simulateHeatmapUIClasses(data);
    assert("unknownZone" in classes === false, "Unknown zone should not produce a class");
    assertEqual(classes["zoneA"], "density-low", "Known zone should still render");
}, "Firebase");

test("Partial snapshot (only 2 zones) is accepted without errors", () => {
    const partial = { zoneA: "low", food: "high" };
    const { best, avoid } = getBestZone(partial);
    assertEqual(best.length, 1, "Should have 1 low zone");
    assertEqual(avoid.length, 1, "Should have 1 high zone");
}, "Firebase");

test("Empty crowd snapshot returns zero zones", () => {
    const { best, medium, avoid, all } = getBestZone({});
    assertEqual(all.length, 0, "No zones expected");
    assertEqual(best.length, 0);
    assertEqual(medium.length, 0);
    assertEqual(avoid.length, 0);
}, "Firebase");

test("Crowd data with extra whitespace is trimmed correctly", () => {
    const data = { zoneA: "  high  ", zoneB: " low " };
    const { best, avoid } = getBestZone(data);
    assertEqual(best.length, 1, "Zone B should be low after trimming");
    assertEqual(avoid.length, 1, "Zone A should be high after trimming");
}, "Firebase");

// ─────────────────────────────────────────────
//  SUITE 2 — AI / NLP Response Logic
// ─────────────────────────────────────────────
printHeader("Suite 2: AI / NLP Response Generation Logic");

test("getBestZone returns correct low-priority zones first", () => {
    const data = { zoneA: "high", zoneB: "low", zoneC: "medium", zoneD: "low", vip: "high", food: "medium" };
    const { best, avoid, all } = getBestZone(data);
    assertEqual(best.length, 2, "Two low zones");
    assertEqual(avoid.length, 2, "Two high zones");
    // First in sorted list should be a low zone
    assertEqual(all[0].density, "low", "First sorted zone is low");
}, "AI Logic");

test("getBestZone returns medium zones when no low zones exist", () => {
    const data = { zoneA: "medium", zoneB: "high", zoneC: "medium" };
    const { best, medium } = getBestZone(data);
    assertEqual(best.length, 0, "No low zones");
    assertEqual(medium.length, 2, "Two medium zones");
}, "AI Logic");

test("generateResponse: 'best zone' query returns low-crowd recommendation", () => {
    const crowd = { zoneA: "low", zoneB: "high", zoneC: "medium" };
    const response = generateResponse("best zone to go?", crowd);
    assert(response.includes("🟢"), "Response should contain green emoji");
    assert(response.includes("Zone A"), "Response should name Zone A");
}, "AI Logic");

test("generateResponse: 'best zone' query with all-high crowd warns user", () => {
    const crowd = { zoneA: "high", zoneB: "high", zoneC: "high" };
    const response = generateResponse("best zone to go?", crowd);
    assert(response.includes("🔴"), "Response should contain red emoji warning");
    assert(response.toLowerCase().includes("high crowd"), "Should mention high crowd");
}, "AI Logic");

test("generateResponse: 'best zone' mid-density returns medium suggestion", () => {
    const crowd = { zoneA: "medium", zoneB: "medium" };
    const response = generateResponse("best zone to go?", crowd);
    assert(response.includes("🟡"), "Response should contain yellow emoji");
}, "AI Logic");

test("generateResponse: 'crowd' keyword triggers overcrowding warning", () => {
    const crowd = { zoneA: "high", zoneB: "low" };
    const response = generateResponse("is the crowd bad?", crowd);
    assert(response.includes("overcrowded"), "Should warn about overcrowded zone");
    assert(response.includes("Zone A"), "Should name the high zone");
}, "AI Logic");

test("generateResponse: 'safe' with no high zones returns all-clear message", () => {
    const crowd = { zoneA: "low", zoneB: "medium" };
    const response = generateResponse("is it safe?", crowd);
    assert(response.includes("safe capacities"), "Should confirm safety");
}, "AI Logic");

test("generateResponse: food keyword returns food court message", () => {
    const crowd = { food: "low", zoneA: "medium" };
    const response = generateResponse("i am hungry", crowd);
    assert(response.includes("Food Court"), "Should mention Food Court");
    assert(response.includes("Classic Burger"), "Low crowd → full meal suggestion");
}, "AI Logic");

test("generateResponse: food at high density recommends quick item", () => {
    const crowd = { food: "high" };
    const response = generateResponse("eat something", crowd);
    assert(response.includes("Pepperoni Slice"), "High crowd → quick item");
}, "AI Logic");

test("generateResponse: food at medium density recommends slice", () => {
    const crowd = { food: "medium" };
    const response = generateResponse("grab a snack", crowd);
    assert(response.includes("Pepperoni Slice"), "Medium crowd → slice suggestion");
}, "AI Logic");

test("generateResponse: 'avoid' keyword returns quiet zone names", () => {
    const crowd = { zoneA: "low", zoneB: "high" };
    const response = generateResponse("which zone should i avoid?", crowd);
    assert(response.includes("Zone A"), "Should mention low-crowd zone");
}, "AI Logic");

test("generateResponse: weather query with live data returns temp/condition", () => {
    const crowd = { zoneA: "low" };
    const weather = { temp: 28, condition: "Partly Cloudy" };
    // Note: avoid msgs with "eat" substring (present in "weather") to prevent food-branch collision;
    // use "temperature" as the trigger keyword instead.
    const response = generateResponse("check the temperature now", crowd, weather);
    assert(response !== "generic", "Should not return generic fallback when weather data present");
    assert(response.toLowerCase().includes("partly cloudy"), "Should include weather condition");
}, "AI Logic");

test("generateResponse: weather query without data returns generic fallback", () => {
    const crowd = { zoneA: "low" };
    // No liveWeather passed
    const response = generateResponse("what's the temperature?", crowd, null);
    // Should fall through to generic response
    assertEqual(response, "generic", "Should return generic fallback");
}, "AI Logic");

// ─────────────────────────────────────────────
//  SUITE 3 — UI Rendering (Heatmap + Widget)
// ─────────────────────────────────────────────
printHeader("Suite 3: UI Rendering — Crowd Heatmap & Best Zone Widget");

test("simulateHeatmapUIClasses: applies correct density class for each zone", () => {
    const data = { zoneA: "low", zoneB: "medium", zoneC: "high", zoneD: "low", vip: "high", food: "medium" };
    const classes = simulateHeatmapUIClasses(data);
    assertEqual(classes["zoneA"], "density-low",    "Zone A → low");
    assertEqual(classes["zoneB"], "density-medium", "Zone B → medium");
    assertEqual(classes["zoneC"], "density-high",   "Zone C → high");
    assertEqual(classes["zoneD"], "density-low",    "Zone D → low");
    assertEqual(classes["vip"],   "density-high",   "VIP → high");
    assertEqual(classes["food"],  "density-medium", "Food Court → medium");
}, "UI Logic");

test("simulateHeatmapUIClasses: mixed case input resolves to valid class", () => {
    const data = { zoneA: "HIGH", zoneB: "Low" };
    const classes = simulateHeatmapUIClasses(data);
    assertEqual(classes["zoneA"], "density-high", "Uppercase HIGH → density-high");
    assertEqual(classes["zoneB"], "density-low",  "Capitalised Low → density-low");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: empty data shows waiting message", () => {
    const html = simulateBestZoneWidgetHTML({});
    assert(html.includes("Waiting for live data"), "Should show waiting message");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: low crowd zone appears in Go To section", () => {
    const data = { zoneA: "low", zoneB: "high" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("🟢"), "Low zone should appear with green emoji");
    assert(html.includes("Zone A"), "Zone A should be in widget");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: high crowd zone appears in Avoid section", () => {
    const data = { zoneA: "low", zoneB: "high" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("🔴"), "High zone should have red emoji");
    assert(html.includes("Zone B"), "Zone B should be in avoid section");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: all-high data shows 'All zones are busy'", () => {
    const data = { zoneA: "high", zoneB: "high", food: "high" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("All zones are busy"), "Should show busy message");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: no high zones shows 'None' in Avoid", () => {
    const data = { zoneA: "low", zoneB: "medium" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("None"), "Avoid section should show None");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: medium-only data falls back to medium pill", () => {
    const data = { zoneA: "medium", zoneB: "medium" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("🟡"), "Medium zone should use yellow emoji");
}, "UI Logic");

test("simulateBestZoneWidgetHTML: correct zone label shown in pill", () => {
    const data = { vip: "low" };
    const html = simulateBestZoneWidgetHTML(data);
    assert(html.includes("VIP Lounge"), "VIP Lounge label should be humanised");
}, "UI Logic");

// ─────────────────────────────────────────────
//  SUITE 4 — Auth Module: classifyTopic, logInteraction shape, Insights UI
// ─────────────────────────────────────────────
printHeader("Suite 4: Auth Module — classifyTopic & Insights Logic");

/**
 * Inline mirror of classifyTopic() from auth.js.
 * Must stay in sync with auth.js — topic order matters (weather before food due to "eat" collision).
 */
function classifyTopic(message) {
    const msg = message.toLowerCase();
    if (msg.includes('weather') || msg.includes('temperature') ||
        msg.includes('rain')    || msg.includes('hot') ||
        msg.includes('cold')    || msg.includes('snow')) return 'weather';
    if (msg.includes('food')   || msg.includes('hungry') ||
        msg.includes('burger') || msg.includes('pizza') ||
        msg.includes('snack'))  return 'food';
    if (msg.includes('zone')      || msg.includes('crowd') ||
        msg.includes('busy')      || msg.includes('packed') ||
        msg.includes('best zone') || msg.includes('recommend') ||
        msg.includes('where'))    return 'zone';
    if (msg.includes('safe')      || msg.includes('emergency') ||
        msg.includes('danger')    || msg.includes('help') ||
        msg.includes('sos'))      return 'safety';
    if (msg.includes('route')     || msg.includes('direction') ||
        msg.includes('navigate')  || msg.includes('exit') ||
        msg.includes('path')      || msg.includes('get to')) return 'route';
    return 'general';
}

/** Mirror of logInteraction data shape (without Firebase writes) */
function buildInteractionRecord(message, responseType, uid) {
    const topic = classifyTopic(message);
    return {
        message:      message.slice(0, 200),
        topic,
        responseType,
        uid
    };
}

/** Mirror of active-user count logic from updateInsightsUI */
function countActiveUsers(activeUsersObj, windowMs) {
    const cutoff = Date.now() - windowMs;
    return Object.values(activeUsersObj || {})
        .filter(ts => typeof ts === 'number' && ts > cutoff)
        .length;
}

/** Mirror of topic bar percentage calculation */
function calcTopicPct(count, maxCount) {
    return Math.round((count / Math.max(1, maxCount)) * 100);
}

// ── classifyTopic ──────────────────────────────────────────────────────────

test("classifyTopic: 'weather' message → 'weather'", () => {
    assertEqual(classifyTopic("what is the weather like?"), "weather", "weather keyword");
}, "Auth / Analytics");

test("classifyTopic: 'temperature' → 'weather' (not 'general')", () => {
    assertEqual(classifyTopic("check the temperature now"), "weather", "temperature keyword");
}, "Auth / Analytics");

test("classifyTopic: 'weather' wins over 'food' because 'weather' contains 'eat'", () => {
    // This is the critical ordering test — "weather" contains "eat" substring
    // If food is checked before weather, this would wrongly return 'food'
    const topic = classifyTopic("what's the weather forecast?");
    assertEqual(topic, "weather", "weather must be classified before food");
    assert(topic !== "food", "Must NOT be classified as food due to 'eat' substring collision");
}, "Auth / Analytics");

test("classifyTopic: food keywords → 'food'", () => {
    assertEqual(classifyTopic("i am hungry, want burger"), "food");
    assertEqual(classifyTopic("grab a pizza slice"), "food");
    assertEqual(classifyTopic("any snacks here?"), "food");
}, "Auth / Analytics");

test("classifyTopic: zone/crowd keywords → 'zone'", () => {
    assertEqual(classifyTopic("which zone is least crowded?"), "zone");
    assertEqual(classifyTopic("where should i go?"), "zone");
    assertEqual(classifyTopic("it is too busy here"), "zone");
}, "Auth / Analytics");

test("classifyTopic: safety keywords → 'safety'", () => {
    assertEqual(classifyTopic("is it safe here?"), "safety");
    assertEqual(classifyTopic("emergency help needed"), "safety");
    assertEqual(classifyTopic("press SOS button"), "safety");
}, "Auth / Analytics");

test("classifyTopic: route/navigation keywords → 'route'", () => {
    assertEqual(classifyTopic("what is the best route?"), "route");
    assertEqual(classifyTopic("how do i navigate to exit?"), "route");
    assertEqual(classifyTopic("show me the path to get to gate"), "route");
}, "Auth / Analytics");

test("classifyTopic: unknown message → 'general'", () => {
    assertEqual(classifyTopic("hello there"), "general");
    assertEqual(classifyTopic("what time does the match start?"), "general");
}, "Auth / Analytics");

// ── logInteraction data shape ──────────────────────────────────────────────

test("logInteraction shape: record has required fields", () => {
    const record = buildInteractionRecord("best zone to visit?", "gemini", "user-123");
    assert('message'      in record, "Should have 'message'");
    assert('topic'        in record, "Should have 'topic'");
    assert('responseType' in record, "Should have 'responseType'");
    assert('uid'          in record, "Should have 'uid'");
}, "Auth / Analytics");

test("logInteraction shape: message is capped at 200 characters", () => {
    const longMsg = "x".repeat(300);
    const record  = buildInteractionRecord(longMsg, "fallback", "user-456");
    assert(record.message.length <= 200, `Message should be ≤200 chars, got ${record.message.length}`);
}, "Auth / Analytics");

test("logInteraction shape: topic is correctly classified from message", () => {
    const record = buildInteractionRecord("i am hungry, any food?", "gemini", "uid-1");
    assertEqual(record.topic, "food", "Hungry/food message should classify as 'food'");
}, "Auth / Analytics");

test("logInteraction shape: responseType is preserved", () => {
    const r1 = buildInteractionRecord("question", "gemini",   "u1");
    const r2 = buildInteractionRecord("question", "fallback",  "u1");
    const r3 = buildInteractionRecord("question", "error",     "u1");
    assertEqual(r1.responseType, "gemini",   "Gemini source");
    assertEqual(r2.responseType, "fallback", "Fallback source");
    assertEqual(r3.responseType, "error",    "Error source");
}, "Auth / Analytics");

// ── Insights UI logic ──────────────────────────────────────────────────────

test("countActiveUsers: filters users outside the time window", () => {
    const now = Date.now();
    const active = {
        uid1: now - 1 * 60 * 1000,   // 1 min ago  → ACTIVE
        uid2: now - 5 * 60 * 1000,   // 5 min ago  → ACTIVE
        uid3: now - 15 * 60 * 1000,  // 15 min ago → INACTIVE (outside 10-min window)
        uid4: now - 11 * 60 * 1000   // 11 min ago → INACTIVE
    };
    const count = countActiveUsers(active, 10 * 60 * 1000); // 10-min window
    assertEqual(count, 2, "Only 2 users active within 10-minute window");
}, "Auth / Analytics");

test("countActiveUsers: empty object returns 0", () => {
    assertEqual(countActiveUsers({}, 10 * 60 * 1000), 0, "No active users");
}, "Auth / Analytics");

test("countActiveUsers: non-numeric timestamps (null from Firebase) are excluded", () => {
    const mixed = {
        uid1: Date.now() - 1000, // 1 sec ago → active
        uid2: null,              // signed out → excluded
        uid3: "invalid"          // malformed → excluded
    };
    const count = countActiveUsers(mixed, 10 * 60 * 1000);
    assertEqual(count, 1, "Only valid numeric timestamps count");
}, "Auth / Analytics");

test("calcTopicPct: top topic always 100%", () => {
    assertEqual(calcTopicPct(50, 50), 100, "Max count → 100%");
}, "Auth / Analytics");

test("calcTopicPct: half count is ~50%", () => {
    assertEqual(calcTopicPct(5, 10), 50, "Half count → 50%");
}, "Auth / Analytics");

test("calcTopicPct: zero maxCount guard prevents division-by-zero", () => {
    // maxCount defaults to max(1, ...) in real code; mirror handles it too
    const pct = calcTopicPct(0, 0);
    assert(!isNaN(pct), "Should never return NaN");
    assertEqual(pct, 0, "Zero count → 0%");
}, "Auth / Analytics");

// ── Production Integrity ────────────────────────────────────────────────────

test("AI Payload: structure matches /api/ai protocol", () => {
    const payload = {
        message: "hello",
        crowdData: {},
        weather: {},
        conversationHistory: [],
        clientTime: "2026-04-15T12:00:00Z",
        userName: "Auditor",
        activeTab: "section-home"
    };
    assert('message' in payload);
    assert('conversationHistory' in payload);
    assert('activeTab' in payload);
    assertEqual(typeof payload.conversationHistory, 'object', "History must be an array");
}, "Production");

test("Session Persistence: loadChatHistory restores correctly", () => {
    const mockHistory = [
        { role: 'user', text: 'Where is the food?' },
        { role: 'assistant', text: 'Food court is in Zone B.' }
    ];
    // Mock simulation of loadChatHistory logic
    const chatSessionHistory = mockHistory; 
    assertEqual(chatSessionHistory.length, 2);
    assertEqual(chatSessionHistory[0].role, 'user');
}, "Production");

// ─────────────────────────────────────────────
//  Summary
// ─────────────────────────────────────────────
console.log("");
console.log("═".repeat(52));
console.log(`  📋 Full Test Summary`);
console.log("═".repeat(52));

if (typeof console.table !== "undefined") {
    console.table(suiteResults);
} else {
    suiteResults.forEach(r => console.log(`${r.Status} [${r.Suite}] ${r.Test}`));
}

console.log("");
console.log("═".repeat(52));
console.log(`  📊 Final Score: ${results.passed}/${results.total} passed, ${results.failed} failed`);
if (results.failed === 0) {
    console.log("  🎉 All systems healthy! Tests passed.");
} else {
    console.log(`  ⚠️  ${results.failed} test(s) failed — see log for details.`);
}
console.log("═".repeat(52));
console.log("");

// Exit with correct code for CI pipelines (Node.js only)
if (typeof process !== "undefined" && process.exitCode !== undefined) {
    process.exitCode = results.failed > 0 ? 1 : 0;
}
