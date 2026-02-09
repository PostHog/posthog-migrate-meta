// import 'whatwg-fetch'
import './fetch-polyfill'



import { Fetcher, Middleware } from 'openapi-typescript-fetch'

import { paths } from './posthogapi'
import { replaceCohortsRecurse, State } from './utils';
import * as commandLineArgs from 'command-line-args'

// Mixpanel migration imports
import { MixpanelAPI } from './mixpanelapi'
import { transformProfileToPostHogEvent } from './transformers'


const options = commandLineArgs([
    { name: 'destination', type: String },
    { name: 'destinationkey', type: String },
    { name: 'source', type: String },
    { name: 'sourcekey', type: String },
    { name: 'projects', type: Number, multiple: true },
    { name: 'projectmap', type: String, multiple: true },
    // Mixpanel migration flags
    { name: 'source-type', type: String, defaultValue: 'posthog' },
    { name: 'mixpanel-username', type: String },
    { name: 'mixpanel-secret', type: String },
    { name: 'mixpanel-project-id', type: String },
    { name: 'mixpanel-base-url', type: String },
    { name: 'posthog-project-key', type: String },  // Project API key (phc_...) for capture endpoint
    { name: 'batch-size', type: Number, defaultValue: 50 },
    { name: 'dry-run', type: Boolean, defaultValue: false },
])


// choose migration from posthog to posthog or mixpanel to posthog 
if (options['source-type'] === 'mixpanel') {
    runMixpanelMigration()
} else {
    runPostHogMigration()
}

