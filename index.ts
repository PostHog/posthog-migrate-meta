// import 'whatwg-fetch'
import './fetch-polyfill'



import { Fetcher, Middleware } from 'openapi-typescript-fetch'

import { paths } from './posthogapi'
import { replaceCohortsRecurse, State } from './utils';
import * as commandLineArgs from 'command-line-args'


const options = commandLineArgs([
    { name: 'destination', type: String },
    { name: 'destinationkey', type: String },
    { name: 'source', type: String },
    { name: 'sourcekey', type: String },
    { name: 'projects', type: Number, multiple: true },
    { name: 'projectmap', type: String, multiple: true },
])
if(!options.destination) {
    options.destination = 'https://app.posthog.com'
}
if(!options.source) {
    options.source = 'https://app.posthog.com'
}
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
                    console.warn(`Cohort with ID ${object.id} skipped, as it's a static cohort. Please move this one manually.`)
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
                    newproject = await destination.path('/api/projects/').method('post').create()(project)
                    newProjectId = newproject.data.id
                } catch (e) {
                    if (e.getActualType && e.getActualType()) {
                        console.error(e.getActualType())
                    }
                    throw e
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
