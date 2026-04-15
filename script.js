// script.js - Smart Event Assistant Navigation & Logic

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";
import {
    initAuth, signInWithGoogle, signOutUser, onAuthChange,
    logInteraction, trackEvent, listenToAnalyticsSummary, classifyTopic
} from './auth.js';

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

// Initialize Firebase Auth & Analytics (must run before DOMContentLoaded)
initAuth(app);

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
    initAuthUI();        // Google Sign-In / Sign-Out header widget
    initInsightsPanel(); // Real-time analytics drawer
    initKeyboardNav();   // Arrow-key navigation between bottom nav tabs (WCAG 2.1.1)
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
            navItems.forEach(nav => {
                nav.classList.remove('active');
                // WCAG 4.1.2 — aria-current must reflect state change
                nav.setAttribute('aria-current', 'false');
            });

            // Add active class to clicked nav item
            item.classList.add('active');
            item.setAttribute('aria-current', 'page');

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

            // Track tab switch in Firebase Analytics
            trackEvent('tab_switch', { tab: targetId || 'unknown' });
        });
    });
}

/**
 * Adds left/right arrow-key navigation for the bottom nav bar (WCAG 2.1.1 — Keyboard).
 * This follows the ARIA Authoring Practices Guide pattern for a tab list.
 */