// posthog to posthog function 
function runPostHogMigration() {

if(!options.destination) {
    options.destination = 'https://app.posthog.com'
}
options.destination = options.destination.replace(/\/$/, '')
if(!options.source) {
    options.source = 'https://app.posthog.com'
}
options.source = options.source.replace(/\/$/, '')
if(!options.destinationkey) {
    console.error("--destinationkey is required")
    process.exit()
}
if(!options.sourcekey) {
    console.error("--sourcekey is required")
    process.exit()
}
if(options.projectmap) {
    options.projectmap = Object.fromEntries(options.projectmap.map(map => {
        map = map.split(':')
        return [map[0], map[1]]
    }))
} else {
    options.projectmap = {}   
}


// declare fetcher for paths
const source = Fetcher.for<paths>()

const sourceHeaders = {
    headers: {
        'Authorization': `Bearer ${options.sourcekey}`
    },
}
source.configure({
    baseUrl: options.source,
    init: sourceHeaders
})

const destination = Fetcher.for<paths>()

const destinationHeaders = {
    headers: {
        'Authorization': `Bearer ${options.destinationkey}`
    },
}
destination.configure({
    baseUrl: options.destination,
    init: destinationHeaders,
})

type key = 'feature_flags' | 'cohorts' | 'actions' | 'dashboards' | 'insights' | 'experiments' | 'annotations'

class MigrateProjectData {
    destinationId: string
    sourceId: string
    _state: State
    state: State

    constructor(sourceId, destinationId, state) {
        this.sourceId = sourceId
        this.destinationId = destinationId
        this._state = state
        this.state = state.state.projects[sourceId]
    }

    public async run() {
        await this.migrateObject(
            'cohorts',
            (object) => {
                if (object.is_static) {
                    console.warn(`Cohort with ID ${object.id} skipped, as it's a static cohort. Please move this one manually after event migration.`)
                    return false
                }
                return true
            }
        )
        await this.migrateObject(
            'actions',
            null,
            (object) => {
                replaceCohortsRecurse(object.steps, this.state['cohorts'])
                object.steps = object.steps.map(step => { 
                    delete step.id
                    return step
                })
                return object
            }
        )
        await this.migrateObject(
            'experiments',
            null,
            (object) => {
                replaceCohortsRecurse(object.filters, this.state['cohorts'])
                for (let i = 0; i < object.filters.actions?.length; i++) {
                    object.filters.actions[i].id = this.state['actions'][object.filters.actions[i].id]
                }
                return object
            }
        )
        await this.migrateObject(
            'feature_flags',
            (object) => {
                // Filter out feature flags used in experiments as we've already moved those
                return !object.experiment_set || object.experiment_set.length === 0

            },
            (object) => {
                replaceCohortsRecurse(object.filters, this.state['cohorts'])
                return object
            }
        )
        await this.migrateObject(
            'dashboards',
            null,
            (object) => {
                replaceCohortsRecurse(object.filters, this.state['cohorts'])
                return object
            }
        )
        await this.migrateObject(
            'insights',
            null,
            (object) => {
                try {
                    replaceCohortsRecurse(object.filters, this.state['cohorts'])
                } catch (e) {
                    return null
                }
                // Replace action ids
                for (let i = 0; i < object.filters.actions?.length; i++) {
                    object.filters.actions[i].id = this.state['actions'][object.filters.actions[i].id]
                }
                // Replace dashboard ideas
                if (object.dashboard) {
                    object.dashboards = [this.state['dashboards'][object.dashboard]]
                } else {
                    object.dashboards = object.dashboards.map(dashboardId => {
                        return this.state['dashboards'][dashboardId]
                    }).filter(x => x)
                }
                return object
            }
        )
        await this.migrateObject(
            'annotations',
            null,
            (annotation) => {
                if (annotation.dashboard_item) {
                    annotation.dashboard_item = this.state['insights'][annotation.dashboard_item]
                }
                return annotation
            }
        )

    }
    private async migrateObject(key: key, filterObjects?: (object) => boolean, mapObjects?: (object) => any) {
        if (!this.state[key]) {
            this.state[key] = {}
        }

        let errors = 0
        let success = 0
        let skipped = 0
        const endpoint = `/api/projects/{project_id}/${key}/` as keyof paths
        const sourceapi = source.path(endpoint) as any
        let allObjects

        try {
            allObjects = await this.paginate(sourceapi.method('get').create(), key)
         } catch (e) {
            if (e.getActualType && e.getActualType()) {
                console.error(`[${key}]`, e.getActualType())
                if(e.getActualType().data.code === 'payment_required') {
                    return
                }
            }
            console.error(`[${key}]`)
            throw e
        }

        if (filterObjects) {
            allObjects = allObjects.filter(filterObjects)
        }
        if (mapObjects) {
            allObjects = allObjects.map(mapObjects)
        }
        allObjects = allObjects.filter(x => x)



        for (let i = 0; i < allObjects.length; i++) {
            const object = allObjects[i]
            if (this.state[key][object.id]) { // Already moved this object over
                skipped += 1
                continue
            }
            let newItem
            try {
                const destinationapi = destination.path(endpoint) as any
                newItem = await destinationapi.method('post').create()({ ...object, project_id: this.destinationId })
                success += 1
                this.state[key][object.id] = newItem.data.id
            } catch (e) {
                if (e.getActualType && e.getActualType()) {
                    console.error(object.id, e.getActualType())
                } else {
                    throw e
                }
                errors += 1
            }
            if (i % 20 === 0) {
                console.log(`[${key}] Progress ${i}/${allObjects.length}`)
            }
        }
        console.log(`[${key}] ${success} moved, ${errors} errored, ${skipped} skipped`)
        await this._state.save()
    }

    private async migrate(api) {
        api({
            parameters: {
                project_id: this.sourceId
            }
        })

    }

    private async paginate(api: any, key: key): Promise<Record<any, any>[]> {
        const response = await api(
            {
                project_id: this.sourceId,
                limit: 100,
                basic: true,
                ...(key === 'insights' ? {order: '-last_modified_at', saved: true} : {})
            }
        )
        if (response.data.next) {
            return await this.recursePaginate(response.data.next, response.data.results)
        } else {
            return response.data.results
        }
    }
    private async recursePaginate(url, data: Record<any, any>[] = [], maxCalls: number = 1000, currentIteration: number = 0): Promise<any> {
        console.log(url)
        const grab = await fetch(url, sourceHeaders)
        const response = await grab.json()
        if (response.next && maxCalls > currentIteration) {
            return this.recursePaginate(response.next, [...data, ...response.results], currentIteration + 1)
        } else {
            return [...data, ...response.results]
        }
    }
}

async function run() {
    const state = new State(options)
    state.loadState()
    if (!state.state.projects) {
        state.state.projects = {}
    }

    const sourceProjects = await source.path('/api/projects/').method('get').create()({})
    for (let i = 0; i < sourceProjects.data.results.length; i++) {
        const project = sourceProjects.data.results[i]
        if(options.projects && options.projects.indexOf(project.id) === -1) {
            continue
        }

        if (!state.state.projects[project.id]) {
            let newproject
            if(options.source === options.destination) {
                project.name = project.name + ' (copy)'
            }

            let newProjectId
            if(options.projectmap[project.id]) {
                newProjectId = options.projectmap[project.id]
            } else {
                try {
                    const { access_control, ...projectWithoutAccessControl } = project
                    newproject = await destination.path('/api/projects/').method('post').create()(projectWithoutAccessControl)
                    newProjectId = newproject.data.id
                } catch (e) {
                    if (e.getActualType && e.getActualType()) {
                        console.error(e.getActualType())
                    }
                    
                    throw e
                }
                if(!newProjectId) {
                    console.error("Could not create project from id " + project.id)
                    console.error("Output:")
                    console.error(newproject)
                    return
                }
            }
            state.state.projects[project.id] = {
                sourceId: project.id,
                destinationId: newProjectId
            }
            await state.save()
        }

        const migrate = new MigrateProjectData(project.id, state.state.projects[project.id].destinationId, state)
        await migrate.run()
    }

}

run()

}


