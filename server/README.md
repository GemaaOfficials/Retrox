# ReEditX Render Worker

Dedicated FFmpeg worker for ReEditX. Deploy it as a separate service from the Next.js web application.

## Local run

Requires Node.js 20.9+, npm, FFmpeg and FFprobe in PATH.

```bash
cp .env.example .env
npm install
# Set RENDER_API_TOKEN to a long random value before starting.
npm run dev
```

Worker default address: http://localhost:8787/health.

## Deployment

Use this directory as the service root in Railway or another Docker host. The Dockerfile installs FFmpeg, FFprobe, DejaVu fonts and Node 24. The health-check path is `/health`.

Required production variable:
- `RENDER_API_TOKEN`: private shared secret. Set the exact same value as `REEDITX_RENDER_API_TOKEN` on the Next.js server. Never expose it with a `NEXT_PUBLIC_` prefix.

Other useful variables are documented in `.env.example`. The default queue supports one active render and four waiting jobs; per-file uploads default to 1 GB. Tune these to the RAM, CPU, disk and plan limits of the machine.

## HTTP API

All render/job endpoints require `Authorization: Bearer <RENDER_API_TOKEN>`. The health endpoint reveals only service status and queue capacity.

- `GET /health`
- `POST /api/render` (multipart fields `video`, optional `audio`, and `settings` JSON field)
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/download`

Render jobs return `202 Accepted` and a UUID. Poll the job endpoint for `status`, `percent`, `message`, and `error`. A completed job downloads as MP4.

The queue and job metadata are in-memory in this first deployment-ready service. Job files are temporary and cleaned after `JOB_TTL_HOURS`; the container should use a writable volume for `/data/reeditx-jobs` if outputs need to survive container restarts.

## Security / operational notes

- Put the worker behind HTTPS and configure `TRUST_PROXY=1` only when the host's reverse proxy correctly overwrites forwarding headers.
- Use a long, random shared token. Rotate it in both the worker and web app if exposed.
- Configure request rate limits, max media duration, upload size, and concurrent jobs according to the actual host resources.
- Validate that your hosting plan supports large streaming request bodies and long FFmpeg jobs before accepting production traffic.
- The web app's server-side proxy sends the token and streams uploads; browser clients never receive the token.
