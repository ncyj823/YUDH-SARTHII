<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/53b75f8e-61c4-4de4-adcf-f458a2e3140e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Add Firebase web config in `.env.local`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - Optional: `VITE_MAPBOX_TOKEN`
4. Run the app:
   `npm run dev`

## If You See "Firebase Not Configured"

Your `firebase-applet-config.json` is currently empty in this repo, so the app expects Firebase values from environment variables at build time.

For deployed hosting, add the same `VITE_FIREBASE_*` variables in your hosting/build environment and redeploy.

## Deploy To Firebase Hosting

This project is a Vite SPA, so you must deploy the built `dist` folder (not `src`).

1. Build + deploy:
   `npm run deploy`
2. If this is your first deploy in this folder, run once:
   `firebase login`
   `firebase use --add`

The included `firebase.json` serves `dist` and rewrites all routes to `index.html`, which prevents blank pages on refresh/direct links.
