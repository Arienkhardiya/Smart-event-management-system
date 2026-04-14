// script.js - Smart Event Assistant Navigation & Logic

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxb_6lMmoA7E4j7Ogp0Ut6K0SD9A1AJl8",
    authDomain: "sems-b1830.firebaseapp.com",
    databaseURL: "https://sems-b1830-default-rtdb.firebaseio.com",
    projectId: "sems-b1830",
    storageBucket: "sems-b1830.firebasestorage.app",
    messagingSenderId: "929556440297",
    appId: "1:929556440297:web:66826169d69f197c3fbc78",
    measurementId: "G-KEBQ8PPB7W"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let liveCrowdData = {};
let liveWeather = null;

/**
 * Returns the best zones to visit based on live Firebase crowd density.
 * Priority: low > medium > high
 * Returns an object: { best: [{key, name, density}], avoid: [{key, name, density}] }
 */
function getBestZone() {
    const nameMap = {
        zoneA: 'Zone A', zoneB: 'Zone B', zoneC: 'Zone C',
        zoneD: 'Zone D', vip: 'VIP Lounge', food: 'Food Court'
    };
    const priority = { low: 0, medium: 1, high: 2 };

    const zones = Object.entries(liveCrowdData).map(([key, val]) => ({
        key,
        name: nameMap[key] || key,
        density: val.toLowerCase().trim()
    }));

    zones.sort((a, b) => (priority[a.density] ?? 1) - (priority[b.density] ?? 1));

    const best = zones.filter(z => z.density === 'low');
    const medium = zones.filter(z => z.density === 'medium');
    const avoid = zones.filter(z => z.density === 'high');

    return { best, medium, avoid, all: zones };
}

/**
 * Updates the #best-zone-widget DOM element if it exists on the page.
 */
