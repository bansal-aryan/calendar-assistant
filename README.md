# Aryan’s Calendar — Photon iMessage assistant

Reads your primary Google Calendar and sends a daily agenda two hours before the first timed event, plus reminders 30 minutes before timed events. Uses `America/Los_Angeles`, including daylight saving time. Days without timed events get a 9 AM summary. All-day events appear only in summaries. A 1 AM event gets its summary at 11 PM the previous evening, with “tomorrow” wording.

## Local setup

Requires Node 24 or newer. Run `npm install`.

Keep your existing Photon `PROJECT_ID` and `PROJECT_SECRET`. Add the following yourself to `.env`; never commit or share it:

```dotenv
GOOGLE_CLIENT_ID=your-desktop-oauth-client-id
GOOGLE_CLIENT_SECRET=your-desktop-oauth-client-secret
GOOGLE_REFRESH_TOKEN=filled-after-authorization
RECIPIENT_PHONE=+1XXXXXXXXXX
```

1. In Google Cloud Console, create/select a project and enable Google Calendar API.
2. Configure the OAuth consent screen for your personal use. Request `https://www.googleapis.com/auth/calendar.events.readonly`. Create a **Desktop app** OAuth client, then put its ID and secret in your local environment.
3. Run `npm run authorize` and open its printed Google authorization link in your browser. The callback listens on loopback only and checks state and PKCE. Consent is for read-only calendar events.
4. The refresh token is saved to `.secrets/google-token.json` with restrictive permissions and never printed. Copy its value yourself into `GOOGLE_REFRESH_TOKEN` in `.env` and, later, Heroku config vars. Setup refuses to overwrite an existing token file; move it aside yourself before reconnecting.
5. External OAuth apps left in Testing can have refresh tokens expire after seven days. Configure production publishing as appropriate for your Google account before unattended use. Revoked access requires rerunning authorization.
6. Set your recipient number in international format. On Photon shared plans, register that number as a project user in the Photon dashboard before sending.
7. Run `npm run preview` to inspect the generated schedule without connecting to Photon or sending texts. Preview contains personal event titles; keep its output private.
8. Run `npm start` to activate delivery. Due summaries/reminders can send immediately. Stop with Ctrl-C.

If Photon authentication fails, verify `PROJECT_ID` and `PROJECT_SECRET` at https://app.photon.codes.

## Conversation name and icon

`CONVERSATION_NAME` defaults to `Aryan’s Calendar`. `CONVERSATION_ICON` can hold the path of your chosen image for manual setup. The installed Photon cloud iMessage provider only supports rename/avatar operations for **group chats**. This assistant sends a direct message and therefore does not invoke those unsupported operations or create a group.

On your iPhone, open the message from the Photon number, tap its number at the top, open Info, and create or edit its contact. Set the name to Aryan’s Calendar and choose your photo/icon. Photon cannot apply this contact identity remotely. The worker reports this limitation once at startup; it does not block delivery.

## Configuration

Optional environment variables:

- `RECIPIENT_NAME`: Aryan.
- `TIMEZONE`: America/Los_Angeles.
- `SUMMARY_LEAD_MINUTES`: 120; integer from 1 to 1440.
- `REMINDER_LEAD_MINUTES`: 30; integer from 1 to 1440.
- `DATA_DIR`: ./data locally, /data in Docker.
- `PORT`: 3000 locally; hosting platforms can override it.
- `CONVERSATION_NAME`, `CONVERSATION_ICON`: manual contact setup preferences described above.

The worker polls once a minute and refreshes events before delivery. Changes move unsent summaries/reminders; a sent daily summary is not resent. Cancelled and declined invitations are ignored. Recurring events are expanded by Google. Morning summaries include events still ongoing or upcoming; all-day events use calendar date boundaries.

