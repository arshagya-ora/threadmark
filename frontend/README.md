# Threadmark frontend

**Follow the evidence.**

Current version author and maintainer: **ARshagya Shrivastava**.

Next.js 16, React 19, TypeScript, and Tailwind CSS power the research workspace,
interactive knowledge graph, and monitoring dashboard.

## Local development

Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to your backend.
The default is `http://localhost:8000`.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000` with the backend running separately.

## Checks

```sh
npm run lint
npm run build
```

## Application identity

Shared branding, authorship, and API configuration live in `src/lib/config.ts`.
The root layout uses this identity for browser and sharing metadata.

Hosting is configured separately. Set the public API URL before building for a
new environment; no remote application endpoint is included by default.
