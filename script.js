// script.js - Smart Event Assistant Navigation & Logic

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";
import {
    initAuth, signInWithGoogle, signOutUser, onAuthChange, getCurrentUser,
    logInteraction, trackEvent, listenToAnalyticsSummary, classifyTopic,
    logImpactMetric, listenToImpactSummary, listenToAIUsage
} from './auth.js';

// ── Global System Logic ──────────────────────────────────────────────
window.runFullTestSuite = async () => {
    const res = await fetch('./test.js');
    const code = await res.text();
    // Use Function constructor instead of eval for slightly better hygiene in this context
    new Function(code)();
};

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

const STADIUM_SCHEDULE = [
    { time: '10:00', event: 'Gates Open',       vibe: 'Relaxed' },
    { time: '14:30', event: 'Opening Ceremony', vibe: 'Excited' },
    { time: '15:00', event: 'Kick-off',         vibe: 'Peak Intensity' },
    { time: '15:45', event: 'Half-time',        vibe: 'Social/Transition' },
    { time: '16:00', event: 'Second Half',      vibe: 'High Focus' },
    { time: '16:45', event: 'Full-time',        vibe: 'Exiting/Winding Down' }
];

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Global State
let liveCrowdData = {};
let liveWeather     = null;
let chatSessionHistory = [];
let lastAIResponseTime = 0; // Telemetry for Health Bar

const ZONE_LABELS = { 
    zoneA: 'Zone A', 
    zoneB: 'Zone B', 
    zoneC: 'Zone C', 
    zoneD: 'Zone D', 
    vip:   'VIP Lounge', 
    food:  'Food Court' 
};

/**
 * Returns a human-friendly wait time estimate based on crowd density.
 */
function getWaitTimeEstimate(density) {
    const d = (density || 'medium').toLowerCase().trim();
    if (d === 'low')    return '< 2 mins';
    if (d === 'medium') return '5-10 mins';
    if (d === 'high')   return '15-20+ mins';
    return 'Unknown';
}

/**
 * Weighted graph search (DFS) to find the path with lowest crowd 'cost'.
 */
function getBestRoute(fromNode, toNode) {
    // Stadium Connectivity Graph
    const routes = {
        gateA: ["zoneA", "zoneB"],
        zoneA: ["zoneC", "gateA"],
        zoneB: ["zoneD", "gateA"],
        zoneC: ["food", "zoneA"],
        zoneD: ["food", "zoneB"],
        food:  ["zoneC", "zoneD", "vip"],
        vip:   ["food", "zoneA"]
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

//  GLOBAL ENTRY POINT & BOOTLOADER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safe Initialization Wrapper
 * Ensures that if one module fails (e.g. Weather API), the rest of the app still boots.
 */
async function safeInit(name, fn) {
    try {
        if (fn.constructor.name === 'AsyncFunction') {
            await fn();
        } else {
            fn();
        }
        
    } catch (err) {
        console.warn(`[Boot] ${name} ... FAILED:`, err.message);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    
    
    // Core setup first
    await safeInit('Auth', () => initAuth(app));

    // Parallel initialization for UI modules
    safeInit('Navigation',   initNavigation);
    safeInit('ChatAI',       initChatAI);
    safeInit('Filters',      initFilters);
    safeInit('CrowdData',    listenToCrowdData);
    safeInit('SmartNav',     initSmartNav);
    safeInit('Weather',      initWeather);
    safeInit('Simulator',    initSimulator);
    safeInit('AuthUI',       initAuthUI);
    safeInit('Insights',     initInsightsPanel);
    safeInit('KeyboardNav',  initKeyboardNav);
    safeInit('HealthCheck',  initSystemHealthCheck);
    safeInit('Proactive',    initProactiveSuggestions);
    safeInit('Impact',       initImpactMetrics);
    safeInit('AIInsights',   initAIInsights);
    safeInit('MapLink',      initMapInteractions);
    
    safeInit('Persistence',  loadChatHistory);
});

// ── Global Error Boundary ──────────────────────────────────────────────
window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    if (event.reason?.message?.includes('Gemini')) {
        appendMessage('bot', 'I am having trouble reaching my intelligent core. Please try again in a moment. 🌐');
    }
});

