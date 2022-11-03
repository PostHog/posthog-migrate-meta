# PostHog migrate metadata

This tool helps move your metadata (ie everything but events) from one PostHog instance to another, for example from your self hosted PostHog instance to PostHog cloud.

Usage
```bash
yarn
ts-node --source [posthog instance you want to migrate from] --sourcekey [personal api key for that instance] --destination [posthog instance you want to migrate to.] --destinationkey [personal api key for destination instance]
```

Options
- `--source` URL of the PostHog instance you want to move from, without a trailling `/`. Example: `https://posthog.example.com`. Defaults to `https://app.posthog.com`
- `--sourcekey` Person API key, created on the source instance. See [these intructions](https://posthog.com/docs/api#how-to-obtain-a-personal-api-key) on how to generate the personal api key
- `--destination` URL of the PostHog instance you want to move to, without a trailling `/`. Example: `https://posthog.example.com`. Defaults to `https://app.posthog.com`
- `--destinationkey` Person API key, created on the destination instance. See [these intructions](https://posthog.com/docs/api#how-to-obtain-a-personal-api-key) on how to generate the personal api key
- `--projects` A comma separated list of project ids to move over. Will default to moving _all_ projects.

## How to use

1. Set up an organization on the new PostHog instance
1. Move events over using the [Migrator 3000 app](https://posthog.com/docs/apps/migrator-3000)
1. Use this script as outlined above.

## How it works

It'll migrate the following objects
- Projects (you can pick projects using the `--projects` option)
- Dashboards
- Insights
- Actions
- Cohorts
- Feature Flags
- Experiments
- Annotations

Note! It won't move over the following
- Project API Key. You'll need to replace the API key in your code with the new API key.
- Events/Persons. You'll need to use the [Migrator 3000 app](https://posthog.com/docs/apps/migrator-3000) to move events over. Do this first.
- "created by" information. Every object will appear as if it was created by you.
- "created at" information. Every object will appear as if it was created on the time you ran this script.

You can safely run this script multiple times using the same parameters as it'll write the objects it's already moved over to state.json.