//mixpanel to posthog migration 

async function runMixpanelMigration() {

    // ── Validate ─────────────────────────────────
    const destinationUrl = (options.destination || 'https://app.posthog.com').replace(/\/$/, '')

    if (!options['mixpanel-username']) {
        console.error('--mixpanel-username is required (Service Account username or legacy API Secret)')
        process.exit(1)
    }
    if (options['mixpanel-secret'] === undefined) {
        console.error('--mixpanel-secret is required (use "" for legacy API Secret auth)')
        process.exit(1)
    }
    if (!options['mixpanel-project-id']) {
        console.error('--mixpanel-project-id is required')
        process.exit(1)
    }
    if (!options['posthog-project-key']) {
        console.error('--posthog-project-key is required (Project API key, starts with phc_)')
        console.error('Find it in PostHog → Settings → Project → Project API Key')
        process.exit(1)
    }

    const posthogProjectKey = options['posthog-project-key']
    const isDryRun = options['dry-run']
    const batchSize = options['batch-size'] || 50

    // Determine the PostHog capture/ingest host
    // PostHog capture endpoint is on a different host than the private API:
    //   US cloud: https://us.i.posthog.com
    //   EU cloud: https://eu.i.posthog.com
    //   Self-hosted: same as destination
    let captureHost: string
    if (destinationUrl.includes('eu.posthog.com') || destinationUrl.includes('eu.i.posthog.com')) {
        captureHost = 'https://eu.i.posthog.com'
    } else if (destinationUrl.includes('us.posthog.com') || destinationUrl.includes('app.posthog.com') || destinationUrl.includes('us.i.posthog.com')) {
        captureHost = 'https://us.i.posthog.com'
    } else {
        // Self-hosted: use the destination URL directly
        captureHost = destinationUrl
    }

    if (isDryRun) {
        console.log('\n🧪 DRY RUN MODE — no changes will be made\n')
    }

    console.log('═══ Mixpanel → PostHog User Profile Migration ═══\n')
    console.log(`  Mixpanel project: ${options['mixpanel-project-id']}`)
    console.log(`  PostHog capture:  ${captureHost}`)
    console.log(`  Batch size:       ${batchSize}`)
    console.log('')

    // ── Init Mixpanel client ─────────────────────
    const mixpanel = new MixpanelAPI({
        username: options['mixpanel-username'],
        secret: options['mixpanel-secret'],
        projectId: options['mixpanel-project-id'],
        baseUrl: options['mixpanel-base-url'] || undefined,
    })

    // ── State for idempotency ────────────────────
    const stateManager = new State(options)
    stateManager.loadState()
    if (!stateManager.state.mixpanel_users) {
        stateManager.state.mixpanel_users = {
            migrated_count: 0,
            last_page: -1,
            session_id: null,
        }
    }
    const mstate = stateManager.state.mixpanel_users

    // ── Helpers ──────────────────────────────────
    async function sendBatchToPostHog(events: Record<string, unknown>[]): Promise<void> {
        const response = await fetch(`${captureHost}/batch/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: posthogProjectKey,
                batch: events,
            }),
        })
        if (!response.ok) {
            const text = await response.text()
            throw new Error(`PostHog capture API ${response.status}: ${text}`)
        }
    }

    async function withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn()
            } catch (err: any) {
                if (attempt === maxRetries) throw err
                const delay = 1000 * Math.pow(2, attempt)
                console.warn(`  ⚠️  ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms...`)
                await new Promise(r => setTimeout(r, delay))
            }
        }
        throw new Error('Unreachable')
    }

    // ── Fetch and migrate profiles ───────────────
    console.log('═══ Fetching user profiles from Mixpanel ═══\n')

    let totalProfiles = 0
    let migratedCount = mstate.migrated_count || 0
    let errorCount = 0
    let pageNum = 0

    try {
        for await (const page of mixpanel.iterateAllProfiles({ page_size: 1000 })) {
            if (pageNum === 0) {
                console.log(`  Total profiles in Mixpanel: ${page.total}`)
                totalProfiles = page.total
            }

            const profiles = page.results
            if (profiles.length === 0) break

            console.log(`  Page ${pageNum}: ${profiles.length} profiles`)

            // Transform all profiles on this page into PostHog $set events
            const events = profiles.map(profile =>
                transformProfileToPostHogEvent(profile, posthogProjectKey)
            )

            if (isDryRun) {
                // Show first 3 profiles as preview
                const preview = Math.min(3, profiles.length)
                for (let i = 0; i < preview; i++) {
                    const p = profiles[i]
                    const propCount = Object.keys(p.$properties || {}).length
                    console.log(`    [DRY RUN] ${p.$distinct_id} (${propCount} properties)`)
                }
                if (profiles.length > preview) {
                    console.log(`    ... and ${profiles.length - preview} more`)
                }
                migratedCount += profiles.length
            } else {
                // Send in batches to PostHog /batch endpoint
                for (let i = 0; i < events.length; i += batchSize) {
                    const batch = events.slice(i, i + batchSize)
                    try {
                        await withRetry(
                            () => sendBatchToPostHog(batch),
                            `Batch ${Math.floor(i / batchSize) + 1}`
                        )
                        migratedCount += batch.length
                    } catch (err: any) {
                        console.error(`    ❌ Batch failed: ${err.message}`)
                        errorCount += batch.length
                    }
                }

                // Save progress
                mstate.migrated_count = migratedCount
                mstate.last_page = pageNum
                mstate.session_id = page.session_id
                await stateManager.save()
            }

            pageNum++

            // Rate limiting: Mixpanel Engage API allows 60 queries/hr, 5 concurrent
            await new Promise(r => setTimeout(r, 1500))
        }
    } catch (err: any) {
        console.error(`\n❌ Failed to fetch profiles: ${err.message}`)
        if (migratedCount > 0) {
            console.log(`  (${migratedCount} profiles were migrated before the error)`)
        }
    }

    // ══════════════════════════════════════════════
    // Summary
    // ══════════════════════════════════════════════

    console.log('\n═══ Migration Summary ═══')
    console.log(`  Total in Mixpanel:  ${totalProfiles}`)
    console.log(`  Profiles migrated:  ${migratedCount}`)
    if (errorCount > 0) {
        console.log(`  Errors:             ${errorCount}`)
    }

    if (isDryRun) {
        console.log('\n  ⚠️  Dry run — no changes were made.')
    } else {
        console.log(`\n  ✅ ${migratedCount} user profiles sent to PostHog.`)
        console.log('  Person profiles will appear in PostHog within a few minutes.')
    }

    console.log(`
═══ What was migrated ═══

  Each Mixpanel user profile was sent to PostHog as a $set event,
  which creates or updates a Person profile with all their properties.
  
  Properties were mapped automatically where possible:
    $email → email
    $first_name, $last_name → preserved
    $city → $geoip_city_name
    $country_code → $geoip_country_code
    $os, $browser → preserved
    utm_* → $utm_*
    Custom properties → passed through unchanged

═══ Next steps ═══

  1. Verify profiles in PostHog → People tab
  2. Replace Mixpanel SDK with PostHog SDK in your app
  3. Set up any cohorts/segments in PostHog based on the imported properties
    `)
}