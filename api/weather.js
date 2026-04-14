export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { lat, lon } = req.query;
    const apiKey = process.env.WEATHER_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Weather API key not configured' });
    }

    if (!lat || !lon) {
        return res.status(400).json({ error: 'lat and lon query params are required' });
    }

    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            return res.status(response.status).json({ error: `OpenWeather error: ${response.statusText}` });
        }

        const data = await response.json();
        const temp = Math.round(data.main.temp);
        const condition = data.weather[0].main;

        return res.json({ temp, condition });
    } catch (err) {
        console.error('Weather handler error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
