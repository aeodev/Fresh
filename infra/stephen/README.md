# FreshQA on Stephen's test host

Target: `https://freshqa-kooya.test.kooyaai.com`, private WireGuard listener
`10.66.0.2:54321` on SSH host `stephen-kooya`.

Source and dependencies: `/home/kooya-agent/kooya/repos/freshqa-v2`.
Runtime: Node 24.18.1, Wrangler 4.143.0 local Workers runtime, persistent local
D1 and Durable Objects under `.wrangler/state`. This is a test deployment.
Do not remove that state during updates. Secrets are in the host's mode-0600
`.dev.vars`; `PUBLIC_BASE_URL` is the target HTTPS URL.

The systemd user service `freshqa-kooya.service` restarts the app on failure.
User lingering is enabled. `freshqa-reconcile.timer` invokes the private
scheduled endpoint every ten minutes because the local runtime does not run
Cloudflare cron triggers automatically. The public tunnel blocks that endpoint.

```sh
systemctl --user status freshqa-kooya.service
systemctl --user restart freshqa-kooya.service
systemctl --user list-timers freshqa-reconcile.timer
journalctl --user -u freshqa-kooya.service -n 50
curl --fail http://10.66.0.2:54321/api/health
```

Migrations 0001–0004 were applied on 2026-10-05. The local source database was
empty, so this deployment has a new database. Create an account and company,
connect Freshchat, select a reply agent, activate knowledge, issue a companion
token, and download/install the sidebar ZIP. Use the target hostname without
`https://` in the Freshchat app installation form. Start in Shadow mode and
enable the test conversation in the sidebar before testing Live replies.

The `edge-http.conf`, `edge-https.conf`, and `tunnel.conf` files are additive
exact-host blocks for the existing Singapore edge. Back up the live configs,
append only missing blocks, validate each Nginx instance, then reload. Preserve
file inodes used by Docker bind mounts. Never run the broad `dev-tunnel.sh sync`
helper: it replaces shared configs and removes the tunnel containers.

## Deployment status as of 2026-10-05

The app is running and the health endpoint, UI, sidebar ZIP, unauthenticated
API protection, signup input validation, and reconciliation timer passed checks.
OpenAI credentials are valid and both configured models are available.

Public HTTPS is live. After the shared tunnel was restored, the exact-host
FreshQA tunnel and HTTPS blocks were appended, both Nginx configs validated,
and both instances reloaded. The public health endpoint passed with valid TLS.

The greeting fix was deployed on 2026-10-05: standalone greetings receive a
fixed conversational reply without retrieval or OpenAI. Mixed greetings and
business questions still require citations, and human handoff and confidence
checks remain enforced. All 28 application tests, type checks, and the build
passed on the deployment host. The prior code/UI snapshot is stored in
`backups/pre-greeting-fix-20261005.tar.gz` on the host.

Rollback for FreshQA only: disable its service and timer and remove its marked
Nginx blocks, validating before reload. Preserve the app database and secrets.
Do not roll shared configs back wholesale after other deployments have changed
them.

## Guided support release, 15 October 2026

Release `2026-10-15-guided-support` is deployed to the same public HTTPS host.
Migration 0006 adds per-turn review without transferring conversation ownership.
The release fixes D1 byte-array embedding decoding, punctuation in silence
requests, and repeated inclusion of held turns. Guided replies use recent chat
context, give a small supported next step and wait for the customer.

Validation: 56 local app tests, 6 sidebar tests and 49 host app tests pass;
typecheck and build pass locally and on the host. The host suite lacks the
local reply-format test file, accounting for the count difference. Six real-model
dry-run exchanges against published Apollo v5 passed, using a read-only
production database adapter and no Freshchat sends. Public health reports the
release, protected endpoints return 401 without authentication, and the served
sidebar v2.0.3 ZIP matches the built package. Full lint retains 15 prior diagnostics;
scoped lint for the changed backend and regression tests passes.

Existing installed sidebars can use the backend fixes without reinstalling.
The optional v2.0.3 package adds clearer review labels. Live customer-side
Apollo-to-Freshchat acceptance remains pending Julius's controlled test.

Backups and proof: `backups/20261015-guided-support/` on the host contains
`before-source-and-ui.tar.gz`, a consistent `before-d1.sqlite`, a file hash
manifest, real-model answers and deployment verification. Preserve database
state and later customer activity if rolling source back; do not restore the
pre-release database over newer activity.

## Conversation analysis release, 15 October 2026

Release `2026-10-15-conversation-analysis` is deployed. Migration 0007 adds
company-scoped analysis settings, jobs, daily usage and review history. The
new Analysis dashboard includes plain-language suggestions, source conversation
links with a highlighted message, and simple approval/rejection. The company
header and analysis layout were simplified for desktop and mobile.

Analysis is off by default for all existing companies. No sample conversations,
local preview credentials or lab settings were deployed. No live Freshchat
messages were sent during deployment verification. Approval records a review;
it does not publish knowledge or alter customer replies.

Validation: 75 local tests and 68 host tests pass (the host does not have the
seven local reply-format tests). Host typecheck/build pass. Public health reports
the new release; the root serves the new asset bundle and the analysis API
returns 401 without authentication. The service and reconcile timer are active.
The public sign-in page was verified in the browser; authenticated dashboard
acceptance remains for the signed-in user. Five real-AI sample scenarios and
source/decision interactions were verified in the isolated local preview.

Backups: `backups/20261015-conversation-analysis/before-source-and-ui.tar.gz`
preserves the old code/UI. `d1-existing-data.sqlite` is a consistent snapshot
of existing data after the additive migration and before service restart.
For source rollback, retain the additive tables and current database rather
than restoring a snapshot over newer customer activity.
