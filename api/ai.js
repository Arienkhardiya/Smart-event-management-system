export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, crowdData, weather } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // Build crowd context string from Firebase data
    const crowdLines = crowdData && typeof crowdData === 'object'
        ? Object.entries(crowdData)
            .map(([zone, level]) => `${zone}: ${level}`)
            .join(', ')
        : 'No crowd data available';

    const weatherLine = (weather && weather.temp)
        ? `Current weather: ${weather.temp}°F, ${weather.condition}.`
        : '';

    const prompt = `You are a smart, friendly assistant for a live stadium event. Keep responses concise (1-3 sentences max).

Live stadium crowd levels: ${crowdLines}.
${weatherLine}

User question: "${message}"

Answer helpfully using the crowd data above. If a zone is "high", warn the user. If "low", recommend it.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 200, temperature: 0.7 }
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