function showGlobalError(msg) {
    const errorBar = document.createElement('div');
    errorBar.className = 'glass animated-entry';
    errorBar.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:var(--danger); padding:10px 20px; border-radius:10px; z-index:9999; font-size:0.8rem; border:1px solid rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.4);';
    errorBar.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
    document.body.appendChild(errorBar);
    setTimeout(() => errorBar.remove(), 5000);
}

/**
 * Initializes the bottom navigation tab logic
 */
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewSections = document.querySelectorAll('.view-section');
    if (!navItems.length || !viewSections.length) return;

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

                // Staggered entry reinforcement for tab contents
                const elements = targetSection.querySelectorAll('.animated-entry');
                elements.forEach((el, index) => {
                    el.style.animationDelay = `${(index + 1) * 0.1}s`;
                });

                // If it's the chat section, focus the input
                if (targetId === 'section-assistant') {
                    setTimeout(() => {
                        const input = document.getElementById('chat-input');
                        if (input) input.focus();
                    }, 300);
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
    if (!chatInput || !sendBtn || !chatHistory) return;

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
        const user = getCurrentUser();
        const activeTab = document.querySelector('.nav-item.active')?.getAttribute('data-target') || 'unknown';

        // Call /api/ai with rich multi-context payload
        const response = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                crowdData: liveCrowdData,
                weather: liveWeather,
                conversationHistory: chatSessionHistory, // Corrected variable name
                clientTime: new Date().toISOString(),
                userName: user?.displayName || null,
                activeTab: activeTab
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

        // Interaction Interlock: Prevent rapid-fire spam
        sendBtn.disabled = true;
        chatInput.disabled = true;

        appendMessage(message, 'user');
        chatInput.value = '';

        const typingId = showTypingIndicator();
        const inferenceStart = Date.now();

        try {
            chatSessionHistory.push({ role: 'user', text: message });
            if (chatSessionHistory.length > 6) chatSessionHistory.shift();

            const response = await processMessageWithGemini(message);
            lastAIResponseTime = Date.now() - inferenceStart;

            chatSessionHistory.push({ role: 'assistant', text: response });
            if (chatSessionHistory.length > 6) chatSessionHistory.shift();

            removeTypingIndicator(typingId);
            appendMessage(response, 'bot');

            // Log interaction to Firebase + fire Analytics event
            logInteraction(message, 'gemini').catch(() => {});
            trackEvent('ai_query', { source: 'gemini', topic: classifyTopic(message) });
            incrementSessionQueryCount();
        } catch (error) {
            console.error('Inference Error:', error);
            removeTypingIndicator(typingId);
            
            // Production Resilience: Fallback to local logic if backend is down
            const fallbackResponse = generateResponse(message.toLowerCase());
            appendMessage(fallbackResponse, 'bot');
            
            // Log fallback interaction
            logInteraction(message, 'fallback_offline').catch(() => {});
            trackEvent('ai_query', { source: 'fallback_offline', topic: classifyTopic(message) });
        } finally {
            isAiBusy = false;
            sendBtn.disabled = false;
            chatInput.disabled = false;
            chatInput.focus();
        }
    };

    /**
     * Internal analytics helpers
     */
    function incrementSessionQueryCount() {
        const el = document.getElementById('insight-mine');
        if (el) {
            const current = parseInt(el.textContent) || 0;
            el.textContent = current + 1;
        }
    }

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
            <div class="message-bubble glass typing-indicator animated-entry">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
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
        msgDiv.className = `chat-message ${sender} animated-entry`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble glass';
        if (sender === 'user') bubbleDiv.classList.remove('glass');

        // Parse simple markdown bolding
        const formattedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        bubbleDiv.innerHTML = formattedText;

        msgDiv.appendChild(bubbleDiv);
        chatHistory.appendChild(msgDiv);

        // Smooth scroll to bottom
        chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            behavior: 'smooth'
        });

        // Save to Persistence
        saveChatHistory();
    }
}

/**
 * Initializes dummy filters interactions
 */
