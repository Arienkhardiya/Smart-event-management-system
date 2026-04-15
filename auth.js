// auth.js — Firebase Authentication, Analytics & Interaction Logger
//
// Handles:
//   - Google Sign-In via popup (optional — app works without login)
//   - Session persistence via Firebase Auth
//   - Analytics event tracking via GA4 / Firebase Analytics
//   - Per-user interaction logging to /interactions/{uid}/ in Realtime DB
//   - Global aggregated counters at /analytics_summary/ for the Insights Panel
//
// SECURITY: No API keys are exposed here. Firebase client config is intentionally
// public — security is enforced via Realtime Database rules (UID-scoped writes).

import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged, setPersistence, browserLocalPersistence }
    from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

import { getAnalytics, logEvent }
    from "https://www.gstatic.com/firebasejs/10.9.0/firebase-analytics.js";

import { getDatabase, ref, push, onValue, update, serverTimestamp, increment }
    from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// ─── Module-level state ──────────────────────────────────────────────────────
let _auth      = null;
let _analytics = null;
let _db        = null;

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize Auth, Analytics, and DB from the already-initialized Firebase app.
 * Must be called once before any other exports are used.
 *
 * @param {import("https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js").FirebaseApp} firebaseApp
 * @returns {Promise<object>} Firebase Auth instance
 */
export async function initAuth(firebaseApp) {
    if (!firebaseApp) throw new Error('[Auth] Firebase App not provided');

    try {
        _db   = getDatabase(firebaseApp);
        _auth = getAuth(firebaseApp);
    } catch (e) {
        console.error('[Auth] Essential Firebase services failed:', e.message);
        throw e; // Core services are required
    }

    // Explicitly set local persistence to ensure sessions survive refresh
    try {
        await setPersistence(_auth, browserLocalPersistence);
    } catch (e) {
        console.warn('[Auth] Persistence setup failed (non-fatal):', e.message);
    }

    // Analytics can be blocked by ad-blockers — fail gracefully
    try {
        _analytics = getAnalytics(firebaseApp);
    } catch (e) {
        // This is expected in production if user uses an ad-blocker
        
    }

    return _auth;
}

// ─── Authentication ───────────────────────────────────────────────────────────

/**
 * Open a Google Sign-In popup.
 * @returns {Promise<import("firebase/auth").User>}
 */
export async function signInWithGoogle() {
    if (!_auth) throw new Error('[Auth] Not initialized. Call initAuth() first.');

    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    const result = await signInWithPopup(_auth, provider);
    trackEvent('login', { method: 'Google' });
    return result.user;
}

/**
 * Sign out the current user and clear their active-session marker in Firebase.
 */
export async function signOutUser() {
    if (!_auth) return;

    const user = _auth.currentUser;
    if (user && _db) {
        // Remove active-user marker - fail silently if permissions change
        await update(ref(_db, 'analytics_summary/active_users'), {
            [user.uid]: null
        }).catch(() => {});
    }

    try {
        trackEvent('logout', {});
        await firebaseSignOut(_auth);
    } catch (e) {
        // Sign out should rarely fail, but avoid crashing the UI
    }
}

/**
 * Subscribe to Firebase Auth state changes (fires immediately on page load
 * to restore an existing session).
 *
 * @param {function(user: User|null): void} callback
 * @returns {function} Unsubscribe function
 */
export function onAuthChange(callback) {
    if (!_auth) return () => {};
    return onAuthStateChanged(_auth, callback);
}

/**
 * @returns {import("firebase/auth").User|null}
 */
export function getCurrentUser() {
    return _auth ? _auth.currentUser : null;
}

// ─── Topic Classification ─────────────────────────────────────────────────────

/**
 * Classify a user message into one of the tracked topic categories.
 * Order matters: "weather" is checked first because it contains the substring "eat"
 * which would otherwise incorrectly match the food branch.
 *
 * @param {string} message
 * @returns {'weather'|'food'|'zone'|'safety'|'route'|'general'}
 */
