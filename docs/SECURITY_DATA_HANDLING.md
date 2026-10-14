# Security and data handling

This repository is a public demonstration using fixture fleet data and public AIS
feeds. Private deployments must use separate accounts/data and meet the operator
requirements below. Source configuration is not evidence that a running provider,
log collector or database has those settings.

## Data, readers and retention

| Data | Authorized readers/processors | Retention rule |
|---|---|---|
| Password hashes and JWT signing credentials | Authentication service; database administrators for hashes; deployment operators for signing credentials | Credentials stay out of responses, prompts and logs. Rotate credentials when compromised. Account deletion and token revocation are separate lifecycle work, not implemented by client logout. |
| Fleet operational records and generated reports | Users authorized for the fleet; database administrators | Retained for the account's agreed operational lifetime. Agree deletion/export rules before storing private data; no automatic account deletion is implemented. |
| AI prompts, bounded chat history and agent tool context | Authenticated fleet user and the configured Anthropic API processor | No server-side prompt archive is implemented. Provider retention is account-specific and must be approved and recorded by the deployment operator before sending private data. No zero-retention or training-use guarantee is inferred from this repository. |
| Browser chats, agent state and query responses | Current account/fleet/login session | Chats and agent state last for that login; persisted queries expire after 24 hours. Logout, ordinary 401 and replacement login purge session stores. Legacy unscoped sessions require a new login. Private API responses are not cached by the service worker. |
| Application logs and metrics | Deployment/on-call operators; authenticated metrics scraper | Private deployments must set collector expiration to 30 days. Metrics may expose traffic counts and system resource usage, not request paths, prompts or credentials. No collector-retention service is configured by the app. |
| Audit rows | Database administrators and explicitly approved audit operators; no application audit-read API | Private deployments must prune rows older than 90 days through a scheduled administrator-owned database maintenance task. The app writes audit rows but does not schedule pruning. Record the task owner and verification before private rollout. |
| Database backups | Backup/restore operators with database and backup-volume permission | Private deployments require independent expiration after 7 days. The existing job's `-mtime +7` cleanup is eligible after eight complete days and runs only after a successful dump, so it does not enforce that maximum. Configure separate expiry before using it for private data. |

Deployment operators own processor approval, collector expiration, audit pruning
and independent backup expiry. These are external deployment obligations, not
claims of controls this PR has installed. Review access and retention before adding
confidential operational data. Do not put passwords, bearer tokens, API keys or
connection strings in chat, reports, audit free text or support attachments.

## Outbound AI data

Knowledge, compliance, inspection and maintenance helpers send the selected
vessel context plus user-supplied text and bounded conversation history to
Anthropic. Depending on the workflow, that text can include engineer names,
maintenance symptoms, handovers and voyage plans. Agent calls also transmit tool
results such as vessel specifications and public port/weather context. The server
resolves vessel access before assembling this context; model-selected tools cannot
choose another fleet's vessel.

Use the approved API account and HTTPS transport. Keep API credentials server-side.
Verify the processor's account-level retention and permitted data classes directly
with the operator; the code cannot establish these provider settings. A fixture
fallback does not mean data was never submitted: an attempted request may have
reached the provider before failing.

## Diagnostics

Shared application logs serialize error category, allowlisted driver code and HTTP
status. They omit exception messages, stacks, nested causes and provider payloads.
HTTP request logs omit URLs, headers and bodies; response logs retain status only.
Client errors use stable messages, including development mode. Weather-ingestion
summaries and agent tool failures do not return raw exception messages. Known
route templates are metric labels; unmatched requests use the fixed `unmatched`
label. Audit details intentionally contain change metadata, including vessel
patches and work-order titles; treat that table as operational data.

In production, `/metrics` returns 404 until `METRICS_TOKEN` is configured. Once set,
every scrape must send `Authorization: Bearer <token>`; missing or incorrect values
receive 401. Use a dedicated random token of at least 32 characters, not the JWT
signing secret. Local development/test retains optional metrics authentication.
Compose already accepts `METRICS_TOKEN`; Kubernetes operators must supply it through
a Secret-backed environment value and configure the scraper's matching credential.
The repository's example unauthenticated scrape must not be assumed to work for a
private production deployment.

## Real-time fleet subscriptions

Socket.io is authenticated separately from Express. Supply an app-issued JWT in
`handshake.auth.token`; URL query tokens are not accepted. Tokens must use HS256,
identify a user and fleet, and have an expiry. Fleetless accounts are rejected.

```typescript
const socket = io({ auth: { token: appIssuedJwt } })
socket.emit('subscribe:fleet', user.fleetId, ({ ok }) => {
  // ok is false for another fleet or malformed selector.
})
```

A socket can join only its signed fleet's room. It disconnects when the JWT expires
(or earlier at Node's maximum timer delay for unusually long tokens). Obtain a new
credential and reconnect after expiry. Membership and role revocation remain tied
to JWT lifetime; live database-backed session revocation is separate P2 work. The
current position event contains only a timestamp; authenticate and authorize any
future private event or mutation as well.

## Backup access and restore

A whole-database dump includes private fleet records and bcrypt hashes. Restrict
backup-volume mounts and database credentials to backup/restore operators; do not
provide an application download route. Production gp3 storage requests encryption;
local-path demo storage does not establish encrypted at-rest protection. Confirm
actual storage settings, access and expiration without exposing dump contents.

Restoration deliberately restores historical state. Reconcile current passwords,
membership and revocations before reopening access after restoring an old dump.
Refer to [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the operator workflow. Archive
format/integrity checks do not authenticate provenance; approved operator access
and trusted backup selection are required.

## Local verification

Use dummy principals and mocked databases/providers. The regression suites exercise
JWT/room authorization and expiry, client diagnostic sanitization, metric protection,
work-order ownership and browser session isolation. They do not verify production
traffic, provider retention, storage ACLs or real PostgreSQL locking. Do not run
migrations, backups or restores against production as part of these tests.
