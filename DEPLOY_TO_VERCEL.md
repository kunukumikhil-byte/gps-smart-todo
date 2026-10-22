# Vercel deployment patch for GPS Smart To-Do

This overlay adds the Vercel project files and adjusts the template/static assets for Vercel's `public/` directory convention.

## Apply the patch

1. Download and extract this ZIP into the root of your cloned `gps-smart-todo` repository, allowing it to overwrite `templates/index.html` and add the new files.
2. Commit and push:
   ```bash
   git add vercel.json .python-version .gitignore public templates/index.html
   git commit -m "Prepare GPS Smart To-Do for Vercel"
   git push origin main
   ```
3. Go to https://vercel.com/new and import `kunukumikhil-byte/gps-smart-todo`.
4. Keep the Root Directory at the repository root. Vercel should auto-detect Flask from `app.py` and `requirements.txt`; no custom build command or output directory is required.
5. After deploy, test `/`, `/health`, `/tasks`, adding a task, deleting a task, location permission, and the map.

## Important data limitation

The current app uses SQLite. Vercel's function filesystem is not durable or shared between instances; the app may work as a demo but tasks can disappear after a cold start/redeployment and concurrent function instances may not see the same tasks. For real use, migrate task storage to a managed database such as Neon/Postgres. Do not treat `/tmp` SQLite as persistent storage.

## Why the static files moved

Vercel's Flask deployment guidance recommends putting CDN-served static files in `public/`. The updated HTML now loads `/style.css` and `/script.js` from that directory.
