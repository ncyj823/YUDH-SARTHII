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
3. Run the app:
   `npm run dev`

## Deploy To Firebase Hosting

This project is a Vite SPA, so you must deploy the built `dist` folder (not `src`).

1. Build + deploy:
   `npm run deploy`
2. If this is your first deploy in this folder, run once:
   `firebase login`
   `firebase use --add`

The included `firebase.json` serves `dist` and rewrites all routes to `index.html`, which prevents blank pages on refresh/direct links.