function updateBestZoneWidget() {
    const widget = document.getElementById('best-zone-widget');
    if (!widget) return;

    if (Object.keys(liveCrowdData).length === 0) {
        widget.innerHTML = '<span style="opacity:0.5">Waiting for live data...</span>';
        return;
    }

    const { best, medium, avoid } = getBestZone();

    const bestHtml = best.length
        ? best.map(z => `<span class="zone-pill low">🟢 ${z.name}</span>`).join('')
        : medium.length
            ? medium.map(z => `<span class="zone-pill medium">🟡 ${z.name}</span>`).join('')
            : '<span style="opacity:0.6">All zones are busy right now</span>';

    const avoidHtml = avoid.length
        ? avoid.map(z => `<span class="zone-pill high">🔴 ${z.name}</span>`).join('')
        : '<span style="opacity:0.5">None</span>';

    widget.innerHTML = `
        <div class="bz-row"><span class="bz-label">✅ Go to:</span> ${bestHtml}</div>
        <div class="bz-row"><span class="bz-label">⚠️ Avoid:</span> ${avoidHtml}</div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initChatAI();
    initFilters();
    listenToCrowdData();
    initSmartNav();
    initWeather();
    initSimulator();
});

/**
 * Initializes the bottom navigation tab logic
 */
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewSections = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));

            // Add active class to clicked nav item
            item.classList.add('active');

            // Hide all sections
            viewSections.forEach(section => {
                section.classList.remove('active');
            });

            // Show targeted section
            const targetId = item.getAttribute('data-target');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');

                // If it's the chat section, focus the input
                if (targetId === 'section-assistant') {
                    setTimeout(() => {
                        document.getElementById('chat-input').focus();
                    }, 100);
                }
            }
        });
    });
}

/**
 * Initializes Chat AI interactions
 */
function initChatAI() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const chatHistory = document.getElementById('chat-history');

    const keywords = {
        food: ["food", "hungry", "eat", "burger", "pizza", "snack"],
        washroom: ["washroom", "restroom", "toilet", "bathroom"],
        gateA: ["gate a"],
        route: ["route", "path", "directions", "where is", "how to get", "navigate", "exit"]
    };

    function getSystemContext() {
        const nameMap = {
            'zoneA': 'Zone A',
            'zoneB': 'Zone B',
            'zoneC': 'Zone C',
            'zoneD': 'Zone D',
            'vip': 'VIP Lounge',
            'food': 'Food Court'
        };
        let contextArray = [];
        for (let key in liveCrowdData) {
            let load = liveCrowdData[key].toLowerCase().trim();
            let status = load === "high" ? "High Crowd (Very Busy)" : (load === "low" ? "Low Crowd (Empty)" : "Moderate Crowd");
            contextArray.push(`${nameMap[key] || key} is currently seeing a ${status}`);
        }
        if (liveWeather) {
            contextArray.push(`The current stadium weather is ${liveWeather.temp}° with ${liveWeather.condition}.`);
        }
        return contextArray.length > 0 ? contextArray.join(', ') : "No active crowd data.";
    }

    const processMessageWithGemini = async (message) => {
        // Call /api/ai with live Firebase crowd data + weather as context
        const response = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                crowdData: liveCrowdData,
                weather: liveWeather
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.reply) {
            return data.reply;
        }

        throw new Error("Invalid format received from server");
    };

    const handleSend = async () => {
        const message = chatInput.value.trim();
        if (message === '') return;

        appendMessage(message, 'user');
        chatInput.value = '';

        const typingId = showTypingIndicator();

        try {
            // Attempt Gemini API First, await result
            const response = await processMessageWithGemini(message);
            removeTypingIndicator(typingId);
            appendMessage(response, 'bot');
        } catch (error) {
            // Fallback to local logic if network fails, or key missing
            console.warn("Gemini API skipped/failed, using local fallback NLP.", error.message);

            // Artificial delay to make fallback still feel human
            setTimeout(() => {
                const fallbackResponse = generateResponse(message.toLowerCase());

                // Removed chat cache
                removeTypingIndicator(typingId);
                appendMessage(fallbackResponse, 'bot');
            }, 800);
        }
    };

    sendBtn.addEventListener('click', handleSend);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    function generateResponse(msg) {

        const nameMap = {
            'zoneA': 'Zone A',
            'zoneB': 'Zone B',
            'zoneC': 'Zone C',
            'zoneD': 'Zone D',
            'vip': 'VIP Lounge',
            'food': 'Food Court'
        };

        const lowKeys = Object.keys(liveCrowdData).filter(key => liveCrowdData[key].toLowerCase().trim() === "low");
        const highKeys = Object.keys(liveCrowdData).filter(key => liveCrowdData[key].toLowerCase().trim() === "high");

        const lowZones = lowKeys.map(k => nameMap[k] || k);
        const highZones = highKeys.map(k => nameMap[k] || k);

        // Primary Safety Intercept Block
        if (msg.includes("where should") || msg.includes("where to go") || msg.includes("where can i") || msg.includes("best zone") || msg.includes("recommend")) {
            const { best, medium, avoid } = getBestZone();
            if (best.length > 0) {
                const names = best.map(z => z.name).join(' or ');
                const avoidNote = avoid.length > 0 ? ` Avoid ${avoid.map(z => z.name).join(' and ')} — high crowd.` : '';
                return `🟢 Go to **${names}** — low crowd right now.${avoidNote}`;
            } else if (medium.length > 0) {
                return `🟡 No zones are fully clear right now. **${medium[0].name}** has moderate crowd — your best bet currently.`;
            } else {
                return `🔴 All zones are currently experiencing high crowd. Please check back in a few minutes.`;
            }
        }

        // Primary Safety Intercept Block
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

        if (msg.includes("packed")) {
            if (highZones.length > 0) {
                return `It looks like **${highZones.join(" and ")}** are currently crowded. You might want to avoid those areas.`;
            }
            return "Actually, no areas are currently reporting high crowd levels! Enjoy the event!";
        }

        if (keywords.food.some(kw => msg.includes(kw))) {
            const foodCrowd = (liveCrowdData['food'] || "medium").toLowerCase().trim();
            if (foodCrowd === 'high') {
                return `The **Food Court** is currently experiencing a high crowd. For much faster service, I highly recommend grabbing quick items like a **Pepperoni Slice**!`;
            } else if (foodCrowd === 'medium') {
                return `The **Food Court** is moderately crowded, try the **Pepperoni Slice** for faster service.`;
            } else {
                return `The **Food Court** currently has a low crowd! It's a perfect time to freely grab a fresh, full meal like the **Classic Burger**.`;
            }
        }

        if (keywords.washroom.some(kw => msg.includes(kw))) {
            const vipCrowd = (liveCrowdData['vip'] || "medium").toLowerCase().trim();
            const zoneACrowd = (liveCrowdData['zoneA'] || "medium").toLowerCase().trim();
            return `There are large washrooms located near the **VIP Lounge** (currently a ${vipCrowd} crowd) and **Zone A** (currently a ${zoneACrowd} crowd). Head to the one with less traffic!`;
        }

        function getBestRoute(fromNode, toNode) {
            const routes = {
                gateA: ["zoneA", "zoneB"],
                zoneA: ["zoneC"],
                zoneB: ["zoneD"],
                zoneC: ["food"],
                zoneD: ["food"]
            };

            const weights = { "low": 1, "medium": 5, "high": 1000 };
            let bestPath = null;
            let lowestCost = Infinity;

            function dfs(current, currentPath, currentCost) {
                if (current === toNode) {
                    if (currentCost < lowestCost) {
                        lowestCost = currentCost;
                        bestPath = [...currentPath];
                    }
                    return;
                }
                if (!routes[current]) return;

                for (let next of routes[current]) {
                    if (!currentPath.includes(next)) {
                        let density = (liveCrowdData[next] || "medium").toLowerCase().trim();
                        let cost = weights[density] || 5;
                        dfs(next, [...currentPath, next], currentCost + cost);
                    }
                }
            }
            dfs(fromNode, [fromNode], 0);
            return bestPath;
        }

        if (msg.includes("route") || msg.includes("reach") || msg.includes("direction")) {
            
            let safetyPrefix = "";
            let weatherPrefix = "";
            
            if (liveWeather && !liveWeather.error) {
                weatherPrefix = `It's currently ${liveWeather.temp}° and ${liveWeather.condition.toLowerCase()}. `;
            }
            if (highZones.length > 0) {
                safetyPrefix = `⚠️ **Safety Warning:** ${highZones.join(" and ")} is currently overcrowded, please avoid.\n\n`;
            }

            const bestRoute = getBestRoute("gateA", "food");
            if (bestRoute) {
                const extendedMap = { ...nameMap, gateA: "Gate A" };
                const formattedPath = bestRoute.map(n => {
                    const mappedName = extendedMap[n] || n;
                    // Exclude endpoints from needing the physical density metric printed inside the node path for aesthetic cleanness 
                    if (n !== "gateA" && n !== "food") {
                        const density = (liveCrowdData[n] || "medium").toLowerCase().trim();
                        return `${mappedName} (${density})`;
                    }
                    return mappedName;
                }).join(" → ");

                return `${safetyPrefix}${weatherPrefix}Best route: ${formattedPath}`;
            }
            return `${safetyPrefix}${weatherPrefix}Based on live heatmaps from Firebase, please consult the venue map directly for custom routing.`;
        }

        if (msg.includes("weather") || msg.includes("temperature") || msg.includes("hot") || msg.includes("cold") || msg.includes("rain")) {
            if (liveWeather) {
                return `It's currently ${liveWeather.temp}° and ${liveWeather.condition.toLowerCase()}, stay prepared and plan your route accordingly!`;
            }
        }

        const botResponses = [
            "I'm continuously monitoring the stadium heatmap! Try asking: 'where is the least crowded area?'",
            "Ask me about wait times! For example: 'is the food court busy?'",
            "I've got eyes on the live Firebase crowd data. How can I assist you today?"
        ];
        return botResponses[Math.floor(Math.random() * botResponses.length)];
    }

    function showTypingIndicator() {
        const id = 'typing-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message bot typing-msg';
        msgDiv.id = id;

        msgDiv.innerHTML = `
            <div class="message-bubble glass typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;

        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return id;
    }

    function removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble glass';
        if (sender === 'user') bubbleDiv.classList.remove('glass');

        // Parse simple markdown bolding
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        bubbleDiv.innerHTML = formattedText;

        msgDiv.appendChild(bubbleDiv);
        chatHistory.appendChild(msgDiv);

        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

/**
 * Initializes dummy filters interactions
 */
function initFilters() {
    const filters = document.querySelectorAll('.filter-pill');
    filters.forEach(filter => {
        filter.addEventListener('click', () => {
            filters.forEach(f => f.classList.remove('active'));
            filter.classList.add('active');

            // In a real app we would filter the food grid items here based on the selected category
        });
    });

    const mapFilters = document.querySelectorAll('.map-controls .glass-btn');
    mapFilters.forEach(filter => {
        filter.addEventListener('click', () => {
            mapFilters.forEach(f => f.classList.remove('active'));
            filter.classList.add('active');
        });
    });
}

function updateHeatmapUI(data) {
    const zones = ['zoneA', 'zoneB', 'zoneC', 'zoneD', 'vip', 'food'];

    zones.forEach(zoneKey => {
        if (!data[zoneKey]) return;
        const val = data[zoneKey].toLowerCase().trim();

        const el = document.querySelector(`.zone-card[data-zone="${zoneKey}"]`);
        if (el) {
            // Remove existing classes
            el.classList.remove('density-low', 'density-medium', 'density-high');

            // Add correct class based on value
            el.classList.add(`density-${val}`);

            // Maintain original UI text visuals gracefully
            const iconClass = val === 'low' ? 'fa-user' : (val === 'medium' ? 'fa-user-friends' : 'fa-users');
            const labelCapitalized = val.charAt(0).toUpperCase() + val.slice(1);
            const densityDiv = el.querySelector('.zone-density');

            if (densityDiv) {
                densityDiv.innerHTML = `<i class="fas ${iconClass}"></i> ${labelCapitalized}`;
            }
        }
    });
}

function listenToCrowdData() {
    const crowdRef = ref(db, 'crowd');

    onValue(crowdRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            liveCrowdData = data;
            updateHeatmapUI(data);
            updateBestZoneWidget(); // Refresh recommendation widget on every Firebase push
        }
    });
}

function initSimulator() {
    const simBtn = document.getElementById('refresh-heatmap');
    if (!simBtn) return;

    let isSimulating = false;
    let simInterval;

    function simulateCrowd() {
        const densities = ["low", "low", "medium", "medium", "high"];
        const zones = ['zoneA', 'zoneB', 'zoneC', 'zoneD', 'vip', 'food'];
        
        let newData = {};
        zones.forEach(z => {
            newData[z] = densities[Math.floor(Math.random() * densities.length)];
        });
        
        // Push mathematically generated data directly securely into Firebase Database node
        set(ref(db, "crowd"), newData).catch(err => console.error("Sim error", err));
    }

    // Morph the legacy refresh button into the Live Simulator Controller dynamically
    simBtn.innerHTML = '<i class="fas fa-play"></i> Start Demo';

    // Inject the required text label underneath
    const headerDiv = simBtn.parentElement;
    const demoContext = document.createElement('div');
    demoContext.style.fontSize = "0.85rem";
    demoContext.style.color = "#00e676";
    demoContext.style.marginTop = "8px";
    demoContext.style.fontWeight = "bold";
    demoContext.style.display = "none";
    demoContext.innerHTML = `<i class="fas fa-satellite-dish" style="margin-right: 5px;"></i> Live AI responding to real-time stadium conditions`;
    headerDiv.parentElement.insertBefore(demoContext, headerDiv.nextSibling);

    simBtn.addEventListener('click', () => {
        if (isSimulating) {
            clearInterval(simInterval);
            isSimulating = false;
            simBtn.innerHTML = '<i class="fas fa-play"></i> Start Demo';
            simBtn.classList.remove('spinning');
            demoContext.style.display = 'none';
        } else {
            simulateCrowd(); // Trigger instantaneous first load
            simInterval = setInterval(simulateCrowd, 10000);
            isSimulating = true;
            simBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Demo';
            simBtn.classList.add('spinning');
            demoContext.style.display = 'block';

            // Trigger AI suggestions visibly in the Assistant tab
            if (window.triggerDemoAI) {
                window.triggerDemoAI();
            }
        }
    });
}

/**
 * Initializes the Smart Navigation logic
 */
function initSmartNav() {
    const findRouteBtn = document.getElementById('find-route-btn');
    const routeResultBox = document.getElementById('route-result');

    if (!findRouteBtn || !routeResultBox) return;

    findRouteBtn.addEventListener('click', () => {
        const fromVal = document.getElementById('nav-from').value;
        const toVal = document.getElementById('nav-to').value;

        // Find best intermediate route based on crowd heatmap
        const heatmapGrid = document.getElementById('heatmap-grid');
        let optimalZoneName = "Main Concourse"; // Fallback
        let crowdLevelClass = "low";
        let crowdLevelText = "Low Crowd";

        if (heatmapGrid) {
            const cards = Array.from(heatmapGrid.querySelectorAll('.zone-card'));
            if (cards.length > 0) {
                // Try to find a low density zone
                let targetCard = cards.find(card => card.classList.contains('density-low'));

                if (targetCard) {
                    optimalZoneName = targetCard.querySelector('.zone-label').textContent;
                    crowdLevelClass = "low";
                    crowdLevelText = "Low Crowd";
                } else {
                    targetCard = cards.find(card => card.classList.contains('density-medium'));
                    if (targetCard) {
                        optimalZoneName = targetCard.querySelector('.zone-label').textContent;
                        crowdLevelClass = "medium";
                        crowdLevelText = "Moderate Crowd";
                    } else {
                        // All are high
                        optimalZoneName = cards[0].querySelector('.zone-label').textContent;
                        crowdLevelClass = "high";
                        crowdLevelText = "High Crowd";
                    }
                }
            }
        }

        // Animate Button
        const originalText = findRouteBtn.innerHTML;
        findRouteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
        findRouteBtn.style.opacity = '0.8';

        setTimeout(() => {
            findRouteBtn.innerHTML = originalText;
            findRouteBtn.style.opacity = '1';

            // Show result
            routeResultBox.innerHTML = `
                <div class="route-text">
                    Recommended Route:<br>
                    <strong>${fromVal}</strong> <i class="fas fa-arrow-right" style="margin: 0 5px; opacity:0.6;"></i> <strong>${optimalZoneName}</strong> <i class="fas fa-arrow-right" style="margin: 0 5px; opacity:0.6;"></i> <strong>${toVal}</strong>
                </div>
                <div class="route-crowd-label ${crowdLevelClass}">
                    <i class="fas fa-info-circle"></i> via ${crowdLevelText} Path
                </div>
            `;
            routeResultBox.classList.remove('hidden');
        }, 800);
    });
}

async function fetchWeather() {
    try {
        // Fetch by city name — update 'Jaipur' to your venue's city if needed
        const res = await fetch("/api/weather?city=Jaipur");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        liveWeather = data;
        return data;
    } catch (e) {
        // Weather unavailable — graceful fallback, won't block UI
        liveWeather = null;
        return null;
    }
}

/**
 * Initializes the Weather API Fetch Logic using stationary stadium coordinates
 */
async function initWeather() {
    const weatherVal = document.getElementById('weather-val');
    const weatherIcon = document.getElementById('weather-icon');
    if (!weatherVal) return;

    // Show spinner while fetching
    weatherVal.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 5px; font-size: 0.8rem;"></i>Loading...';

    await fetchWeather();

    if (liveWeather && !liveWeather.error) {
        // Display: e.g. "28°C · Partly cloudy"
        weatherVal.textContent = `${liveWeather.temp}°C · ${liveWeather.description
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')}`;

        // Update weather icon from live condition
        const cond = liveWeather.condition.toLowerCase();
        if (cond.includes('cloud')) {
            weatherIcon.className = 'fas fa-cloud';
        } else if (cond.includes('rain') || cond.includes('drizzle')) {
            weatherIcon.className = 'fas fa-cloud-rain';
        } else if (cond.includes('thunder')) {
            weatherIcon.className = 'fas fa-bolt';
        } else if (cond.includes('snow')) {
            weatherIcon.className = 'fas fa-snowflake';
        } else if (cond.includes('mist') || cond.includes('fog') || cond.includes('haze')) {
            weatherIcon.className = 'fas fa-smog';
        } else {
            weatherIcon.className = 'fas fa-sun';
        }

        // Add tooltip with extra details
        weatherVal.title = `Feels like ${liveWeather.feelsLike}°C · Humidity ${liveWeather.humidity}% · Wind ${liveWeather.windSpeed} m/s`;
    } else {
        weatherVal.textContent = 'Weather unavailable';
        weatherIcon.className = 'fas fa-temperature-half';
    }
}