export function classifyTopic(message) {
    const msg = message.toLowerCase();

    // ⚠️ weather MUST come before food — "weather" contains "eat"
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

// ─── Interaction Logging ──────────────────────────────────────────────────────

/**
 * Log a user query to Firebase Realtime DB (authenticated users only):
 *   /interactions/{uid}/{pushId}         — full interaction record
 *   /analytics_summary/topics/{topic}    — incremented topic counter
 *   /analytics_summary/session_count     — global query counter
 *   /analytics_summary/active_users/{uid} — last-seen timestamp
 *
 * Anonymous (not signed-in) users are silently skipped — no data is written.
 *
 * @param {string} message      — The user's query (capped at 200 chars)
 * @param {string} responseType — 'gemini' | 'fallback' | 'error'
 */
export async function logInteraction(message, responseType = 'unknown') {
    if (!_db || !_auth) return;

    const user = _auth.currentUser;
    if (!user) return; // Only log authenticated users

    const topic = classifyTopic(message);

    // Full interaction record under the user's own node
    const interactionRecord = {
        message:      message.slice(0, 200), // cap for DB storage efficiency
        topic,
        responseType,
        timestamp:    serverTimestamp(),
        uid:          user.uid
    };

    // Batch write: interaction record + aggregated summary counters
    const summaryUpdates = {
        [`analytics_summary/topics/${topic}`]:       increment(1),
        [`analytics_summary/session_count`]:         increment(1),
        [`analytics_summary/active_users/${user.uid}`]: serverTimestamp()
    };

    try {
        await Promise.all([
            push(ref(_db, `interactions/${user.uid}`), interactionRecord),
            update(ref(_db), summaryUpdates)
        ]);
    } catch (err) {
        // Silence background telemetry errors in production
    }
}

// ─── Analytics Events ─────────────────────────────────────────────────────────

/**
 * Log a named event to Firebase Analytics (GA4).
 * Fails silently if Analytics is blocked or unavailable.
 *
 * @param {string} eventName
 * @param {Object} [params]
 */
export function trackEvent(eventName, params = {}) {
    if (!_analytics) return;
    try {
        logEvent(_analytics, eventName, params);
    } catch (e) {
        // Ad-blockers or CSP can block Analytics — silent failure is correct here
    }
}

// ─── Real-Time Insights ───────────────────────────────────────────────────────

/**
 * Subscribe to /analytics_summary and fire the callback on every Firebase push.
 * Returns the Firebase unsubscribe function.
 *
 * Callback receives a normalized summary object:
 * {
 *   session_count: number,
 *   active_users:  { [uid]: serverTimestamp },
 *   topics:        { food: n, zone: n, weather: n, safety: n, route: n, general: n }
 * }
 *
 * @param {function(summary: Object): void} callback
 * @returns {function} Unsubscribe
 */
export function listenToAnalyticsSummary(callback) {
    if (!_db) return () => {};
    return onValue(ref(_db, 'analytics_summary'), snapshot => {
        const data = snapshot.val() || {};
        // Ensure standard structure to prevent UI errors
        callback({
            session_count: data.session_count || 0,
            active_users:  data.active_users  || {},
            topics:        data.topics        || {}
        });
    });
}

// ─── Impact Analytics ────────────────────────────────────────────────────────

/**
 * Log a value-add impact event:
 *   - timeSaved: minutes saved by avoiding a high-density route
 *   - redirect:  guided to a low-density zone
 *   - avoidZone: the zone key that was avoided
 */
export async function logImpactMetric({ timeSaved = 0, redirect = false, avoidZone = null }) {
    if (!_db) return;

    const updates = {
        'impact_summary/cumulative/time_saved': increment(timeSaved),
        'impact_summary/cumulative/redirects':  increment(redirect ? 1 : 0)
    };

    if (avoidZone) {
        updates[`impact_summary/cumulative/avoided_counts/${avoidZone}`] = increment(1);
    }

    // Also log a timestamped event for the "Last 60 Minutes" sliding window calculation
    const event = {
        t: timeSaved,
        r: redirect ? 1 : 0,
        z: avoidZone,
        ts: serverTimestamp()
    };

    try {
        await Promise.all([
            update(ref(_db), updates),
            push(ref(_db, 'impact_summary/events'), event)
        ]);
    } catch (err) {
        // Silent fail for background metrics
    }
}

/**
 * Subscribe to the combined impact data.
 */
export function listenToImpactSummary(callback) {
    if (!_db) return () => {};
    return onValue(ref(_db, 'impact_summary'), snapshot => {
        callback(snapshot.val() || {});
    });
}

/**
 * Real-time listener for AI Backend Telemetry and Usage.
 * Provides live updates on Gemini response times and total request volume.
 */
export function listenToAIUsage(callback) {
    if (!_db) return;
    onValue(ref(_db, 'ai_usage'), (snapshot) => {
        callback(snapshot.val() || {});
    });
}