After downtime, missed summaries are eligible until noon on their target date (or one minute after their scheduled time if later). Late reminders send only before the event starts, stating the actual minutes left. Existing events within 30 minutes also receive a reminder on first startup. Delivery normally occurs within one minute, subject to API and network availability.

Postgres on Heroku (SQLite locally) records delivery before attempting a send. Explicit gRPC resource-exhausted rejections retry twice with backoff. Network errors and other uncertain results are recorded as `uncertain` and never blindly resent; inspect Photon history and the deliveries table before manual recovery. A crash between sending and recording success can suppress a notification on restart. Long agendas split into 1400-character chunks; an uncertain partial send is not automatically replayed.

## Deploy on Heroku

Use one **Basic worker dyno** ($7/month) and **Heroku Postgres Essential-0** ($5/month). These total $12/month before any additional usage or taxes; confirm your $13/month GitHub student credit is active. The Procfile declares only a worker, so no web dyno is needed. The worker runs continuously.

1. Create a personal Heroku app on the classic `heroku-24` stack and attach `heroku-postgresql:essential-0`. Heroku supplies `DATABASE_URL` automatically.
2. Set `PROJECT_ID`, `PROJECT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `RECIPIENT_PHONE` using Heroku config vars. Copy the refresh token from the local `.secrets/google-token.json` privately. Never put credentials in source control.
3. Deploy this directory using Heroku Git with the Node.js buildpack. The build validates TypeScript; `tsx` is a production dependency. Node 24 is selected explicitly.
4. Scale `worker=1:basic`. Do not also run the local sending worker. Check logs for `calendar_poll_ok`; poll failures and uncertain deliveries are logged without personal event details. The worker HTTP endpoint is not publicly routed by Heroku.
5. Confirm a reminder from a temporary event roughly 31 minutes ahead; restart and verify no repeat. Delete the event afterward. Verify the next daily summary separately.

Postgres stores notification records across restarts. A session advisory lock prevents overlapping worker instances; a database connection loss exits the process so Heroku can restart it. Heroku refuses to fall back to ephemeral SQLite if `DATABASE_URL` is missing. Local delivery history is not automatically imported; this setup assumes no earlier live local deliveries.

Local runs load the saved Google token and recipient configuration from ignored `.secrets` files when environment values are absent. The files are excluded from Heroku slugs and Docker images. Heroku requires these values as config vars.

Before unattended use, ensure the Google OAuth app is no longer in Testing (whose refresh tokens can expire after seven days). Google authorization and live delivery tests require your participation.

## Development

- `npm run dev`: reload local worker on source changes (can send messages).
- `npm test`: isolated scheduling, calendar fetching, retry, and persistence tests; no real services.
- `npm run typecheck`: TypeScript validation.

References: [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Heroku Node.js deployment](https://devcenter.heroku.com/articles/getting-started-with-nodejs).

## Active deployment

Heroku app: `aryan-calendar-photon` (US, heroku-24). One Basic worker and an Essential-0 Postgres database; web dynos are disabled. Dashboard: https://dashboard.heroku.com/apps/aryan-calendar-photon

The first deployment was made from a temporary, allowlisted source checkout; the local project Git history was not changed. Future edits need to be deployed explicitly. Use the Heroku CLI (available via `npx --yes heroku@latest`) to inspect worker status and logs. Never print config vars into chat or commit secrets.

## Ask by text

Text the Photon conversation from your configured recipient number:

- “What’s my next event?” — next timed event starting now or later, within the next 30 calendar days.
- “What else do I have today?” — ongoing and upcoming events plus all-day events.
- “What’s my schedule today?” — the full day, including earlier events.

Replies read fresh Google Calendar data, exclude cancelled/declined events, and display Pacific time by default. Common wording and punctuation variants are recognized without an AI service. Unsupported questions return examples. Requests from other senders or group chats are ignored; outbound echoes and duplicate message IDs cannot trigger repeat replies. Calendar failures receive an honest retry message instead of an empty agenda.
