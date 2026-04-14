# Smart Event Assistant - Setup & Deployment

## Local Setup Instructions
1. Ensure **Node.js** is installed on your machine.
2. Open your terminal in this project directory.
3. Install the backend dependencies:
   ```bash
   npm install
   ```
4. Verify the `.env` file exists and contains your API keys:
   ```env
   GEMINI_API_KEY=your_key
   WEATHER_API_KEY=your_key
   PORT=3000
   ```
5. Start the server:
   ```bash
   npm start
   ```
6. Open your browser and navigate to `http://localhost:3000` to view the application. The frontend and backend run seamlessly together, and the API endpoints are entirely hidden from the browser network requests.

## Deployment Guide

### Vercel
1. Upload your code to a GitHub repository (Ensure `node_modules` and `.env` are excluded).
2. Log into **Vercel** and import the repository.
3. In Build Settings, set the Build Command to empty (or leave default).
4. Go to **Environment Variables** in Vercel settings and add `GEMINI_API_KEY` and `WEATHER_API_KEY`.
5. *Note: Vercel serverless works best with a `vercel.json` config. If routing fails, deploying the raw Express app via Render is the native alternative.*

### Render (Recommended for pure Express Node apps)
1. Upload the code to GitHub.
2. Create a new "Web Service" in Render and link the GitHub repo.
3. Set **Build Command** to `npm install`.
4. Set **Start Command** to `npm start`.
5. Add your Environment variables (`GEMINI_API_KEY`, `WEATHER_API_KEY`) in the Environment tab.
6. Click Deploy. Your secure full-stack app will be live within minutes!
