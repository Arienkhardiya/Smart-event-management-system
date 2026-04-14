const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


// POST /api/chat - Gemini API Backend Proxy
app.post('/api/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
            return res.status(500).json({ error: "Gemini API key not configured on server" });
        }

        // Using gemini-2.5-flash because 1.5-flash is officially deactivated and throwing 404s natively
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `You are the Smart Event Assistant for an ongoing stadium event. Keep answers concise, friendly, and brief (1-3 sentences). Here is the real-time crowd data for the stadium zones: ${context}. Answer the following user query intelligently using this data: "${message}"`
                    }]
                }]
            })
        });

        if (!response.ok) {
            console.error("Gemini Fetch failed:", response.status, response.statusText);
            return res.status(500).json({ error: `Gemini API error: ${response.statusText}` });
        }

        const data = await response.json();
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            const botReply = data.candidates[0].content.parts[0].text.trim();
            return res.json({ reply: botReply });
        }

        res.status(500).json({ error: "Invalid API response format from Gemini" });
    } catch (error) {
        console.error("Chat API Proxy Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET /api/weather - OpenWeather API Backend Proxy
app.get('/api/weather', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const apiKey = process.env.WEATHER_API_KEY;

        if (!apiKey || apiKey === "YOUR_OPENWEATHER_API_KEY_HERE") {
            return res.status(500).json({ error: "Weather API key not configured on server" });
        }

        if (!lat || !lon) {
            return res.status(400).json({ error: "Latitude and Longitude are required" });
        }

        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            return res.status(response.status).json({ error: `OpenWeather API error: ${response.statusText}` });
        }

        const data = await response.json();
        const temp = Math.round(data.main.temp);
        const condition = data.weather[0].main;

        res.json({ temp, condition });
    } catch (error) {
        console.error("Weather API Proxy Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running! Access the application at http://localhost:${PORT}`);
});
