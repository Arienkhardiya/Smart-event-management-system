export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, crowdData, weather, conversationHistory = [], clientTime } = req.body;

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

    // ── System prompt ─────────────────────────────────────────────────────────
    const systemPrompt = `You are ARIA — a smart, warm, real-time AI assistant for Championship Finals 2026 at the stadium.

You have LIVE data. Always use it. Never give generic, static, or vague answers.

=== LIVE STADIUM DATA ===
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
2. Give DIFFERENT advice from the conversation history above — never repeat the same sentence.
3. End with ONE short proactive suggestion (e.g., "Want directions there?" or "Shall I check the food court wait?").
4. Keep responses to 2-4 sentences maximum. Be friendly and direct.
5. Use 1-2 emojis per response — no more.
6. If all zones are congested, be honest about it and suggest the least-bad option plus a wait time estimate.
7. Factor in the current time: ${timeContext}. Adjust urgency accordingly.
8. If weather is relevant, mention it naturally — don't force it.
9. Skip filler phrases like "Certainly!", "Of course!", "Great question!" — answer immediately.
10. Reference the previous conversation turns to sound coherent and not repeat yourself.

User question: "${message}"`;

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

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            return res.status(500).json({ error: errBody.error?.message || `Gemini error ${response.status}` });
        }

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!reply) {
            return res.status(500).json({ error: 'Empty response from Gemini' });
        }

        return res.json({ reply });

    } catch (err) {
        console.error('API handler error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