function initFilters() {
    const filters = document.querySelectorAll('.filter-pill');
    if (!filters.length) return;
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
            const iconClass = val === 'low' ? 'fa-user' : (val === 'medium' ? 'fa-user-group' : 'fa-users');
            const labelCapitalized = val.charAt(0).toUpperCase() + val.slice(1);
            const densityDiv = el.querySelector('.zone-density');

            densityDiv.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${labelCapitalized}`;
        }
    });

    // Subtly highlight the absolute "Best" zone in the heatmap
    const { best } = getBestZone();
    document.querySelectorAll('.zone-card').forEach(card => card.classList.remove('recommended'));
    if (best.length > 0) {
        const bestKey = best[0].key;
        const bestEl = document.querySelector(`.zone-card[data-zone="${bestKey}"]`);
        if (bestEl) bestEl.classList.add('recommended');
    }
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

    const urlParams = new URLSearchParams(window.location.search);
    const isDebug = urlParams.get('debug') === 'true';

    // Production Hardening: Hide simulation controls from regular users
    if (!isDebug) {
        simBtn.style.display = 'none';
        return;
    }

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
    simBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Demo';

    // Inject the required text label underneath
    const headerDiv = simBtn.parentElement;
    const demoContext = document.createElement('div');
    demoContext.style.fontSize = "0.85rem";
    demoContext.style.color = "#00e676";
    demoContext.style.marginTop = "8px";
    demoContext.style.fontWeight = "bold";
    demoContext.style.display = "none";
    demoContext.innerHTML = `<i class="fa-solid fa-satellite-dish" style="margin-right: 5px;"></i> Live AI responding to real-time stadium conditions`;
    headerDiv.parentElement.insertBefore(demoContext, headerDiv.nextSibling);

    simBtn.addEventListener('click', () => {
        if (isSimulating) {
            clearInterval(simInterval);
            isSimulating = false;
            simBtn.innerHTML = '<i class="fa-solid fa-play"></i> Start Demo';
            simBtn.classList.remove('spinning');
            demoContext.style.display = 'none';
        } else {
            simulateCrowd(); // Trigger instantaneous first load
            simInterval = setInterval(simulateCrowd, 10000);
            isSimulating = true;
            simBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Demo';
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
    const fromSelect = document.getElementById('nav-from');
    const toSelect = document.getElementById('nav-to');

    if (!findRouteBtn || !routeResultBox || !fromSelect || !toSelect) return;

    const zoneNames = {
        gateA: 'Main Gate',
        zoneA: 'Zone A',
        zoneB: 'Zone B',
        zoneC: 'Zone C',
        zoneD: 'Zone D',
        food:  'Food Court',
        vip:   'VIP Lounge'
    };

    findRouteBtn.addEventListener('click', () => {
        const fromVal = fromSelect.value;
        const toVal = toSelect.value;

        if (fromVal === toVal) {
            routeResultBox.innerHTML = '<div class="route-text">You are already at your destination!</div>';
            routeResultBox.classList.remove('hidden');
            return;
        }

        // Animate Button
        const originalText = findRouteBtn.innerHTML;
        findRouteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finding Best Route...';
        findRouteBtn.style.opacity = '0.8';

        setTimeout(() => {
            findRouteBtn.innerHTML = originalText;
            findRouteBtn.style.opacity = '1';

            const bestPath = getBestRoute(fromVal, toVal);

            if (!bestPath || bestPath.length === 0) {
                routeResultBox.innerHTML = '<div class="route-text">No path found. Please try another destination.</div>';
            } else {
                // Generate Breadcrumbs
                const breadcrumbsHTML = bestPath.map((node, index) => {
                    const density = (liveCrowdData[node] || 'medium').toLowerCase().trim();
                    const waitTime = getWaitTimeEstimate(density);
                    const name = zoneNames[node] || node;
                    
                    return `
                        <div class="route-step animated-entry" style="animation-delay: ${index * 0.1}s">
                            <div class="step-info">
                                <span class="step-name">${name}</span>
                                <div class="step-meta">
                                    <span class="density-pill ${density}">${density.toUpperCase()}</span>
                                    <span class="wait-tag"><i class="fa-solid fa-clock"></i> ${waitTime}</span>
                                </div>
                            </div>
                            ${index < bestPath.length - 1 ? '<i class="fa-solid fa-chevron-right route-arrow"></i>' : ''}
                        </div>
                    `;
                }).join('');

                routeResultBox.innerHTML = `
                    <div class="route-header">Optimal Path for ${userName || 'you'}</div>
                    <div class="route-breadcrumbs">${breadcrumbsHTML}</div>
                    <div class="route-footer">
                        <i class="fa-solid fa-circle-info"></i> This route avoids high-crowd areas to save you time.
                    </div>
                `;
                
                // 🔥 LOG IMPACT: If the path has > 1 step and avoids a High zone, estimate 18m saved
                const hasAvoided = bestPath.some(node => (liveCrowdData[node] || '').toLowerCase() === 'high');
                if (!hasAvoided && bestPath.length > 1) {
                     const highZones = Object.keys(liveCrowdData).filter(k => liveCrowdData[k] === 'high');
                     if (highZones.length > 0) {
                         logImpactMetric({ timeSaved: 15, redirect: true, avoidZone: highZones[0] });
                     }
                }
            }
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
    weatherVal.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 5px; font-size: 0.8rem;"></i>Loading...';

    await fetchWeather();

    if (liveWeather && !liveWeather.error) {
        // Display: e.g. "28°C · Partly cloudy"
        weatherVal.textContent = `${liveWeather.temp}°C · ${liveWeather.description
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')}`;

        if (weatherIcon) {
            // Update weather icon from live condition
            const cond = liveWeather.condition.toLowerCase();
            if (cond.includes('cloud')) {
                weatherIcon.className = 'fa-solid fa-cloud';
            } else if (cond.includes('rain') || cond.includes('drizzle')) {
                weatherIcon.className = 'fa-solid fa-cloud-rain';
            } else if (cond.includes('thunder')) {
                weatherIcon.className = 'fa-solid fa-bolt';
            } else if (cond.includes('snow')) {
                weatherIcon.className = 'fa-solid fa-snowflake';
            } else if (cond.includes('mist') || cond.includes('fog') || cond.includes('haze')) {
                weatherIcon.className = 'fa-solid fa-smog';
            } else {
                weatherIcon.className = 'fa-solid fa-sun';
            }
        }
        // Add tooltip with extra details
        weatherVal.title = `Feels like ${liveWeather.feelsLike}°C · Humidity ${liveWeather.humidity}% · Wind ${liveWeather.windSpeed} m/s`;
    } else {
        weatherVal.textContent = 'Weather unavailable';
        if (weatherIcon) weatherIcon.className = 'fa-solid fa-temperature-half';
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
    const overlay  = document.getElementById('insights-overlay');
    const panel    = document.getElementById('insights-panel');
    const openBtn   = document.getElementById('user-chip-btn');
    const closeBtn  = document.getElementById('insights-close-btn');

    if (!overlay || !panel || !openBtn || !closeBtn) return;

    function openInsightsPanel() {
        overlay.classList.remove('hidden');
        panel.classList.remove('hidden');
        overlay.ariaHidden = 'false';
        openBtn.setAttribute('aria-expanded', 'true');
        
        // Setup focus trap and escape listener
        const cleanup = createFocusTrap(panel, closeInsightsPanel);
        panel.dataset.trapCleanup = cleanup; // store for removal
        
        panel.classList.add('open');
        _panelOpenerEl = document.activeElement;
    }

    openBtn.addEventListener('click', () => {
        if (panel.classList.contains('open')) {
            closeInsightsPanel();
        } else {
            openInsightsPanel();
        }
    });

    closeBtn.addEventListener('click', closeInsightsPanel);
    overlay.addEventListener('click', closeInsightsPanel);

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

/**
 * Production State Persistence
 */
function saveChatHistory() {
    try {
        localStorage.setItem('aria_chat_history', JSON.stringify(chatSessionHistory));
    } catch (e) {
        console.warn('Persistence error:', e);
    }
}

function loadChatHistory() {
    try {
        const saved = localStorage.getItem('aria_chat_history');
        if (saved) {
            const history = JSON.parse(saved);
            const container = document.getElementById('chat-history');
            if (!container) return;
            
            container.innerHTML = '';
            chatSessionHistory = history; 
            history.forEach(msg => appendMessage(msg.text, msg.role === 'assistant' ? 'bot' : 'user'));
        }
    } catch (e) {
        localStorage.removeItem('aria_chat_history');
    }
}

/* System Health Diagnostic Suite */
function initSystemHealthCheck() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') !== 'true') return;

    const bar = document.createElement('div');
    bar.className = 'health-bar';
    bar.style.display = 'block';
    document.body.appendChild(bar);

    const indicator = document.createElement('div');
    indicator.className = 'health-indicator';
    indicator.style.display = 'block';
    indicator.innerHTML = 'SYS: ACTIVE | FB: ... | AI: ...';
    document.body.appendChild(indicator);

    setInterval(() => {
        const fbStatus = (Object.keys(liveCrowdData).length > 0) ? '🟢' : '🔴';
        const aiStatus = (lastAIResponseTime < 2500) ? '🟢' : '🟡';
        indicator.innerHTML = `SYS: ACTIVE | FB: ${fbStatus} | AI: ${aiStatus} | LAT: ${lastAIResponseTime}ms`;
        
        if (lastAIResponseTime > 3000) bar.style.background = '#ff4757';
        else if (lastAIResponseTime > 1500) bar.style.background = '#ffa502';
        else bar.style.background = '#2ed573';
    }, 2000);
}

/**
 * Autonomous logic to generate tips based on live data and match schedule.
 */
function getProactiveTip() {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const { best, avoid } = getBestZone();
    
    // 1. Safety Priority: Overcrowding
    if (avoid && avoid.length > 2) {
        return `⚠️ Multiple zones are packed. Consider heading to **${best[0]?.name || 'Zone A'}** to avoid the crush.`;
    }

    // 2. Schedule Timing: Full-time is near
    const fullTime = STADIUM_SCHEDULE.find(e => e.event === 'Full-time');
    if (fullTime) {
        const [h, m] = fullTime.time.split(':').map(Number);
        const evMins = h * 60 + m;
        const diff = evMins - currentMins;
        if (diff > 0 && diff < 15) {
            const tip = `⏳ Match ending in ${diff}m! Beat the rush—the quietest exit path is through **Gate A**.`;
            // Log redirection impact
            logImpactMetric({ redirect: true });
            return tip;
        }
    }

    // 3. Efficiency: Food Court
    const foodCrowd = (liveCrowdData['food'] || 'medium').toLowerCase();
    if (foodCrowd === 'low') {
        const halfTime = STADIUM_SCHEDULE.find(e => e.event === 'Half-time');
        const [h, m] = halfTime.time.split(':').map(Number);
        const evMins = h * 60 + m;
        const mUntilHalf = evMins - currentMins;
        if (mUntilHalf > 10) {
            return `🍔 Hunger striking? The **Food Court** is quiet right now. Beat the half-time rush!`;
        }
    }

    // 4. Weather Logic
    if (liveWeather && liveWeather.condition.toLowerCase().includes('rain')) {
        return `🌧️ Rain detected. **Zones A and C** are the best covered stands to stay dry.`;
    }

    // 5. General Best Zone
    if (best && best.length > 0) {
        const tip = `✨ **${best[0].name}** currently has the most space. Perfect for a relaxed view.`;
        // Log subtle redirect impact
        if (Object.values(liveCrowdData).includes('high')) {
            logImpactMetric({ timeSaved: 5, redirect: true });
        }
        return tip;
    }

    return "Analyzing stadium flow... Stay tuned for live recommendations.";
}

function initProactiveSuggestions() {
    const textEl = document.getElementById('proactive-text');
    const muteCheck = document.getElementById('mute-suggestions');
    if (!textEl) return;

    const updateTip = () => {
        if (muteCheck && muteCheck.checked) {
            textEl.innerHTML = '<span style="opacity:0.5; font-style:italic;">Suggestions muted</span>';
            return;
        }

        const tip = getProactiveTip();
        
        // Simple fade out/in effect
        textEl.style.opacity = '0';
        setTimeout(() => {
            textEl.innerHTML = tip;
            textEl.style.opacity = '1';
        }, 500);
    };

    // Initial run
    setTimeout(updateTip, 2000);
    
    // Refresh every 8 seconds
    setInterval(updateTip, 8000);
}

/**
 * Initializes the real-time Impact Metrics display and timeframe toggling.
 */
function initImpactMetrics() {
    const timeEl = document.getElementById('metric-time');
    const redirectEl = document.getElementById('metric-redirects');
    const avoidedEl = document.getElementById('metric-avoided');
    const tfBtns = document.querySelectorAll('.tf-btn');
    if (!timeEl || !redirectEl || !avoidedEl) return;

    let currentMode = 'cumulative'; // 'cumulative' | 'hourly'
    let lastData = null;

    // Set professional defaults immediately for hydration
    timeEl.textContent = '0m';
    redirectEl.textContent = '0';
    avoidedEl.textContent = 'None';

    const renderMetrics = (data) => {
        if (!data) return;
        lastData = data;

        const cumulative = data.cumulative || { time_saved: 0, redirects: 0, avoided_counts: {} };
        const events = data.events ? Object.values(data.events) : [];

        if (currentMode === 'cumulative') {
            timeEl.textContent = `${cumulative.time_saved || 0}m`;
            redirectEl.textContent = cumulative.redirects || 0;
            
            // Find most avoided zone
            const avoided = cumulative.avoided_counts || {};
            const topZone = Object.entries(avoided).sort((a,b) => b[1] - a[1])[0];
            avoidedEl.textContent = topZone ? (ZONE_LABELS[topZone[0]] || topZone[0]) : 'None';
        } else {
            // Sliding 60-minute window calculation
            const now = Date.now();
            const hourAgo = now - (60 * 60 * 1000);
            const recent = events.filter(e => e.ts && e.ts > hourAgo);
            
            const hTime = recent.reduce((sum, e) => sum + (e.t || 0), 0);
            const hRedirects = recent.reduce((sum, e) => sum + (e.r || 0), 0);

            timeEl.textContent = `${hTime}m`;
            redirectEl.textContent = hRedirects;
            
            // Recent most avoided
            const recentAvoided = {};
            recent.forEach(e => { if(e.z) recentAvoided[e.z] = (recentAvoided[e.z] || 0) + 1; });
            const topRecent = Object.entries(recentAvoided).sort((a,b) => b[1] - a[1])[0];
            avoidedEl.textContent = topRecent ? (ZONE_LABELS[topRecent[0]] || topRecent[0]) : 'None';
        }

        // Production UI Transition: Remove shimmers and update aria-busy
        const grid = document.getElementById('impact-grid');
        if (grid) {
            grid.setAttribute('aria-busy', 'false');
            grid.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));
        }
    };

    // Subscriptions
    listenToImpactSummary(renderMetrics);

    // Toggle Listeners
    tfBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tfBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.id === 'tf-hourly' ? 'hourly' : 'cumulative';
            renderMetrics(lastData);
        });
    });
}

