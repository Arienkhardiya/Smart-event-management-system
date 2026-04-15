export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
        message, crowdData, weather, conversationHistory = [],
        clientTime, userName, activeTab
    } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // ── Zone Name Mapping ────────────────────────────────────────────────────
    const ZONE_NAMES = {
        zoneA: 'Zone A (North Stand)',
        zoneB: 'Zone B (East Stand)',
        zoneC: 'Zone C (South Stand)',
        zoneD: 'Zone D (West Stand)',
        vip:   'VIP Lounge',
        food:  'Food Court'
    };

    // ── Stadium Event Schedule ───────────────────────────────────────────────
    const STADIUM_SCHEDULE = [
        { time: '10:00', event: 'Gates Open',       vibe: 'Relaxed' },
        { time: '14:30', event: 'Opening Ceremony', vibe: 'Excited' },
        { time: '15:00', event: 'Kick-off',         vibe: 'Peak Intensity' },
        { time: '15:45', event: 'Half-time',        vibe: 'Social/Transition' },
        { time: '16:00', event: 'Second Half',      vibe: 'High Focus' },
        { time: '16:45', event: 'Full-time',        vibe: 'Exiting/Winding Down' }
    ];

    // ── Calculate Schedule Context ────────────────────────────────────────────
    let scheduleStatus = 'No major events currently scheduled.';
    let stadiumVibe    = 'Normal';
    try {
        const now = clientTime ? new Date(clientTime) : new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();

        // Find current/next event
        let activeEvent = STADIUM_SCHEDULE[0];
        for (const ev of STADIUM_SCHEDULE) {
            const [h, m] = ev.time.split(':').map(Number);
            const evMins = h * 60 + m;
            if (currentMins >= evMins) {
                activeEvent = ev;
            }
        }
        stadiumVibe = activeEvent.vibe;

        // Find next event for timing advice
        const nextEvent = STADIUM_SCHEDULE.find(ev => {
            const [h, m] = ev.time.split(':').map(Number);
            return (h * 60 + m) > currentMins;
        });

        if (nextEvent) {
            const [h, m] = nextEvent.time.split(':').map(Number);
            const diff = (h * 60 + m) - currentMins;
            scheduleStatus = `The next event is **${nextEvent.event}** in **${diff} minutes** (${nextEvent.time}).`;
        } else {
            scheduleStatus = 'The main event has concluded. Stadium is winding down.';
        }
    } catch (_) {}

    // ── Build rich crowd context ──────────────────────────────────────────────
    let crowdSummary = 'No live crowd data available.';
    const recommendedZones = [];
    const congestedZones = [];
    const moderateZones = [];

    if (crowdData && typeof crowdData === 'object' && Object.keys(crowdData).length > 0) {
        const zoneLines = Object.entries(crowdData).map(([key, level]) => {
            const name = ZONE_NAMES[key] || key;
            const lvl  = (level || 'unknown').toLowerCase().trim();
            if (lvl === 'low')    recommendedZones.push(name);
            if (lvl === 'high')   congestedZones.push(name);
            if (lvl === 'medium') moderateZones.push(name);
            const emoji = lvl === 'low' ? '🟢' : lvl === 'high' ? '🔴' : '🟡';
            return `  ${emoji} ${name}: ${lvl} crowd`;
        });
        crowdSummary = zoneLines.join('\n');
    }

    // ── Time-of-day context ───────────────────────────────────────────────────
    let timeContext = '';
    try {
        const now = clientTime ? new Date(clientTime) : new Date();
        const hour = now.getHours();
        if      (hour < 11) timeContext = 'early morning — gates just opened, light crowds expected';
        else if (hour < 13) timeContext = 'late morning — pre-match build-up, crowds arriving';
        else if (hour < 15) timeContext = 'early afternoon — match warming up, moderate density';
        else if (hour < 18) timeContext = 'afternoon — peak event hours, expect high crowd everywhere';
        else if (hour < 20) timeContext = 'evening — match in progress, zones near exits getting busy';
        else if (hour < 22) timeContext = 'late evening — post-match, exits and food court very crowded';
        else                timeContext = 'night — stadium winding down, most zones clearing out';
    } catch (_) { /* ignore bad clientTime */ }

    // ── Weather context ───────────────────────────────────────────────────────
    let weatherContext = '';
    if (weather && weather.temp != null && !weather.error) {
        weatherContext = `Current weather: ${weather.temp}°C, ${weather.condition}.`;
        const cond = (weather.condition || '').toLowerCase();
        if (cond.includes('rain') || cond.includes('storm') || cond.includes('drizzle')) {
            weatherContext += ' Covered areas are recommended.';
        } else if (weather.temp > 35) {
            weatherContext += ' Very hot — advise shade and hydration.';
        } else if (weather.temp < 10) {
            weatherContext += ' It is cold — suggest warm, covered areas.';
        }
    }

    // ── Conversation history (last 4 turns for context continuity) ───────────
    const recentHistory = Array.isArray(conversationHistory)
        ? conversationHistory.slice(-4)
        : [];
    const historyBlock = recentHistory.length > 0
        ? '\n\nRecent conversation (for context — do NOT repeat the same advice):\n' +
          recentHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')
        : '';

    // ── Tab Context ──────────────────────────────────────────────────────────
    const TAB_CONTEXTS = {
        'section-home':      'the Home page (event details and schedule)',
        'section-map':       'the Map section (crowd heatmap and navigation)',
        'section-assistant': 'the AI Assistant chat interface',
        'section-food':      'the Food & Drinks menu',
        'section-emergency': 'the Emergency services and safety info'
    };
    const currentView = TAB_CONTEXTS[activeTab] || 'an unknown section';
    const userGreeting = userName ? `The user's name is ${userName}. Greet them personally.` : 'The user is anonymous.';

    // ── System prompt ─────────────────────────────────────────────────────────
    const systemPrompt = `You are ARIA — a smart, warm, real-time AI assistant for Championship Finals 2026 at the stadium.

You have LIVE data and a LIVE event schedule. Always use both. Never give generic, static, or vague answers.

=== USER CONTEXT ===
${userGreeting}
The user is currently looking at ${currentView}.

=== LIVE STADIUM DATA ===
Event Status: ${scheduleStatus}
Stadium Vibe: ${stadiumVibe}
Time context: ${timeContext}
${weatherContext}

Crowd levels (live from Firebase):
${crowdSummary}

Best zones to visit (low crowd): ${recommendedZones.length > 0 ? recommendedZones.join(', ') : 'None — all zones are moderate or higher'}
Moderate zones: ${moderateZones.length > 0 ? moderateZones.join(', ') : 'None'}
Congested zones to avoid right now: ${congestedZones.length > 0 ? congestedZones.join(', ') : 'None — stadium is clear'}
=========================
${historyBlock}

=== YOUR RULES ===
1. ALWAYS name specific zones from the live data in your response.
2. If the user mentions their name or asks "who am I?", address them as ${userName || 'User'}.
3. Tailor your advice to their current view: ${currentView} AND the current vibe: ${stadiumVibe}.
4. PREDICTIVE LOGIC: Combine Schedule + Crowd + Weather for proactive advice. 
   - If Match is starting soon (< 30 mins) and they aren't at their seat, prioritize seating.
   - If Full-time is near, prioritize "Gate Exits" suggestions based on low-crowd zones.
5. End with ONE short, actionable, proactive suggestion that matches the current stadium timing.
6. Keep responses to 2-4 sentences maximum. Be friendly and direct.
7. Use 1-2 emojis per response — no more.
8. Do NOT repeat or paraphrase the conversation history. Keep the dialogue moving forward.
9. Skip filler phrases like "Certainly!", "Of course!", "Great question!" — answer immediately.

User question: "${message}"`;

    const start = Date.now();
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: {
                        maxOutputTokens: 260,
                        temperature: 0.75,
                        topP: 0.9
                    }
                })
            }
        );

        const latency = Date.now() - start;

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            return res.status(500).json({ error: errBody.error?.message || `Gemini error ${response.status}` });
        }

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!reply) {
            return res.status(500).json({ error: 'Empty response from Gemini' });
        }

        // ── Real-time Backend Telemetry ─────────────────────────────────────────
        // Log telemetry asynchronously (don't block the client response)
        const dbUrl = process.env.FIREBASE_DB_URL;
        const dbSecret = process.env.FIREBASE_SECRET;
        
        if (dbUrl) {
            const telemetryUrl = `${dbUrl}/ai_usage/events.json${dbSecret ? `?auth=${dbSecret}` : ''}`;
            const summaryUrl   = `${dbUrl}/ai_usage/summary.json${dbSecret ? `?auth=${dbSecret}` : ''}`;

            // 1. Log the event
            fetch(telemetryUrl, {
                method: 'POST',
                body: JSON.stringify({
                    t: Date.now(),
                    l: latency,
                    q: message.substring(0, 100), // Truncate for privacy/storage
                    m: 'gemini-2.0-flash',
                    u: userName || 'anonymous'
                })
            }).catch(() => {});

            // 2. Patch the summary (atomic-like increment via REST)
            // Note: In production we'd use a cloud function, but for a demo REST PATCH works
            fetch(summaryUrl, {
                method: 'PATCH',
                body: JSON.stringify({
                    last_latency: latency,
                    last_update: Date.now()
                })
            }).catch(() => {});
        }

        return res.json({ reply, latency });

    } catch (err) {
        console.error('API handler error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
