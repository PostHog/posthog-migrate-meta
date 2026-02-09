# PostHog migrate metadata

This tool supports two migration paths:
1. PostHog to PostHog — move metadata between PostHog instances (i.e. everything but events) 
2. Mixpanel to PostHog — migrate user profiles from Mixpanel into PostHog as Person profiles

## Setup

```bash
yarn
```

---

# PostHog to PostHog Migration

Move metadata from one PostHog instance to another, for example from your self-hosted PostHog instance to PostHog cloud.

### Usage

```bash
ts-node index.ts \
  --source https://posthog.example.com \
  --sourcekey phx_source123 \
  --destination https://app.posthog.com \
  --destinationkey phx_dest456
```

### Options

Required: 
- `--source` — URL of the PostHog instance you want to move from, without a trailing `/`. Defaults to `https://app.posthog.com`
- `--sourcekey` — Personal API key for the source instance. See [how to generate a personal API key](https://posthog.com/docs/api#how-to-obtain-a-personal-api-key)
- `--destination` — URL of the PostHog instance you want to move to, without a trailing `/`. Defaults to `https://app.posthog.com`
- `--destinationkey` — Personal API key for the destination instance

Optional:
- `--projects` — A list of project IDs to move. Defaults to moving _all_ projects. Example: `--projects 1 2`
- `--projectmap` — Map source project IDs to existing destination project IDs. Example: `--projectmap 1:81250`

### How to use

1. Set up an organization on the new PostHog instance
2. Run this script as outlined above
3. To move events over — see https://posthog.com/docs/migrate

### What gets migrated
You can also use this tool to copy settings across the same instance and organization. Just use the same settings for both source and destination. The new project will have (copy) added to the name. You can safely run this script multiple times using the same parameters as it'll write the objects it's already moved over to state.json.

- Projects (pick specific ones with `--projects`)
- Dashboards
- Insights
- Actions
- Cohorts
- Feature Flags
- Experiments
- Annotations

### What it doesn't migrate

- **Project API Key** — replace the API key in your code with the new one
- **Events/Persons** — use the [Events migration tool](https://github.com/PostHog/posthog-migration-tools) afterwards
- **"created by" information** — every object will appear as if created by you
- **"created at" information** — every object will appear as if created at script run time


---

# Mixpanel to PostHog User Migration

Exports all user profiles from Mixpanel's Engage API and creates corresponding Person profiles in PostHog.

NOTE: Users was the only migration added due to limited API pricing on Mixpanel's query endpoints. Cohorts, funnels, insights, and event data require higher-tier Mixpanel plans to access via API

### What you'll need

1. **Mixpanel Service Account** — Within Mixpanel, go to Project Settings → Service Accounts. Create a [service account](https://developer.mixpanel.com/reference/create-service-account) with a username and secret.
2. **Mixpanel Project ID** — found in Project Settings → Overview
3. **PostHog Project API Key** — In PostHog → Settings → Project → Project API Key (ex: `phc_12232`)

### Usage

Dry Run:

```bash
npx ts-node index.ts \
  --source-type mixpanel \
  --mixpanel-username YOUR_SERVICE_ACCOUNT_USERNAME \
  --mixpanel-secret YOUR_SERVICE_ACCOUNT_SECRET \
  --mixpanel-project-id YOUR_MIXPANEL_PROJECT_ID \
  --posthog-project-key phc_YOUR_PROJECT_API_KEY \
  --dry-run
```

Run the migration:

```bash
npx ts-node index.ts \
  --source-type mixpanel \
  --mixpanel-username YOUR_SERVICE_ACCOUNT_USERNAME \
  --mixpanel-secret YOUR_SERVICE_ACCOUNT_SECRET \
  --mixpanel-project-id YOUR_MIXPANEL_PROJECT_ID \
  --posthog-project-key phc_YOUR_PROJECT_API_KEY
```

### Options

Required: 
- `--source-type mixpanel` — use Mixpanel for mirgration path 
- `--mixpanel-username` — Service Account username (or legacy API Secret) 
- `--mixpanel-secret` — Service Account secret 
- `--mixpanel-project-id` — Mixpanel project ID 
- `--posthog-project-key` — PostHog Project API Key (`phc_...`) 

Optional: 
- `--destination` — PostHog instance URL. Defaults to `https://app.posthog.com` 
- `--mixpanel-base-url` —  Mixpanel API base URL. Use `https://eu.mixpanel.com/api` for EU
- `--batch-size` —  Profiles per batch sent to PostHog (default: 50) |
- `--dry-run` —  Preview what would be migrated without sending anything 

### How it works

1. Queries Mixpanel's [Engage API](https://developer.mixpanel.com/reference/engage-query) to export all user profiles (paginated, 1000 per page)
2. Maps Mixpanel property names to PostHog equivalents 
3. Sends profiles to PostHog's [`/batch` capture endpoint](https://posthog.com/docs/api/capture) as `$set` events
4. Each `$set` event creates or updates a Person profile in PostHog

### Property mapping

Mixpanel properties are automatically mapped to PostHog equivalents. Any custom properties not in this list are passed through unchanged. The mappings can be found in  `transformers.ts` 

### File overview

| File | Purpose |
|------|---------|
| `index.ts` | CLI entry point — routes to PostHog or Mixpanel migration based on `--source-type` |
| `mixpanelapi.ts` | Mixpanel Engage API client with automatic pagination and endpoint fallback |
| `transformers.ts` | Maps Mixpanel user profiles to Posthog |
| `types.ts` | TypeScript types for `MixpanelProfile` and `MixpanelEngageResponse` |
| `utils.ts` | State management for idempotent re-runs |
| `posthogapi.ts` | Auto-generated OpenAPI types for PostHog's API (used by PostHog→PostHog path) |
| `fetch-polyfill.ts` | node-fetch polyfill for Node.js |


