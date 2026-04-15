# Smart Event Assistant

## Overview

Smart Event Assistant is a web-based system designed to improve attendee experience at large-scale physical events such as stadiums, concerts, and festivals. It combines real-time data with AI-driven insights to support better decision-making, safer movement, and more efficient navigation.

The focus of the project is not only on interface design but on building a system that reacts dynamically to real-world conditions.

---

## Challenge Vertical

Physical Event Experience

This solution addresses challenges related to crowd movement, waiting times, and real-time coordination inside large venues.

---

## Problem

Users attending large events often face:

* Limited visibility of crowd density across different zones
* Difficulty finding efficient paths within the venue
* Long waiting times due to poor distribution of crowd flow
* Lack of real-time assistance

These issues affect both user experience and safety.

---

## Solution

The Smart Event Assistant provides:

* Real-time crowd awareness across zones
* Context-aware suggestions through an AI assistant
* Intelligent navigation recommendations based on live conditions
* Integration of environmental context such as weather
* A responsive interface for quick interaction

The system adapts its responses dynamically instead of relying on static logic.

---

## Approach and Logic

The system is built around context-driven decision-making:

* Crowd density data is maintained in real time using Firebase
* User queries are combined with live system state
* AI responses are generated using Google Gemini based on this context
* Routing logic prioritizes zones with lower density

This ensures that outputs reflect current conditions rather than predefined responses.

---

## How It Works

1. User interacts with the interface or asks a query
2. The system retrieves:

   * Current crowd data
   * Weather data
3. These inputs are passed to the AI layer
4. The AI generates a contextual response
5. The UI updates in real time

---

## Key Features

* Real-time crowd monitoring
* AI-powered assistant using Google Gemini
* Context-aware decision support
* Dynamic UI updates based on live data
* Weather-aware responses

---

## Technology Stack

Frontend:

* HTML
* CSS
* JavaScript

Backend:

* Vercel serverless functions

Google Services:

* Google Gemini API (AI processing)

Other Integrations:

* Firebase Realtime Database
* OpenWeather API

---

## Google Services Integration

This project makes meaningful use of Google services:

* Google Gemini API is used to generate intelligent, context-aware responses
* Firebase Realtime Database enables live synchronization of crowd data
* (Optional extension) Firebase Authentication and Analytics can be used for tracking user interactions and behavior

The integration is designed to support real-time intelligence and scalable usage.

---

## Security

* API keys are stored using environment variables
* External API calls are handled through backend serverless functions
* Sensitive credentials are not exposed on the frontend
* Firebase rules are configured to restrict unauthorized access

---

## Efficiency

* Lightweight structure with minimal dependencies
* Efficient API usage with controlled calls
* Fast rendering using static frontend
* Real-time updates without page reload

---

## Testing

Basic testing has been implemented to ensure reliability of the system:

* Validation of Firebase data retrieval
* Verification of AI response generation logic
* UI update checks based on dynamic data
* Error handling for failed API calls

A simple test script validates:

* Crowd data consistency
* API response format
* UI rendering behavior

Test results are logged in the console with clear pass/fail indicators.

---

## Accessibility

* Clear layout and readable content structure
* Responsive design for different screen sizes
* Logical navigation between sections
* Input and interaction elements designed for usability

---

## Assumptions

* Crowd data is either simulated or updated in real time
* Users have internet connectivity
* The system is used within a controlled event environment

---

## Deployment

The application is deployed on Vercel:

* Frontend is served as a static application
* Backend APIs are implemented using serverless functions
* Environment variables are configured securely

---

## Evaluation Alignment

This project demonstrates:

* A dynamic assistant using real-time context
* Logical decision-making based on user input
* Practical applicability in real-world scenarios
* Integration of Google services for AI and data handling
* Clean, modular, and maintainable code

---

## Author

Arien Khardiya

---

## Live Application

https://smart-event-management-system-pck00rbct.vercel.app/

---

## Final Note

The goal of this project is to move beyond static applications and build a system that adapts to real-time conditions, providing useful and actionable insights to users in complex environments.
