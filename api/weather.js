export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.WEATHER_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Weather API key not configured on server' });
    }

    const { lat, lon, city } = req.query;

    // Build the OpenWeather URL — support either city name or coordinates
    let weatherUrl;
    if (city) {
        weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`;
    } else if (lat && lon) {
        weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
    } else {
        return res.status(400).json({ error: 'Provide either "city" or "lat" and "lon" query params' });
    }

    try {
        const response = await fetch(weatherUrl);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            return res.status(response.status).json({
                error: errData.message || `OpenWeather API error: ${response.statusText}`
            });
        }

        const data = await response.json();

        const temp = Math.round(data.main.temp);           // °C (metric)
        const feelsLike = Math.round(data.main.feels_like);
        const humidity = data.main.humidity;
        const condition = data.weather[0].main;            // e.g. "Clear", "Rain"
        const description = data.weather[0].description;  // e.g. "light rain"
        const cityName = data.name;
        const country = data.sys.country;
        const windSpeed = Math.round(data.wind.speed);    // m/s

        return res.json({ temp, feelsLike, humidity, condition, description, city: cityName, country, windSpeed });
    } catch (err) {
        console.error('Weather handler error:', err);
        return res.status(500).json({ error: 'Internal server error fetching weather' });
    }
}