/**
 * Initializes real-time AI Insights display (Public & Debug).
 */
function initAIInsights() {
    const qEl = document.getElementById('ai-queries');
    const lEl = document.getElementById('ai-latency');
    const logStream = document.getElementById('ai-log-stream');
    const debugPanel = document.getElementById('debug-ai-logs');

    const isDebug = new URLSearchParams(window.location.search).get('debug') === 'true';

    listenToAIUsage((data) => {
        if (!data) return;

        const summary = data.summary || {};
        const events  = data.events ? Object.values(data.events).sort((a,b) => b.t - a.t) : [];

        // Update Public Metrics
        if (qEl) qEl.textContent = events.length;
        if (lEl) lEl.textContent = summary.last_latency ? `${summary.last_latency}ms` : '---';

        // Production UI Transition: Remove shimmers and update aria-busy
        const grids = document.querySelectorAll('.impact-grid[aria-busy="true"]');
        grids.forEach(grid => {
            if (grid.querySelector('#ai-queries') || grid.querySelector('#ai-latency')) {
                grid.setAttribute('aria-busy', 'false');
                grid.querySelectorAll('.shimmer').forEach(el => el.classList.remove('shimmer'));
            }
        });

        // Update Debug Logs if active
        if (isDebug && debugPanel && logStream) {
            debugPanel.classList.remove('hidden');
            const recent = events.slice(0, 10);
            logStream.innerHTML = recent.map(ev => `
                <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding: 5px 0; font-size: 0.7rem;">
                    <span style="color: var(--accent-primary)">[${new Date(ev.t).toLocaleTimeString()}]</span>
                    <span style="font-weight: 700; color: #fff;">${ev.l}ms</span>
                    <span style="color: var(--text-secondary)">- ${ev.q}...</span>
                </div>
            `).join('');
        }
    });
}