function initKeyboardNav() {
    const navItems = Array.from(document.querySelectorAll('.nav-item'));
    if (!navItems.length) return;

    navItems.forEach((item, index) => {
        item.addEventListener('keydown', (e) => {
            let targetIndex = -1;

            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                targetIndex = (index + 1) % navItems.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                targetIndex = (index - 1 + navItems.length) % navItems.length;
            } else if (e.key === 'Home') {
                e.preventDefault();
                targetIndex = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                targetIndex = navItems.length - 1;
            }

            if (targetIndex >= 0) {
                navItems[targetIndex].focus();
                navItems[targetIndex].click(); // Also switch the tab
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

            // Log interaction to Firebase + fire Analytics event
            logInteraction(message, 'gemini').catch(() => {});
            trackEvent('ai_query', { source: 'gemini', topic: classifyTopic(message) });
            incrementSessionQueryCount();
        } catch (error) {
            // Fallback to local logic if network fails, or key missing
            console.warn("Gemini API skipped/failed, using local fallback NLP.", error.message);

            // Artificial delay to make fallback still feel human
            setTimeout(() => {
                const fallbackResponse = generateResponse(message.toLowerCase());

                // Removed chat cache
                removeTypingIndicator(typingId);
                appendMessage(fallbackResponse, 'bot');

                // Log fallback interaction to Firebase
                logInteraction(message, 'fallback').catch(() => {});
                trackEvent('ai_query', { source: 'fallback', topic: classifyTopic(message) });
                incrementSessionQueryCount();
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
// ─── Session Query Counter (in-memory, per page load) ───────────────────────
let _sessionQueryCount = 0;
function incrementSessionQueryCount() {
    _sessionQueryCount++;
    const el = document.getElementById('insight-mine');
    if (el) el.textContent = String(_sessionQueryCount);
}

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

// ─────────────────────────────────────────────────────────────────────────────
//  AUTH UI — Google Sign-In / Sign-Out header widget
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wires the header auth widget:
 *  - Sign-in button → triggers Google popup
 *  - Auth state changes → swap between sign-in button and user chip
 *  - Sign-out button (inside Insights Panel) → signs out and resets UI
 */
function initAuthUI() {
    const signinBtn    = document.getElementById('signin-btn');
    const userChipBtn  = document.getElementById('user-chip-btn');
    const signoutBtn   = document.getElementById('signout-btn');
    const userAvatar   = document.getElementById('user-avatar');
    const userDispName = document.getElementById('user-display-name');

    // Sign in
    if (signinBtn) {
        signinBtn.addEventListener('click', async () => {
            signinBtn.disabled = true;
            signinBtn.style.opacity = '0.7';
            try {
                await signInWithGoogle();
            } catch (err) {
                console.warn('[Auth] Sign-in cancelled or failed:', err.message);
            } finally {
                signinBtn.disabled = false;
                signinBtn.style.opacity = '1';
            }
        });
    }

    // Sign out (inside Insights Panel)
    if (signoutBtn) {
        signoutBtn.addEventListener('click', async () => {
            closeInsightsPanel();
            await signOutUser();
        });
    }

    // React to auth state on every page load and after sign-in/out
    onAuthChange((user) => {
        if (user) {
            // ── Logged in ──────────────────────────────────────────────────
            if (signinBtn)    signinBtn.classList.add('hidden');
            if (userChipBtn)  userChipBtn.classList.remove('hidden');

            // Populate chip
            if (userAvatar && user.photoURL) {
                userAvatar.src = user.photoURL;
                userAvatar.style.display = 'block';
            }
            if (userDispName) {
                // Use first name only for compact display
                userDispName.textContent = (user.displayName || 'User').split(' ')[0];
            }

            // Populate Insights Panel user card
            const iAvatar = document.getElementById('insight-avatar');
            const iName   = document.getElementById('insight-user-name');
            const iEmail  = document.getElementById('insight-user-email');
            if (iAvatar && user.photoURL) { iAvatar.src = user.photoURL; iAvatar.style.display = 'block'; }
            if (iName)  iName.textContent  = user.displayName || 'User';
            if (iEmail) iEmail.textContent = user.email || '';

            // Show the live users badge once someone is logged in
            const badge = document.getElementById('live-users-badge');
            if (badge) badge.classList.remove('hidden');

        } else {
            // ── Logged out ─────────────────────────────────────────────────
            if (signinBtn)    signinBtn.classList.remove('hidden');
            if (userChipBtn)  userChipBtn.classList.add('hidden');

            const badge = document.getElementById('live-users-badge');
            if (badge) badge.classList.add('hidden');
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  INSIGHTS PANEL — slide-in drawer with real-time Firebase stats
// ─────────────────────────────────────────────────────────────────────────────

// ── Focus trap helper ─────────────────────────────────────────────────────
//
// Returns a cleanup function. Traps Tab/Shift+Tab within `containerEl`
// and closes the panel on Escape. Follows WCAG 2.1 — 2.1.2 No Keyboard Trap:
// the trap is intentional for a modal dialog, Escape always provides an exit.
//
function createFocusTrap(containerEl, onEscape) {
    const FOCUSABLE = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    function handleKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onEscape();
            return;
        }
        if (e.key !== 'Tab') return;

        const focusable = Array.from(containerEl.querySelectorAll(FOCUSABLE))
            .filter(el => !el.closest('[aria-hidden="true"]'));
        if (!focusable.length) return;

        const first = focusable[0];
        const last  = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    containerEl.addEventListener('keydown', handleKey);
    // Auto-focus first focusable element inside the panel
    const firstFocusable = containerEl.querySelector(FOCUSABLE);
    if (firstFocusable) firstFocusable.focus();

    return () => containerEl.removeEventListener('keydown', handleKey);
}

let _focusTrapCleanup  = null;  // holds the focus-trap removal function
let _panelOpenerEl     = null;  // element that opened the panel (for focus return)

function openInsightsPanel() {
    const panel   = document.getElementById('insights-panel');
    const overlay = document.getElementById('insights-overlay');
    const btn     = document.getElementById('user-chip-btn');
    if (!panel) return;

    // Remember opener so we can return focus on close (WCAG 2.4.3)
    _panelOpenerEl = document.activeElement;

    panel.classList.remove('hidden');
    if (overlay) { overlay.classList.remove('hidden'); overlay.removeAttribute('aria-hidden'); }

    // Update aria-expanded on the trigger button (WCAG 4.1.2)
    if (btn) btn.setAttribute('aria-expanded', 'true');

    // Slide-in animation
    requestAnimationFrame(() => {
        panel.classList.add('open');
        // Install focus trap after animation frame so the panel is painted
        _focusTrapCleanup = createFocusTrap(panel, closeInsightsPanel);
    });
}

function closeInsightsPanel() {
    const panel   = document.getElementById('insights-panel');
    const overlay = document.getElementById('insights-overlay');
    const btn     = document.getElementById('user-chip-btn');
    if (!panel) return;

    panel.classList.remove('open');
    if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }

    // Update aria-expanded (WCAG 4.1.2)
    if (btn) btn.setAttribute('aria-expanded', 'false');

    // Remove focus trap
    if (_focusTrapCleanup) { _focusTrapCleanup(); _focusTrapCleanup = null; }

    // Return focus to the element that opened the panel (WCAG 2.4.3)
    if (_panelOpenerEl && typeof _panelOpenerEl.focus === 'function') {
        _panelOpenerEl.focus();
        _panelOpenerEl = null;
    }

    // Wait for slide-out then hide from DOM
    setTimeout(() => {
        if (panel) panel.classList.add('hidden');
    }, 320);
}

/**
 * Initializes the Insights Panel:
 *  - Opens when user-chip-btn is clicked
 *  - Closes via close button or overlay click
 *  - Subscribes to /analytics_summary for real-time stat updates
 */
function initInsightsPanel() {
    const userChipBtn  = document.getElementById('user-chip-btn');
    const closeBtn     = document.getElementById('insights-close-btn');
    const overlay      = document.getElementById('insights-overlay');

    if (userChipBtn) {
        userChipBtn.addEventListener('click', () => {
            const panel = document.getElementById('insights-panel');
            if (panel && panel.classList.contains('open')) {
                closeInsightsPanel();
            } else {
                openInsightsPanel();
            }
        });
    }

    if (closeBtn)  closeBtn.addEventListener('click', closeInsightsPanel);
    if (overlay)   overlay.addEventListener('click', closeInsightsPanel);

    // Subscribe to /analytics_summary — fires every time Firebase data changes
    _insightsUnsubscribe = listenToAnalyticsSummary((summary) => {
        updateInsightsUI(summary);
    });
}

/**
 * Renders the latest /analytics_summary snapshot into the Insights Panel DOM.
 * Called on every real-time Firebase push.
 *
 * @param {Object} summary — raw snapshot.val() from /analytics_summary
 */
function updateInsightsUI(summary) {
    // ── Total AI Queries ──────────────────────────────────────────────────────
    const totalEl = document.getElementById('insight-total');
    if (totalEl) totalEl.textContent = String(summary.session_count || 0);

    // ── Active Users (last 10 minutes) ────────────────────────────────────────
    const activeEl = document.getElementById('insight-active');
    if (activeEl) {
        const tenMinAgo   = Date.now() - 10 * 60 * 1000;
        const activeUsers = Object.values(summary.active_users || {})
            .filter(ts => typeof ts === 'number' && ts > tenMinAgo);
        activeEl.textContent = String(activeUsers.length);

        // Update live users badge in header
        const countEl = document.getElementById('live-users-count');
        if (countEl) countEl.textContent = String(activeUsers.length);
    }

    // ── Topic Breakdown bar chart ─────────────────────────────────────────────
    const topicsEl = document.getElementById('insight-topics');
    if (topicsEl && summary.topics) {
        const topics = summary.topics;
        const maxCount  = Math.max(1, ...Object.values(topics));
        const topicMeta = {
            zone:    { label: '🗺️ Zone',    color: 'var(--accent-primary)' },
            food:    { label: '🍔 Food',    color: '#ffa502' },
            weather: { label: '🌤️ Weather', color: 'var(--accent-secondary)' },
            safety:  { label: '⚠️ Safety',  color: 'var(--danger)' },
            route:   { label: '🧭 Route',   color: '#2ed573' },
            general: { label: '💬 General', color: '#a0a5b5' }
        };

        // Sort topics by count descending
        const sorted = Object.entries(topics)
            .filter(([, v]) => v > 0)
            .sort(([, a], [, b]) => b - a);

        if (sorted.length === 0) {
            topicsEl.innerHTML = `<span style="color: var(--text-secondary); font-size: 0.85rem;">No data yet...</span>`;
        } else {
            topicsEl.innerHTML = sorted.map(([key, count]) => {
                const meta = topicMeta[key] || { label: key, color: '#a0a5b5' };
                const pct  = Math.round((count / maxCount) * 100);
                return `
                    <div class="topic-bar-row">
                        <span class="topic-bar-label">${meta.label}</span>
                        <div class="topic-bar-track">
                            <div class="topic-bar-fill" style="width: ${pct}%; background: ${meta.color};"></div>
                        </div>
                        <span class="topic-bar-count">${count}</span>
                    </div>`;
            }).join('');
        }
    }
}