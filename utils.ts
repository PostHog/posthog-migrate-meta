import * as fs from 'fs'
import * as crypto from 'crypto'

export const replaceCohortsRecurse = function(object, state) {
        if (Array.isArray(object)) {
            for (let i = 0; i < object.length; i++) {
                replaceCohortsRecurse(object[i], state);
            }
        }
        else if (typeof object === "object" && object) {
            if(object['type'] && object.type === 'cohort' && object['value']) {
                if(!state[object['value']]) {
                    throw Error(`Not moving object that contains cohort ${object.value}. Might be a static cohort.`)
                }
                object.value = state[object['value']]
            } else {
                for (const key in object) {
                    replaceCohortsRecurse(object[key], state);
                }
            }
        }
    }

export class State {
    state: Record<any, any>
    options: Record<any, any>
    fileName: string

    constructor(options) {
        this.options = options
        this.fileName = this.getFileName()
    }
    private getFileName() {
        // For Mixpanel migrations, source/sourcekey won't exist — use mixpanel options instead
        const parts = this.options['source-type'] === 'mixpanel'
            ? (this.options['mixpanel-username'] || '') + (this.options['mixpanel-project-id'] || '') + (this.options.destination || '') + (this.options.destinationkey || '')
            : (this.options.source || '') + (this.options.sourcekey || '') + (this.options.destination || '') + (this.options.destinationkey || '')
        const hash = crypto.createHash('sha256').update(parts).digest('hex');
        return `_state_${hash}.json`
    }

    public async loadState(): Promise<void> {
        this.state = {}
        if (fs.existsSync(this.fileName)) {
            const state = await fs.promises.readFile(this.fileName, 'utf8');
            this.state = JSON.parse(state)
        }
    }

    public async save(): Promise<void> {
        await fs.promises.writeFile(this.fileName, JSON.stringify(this.state));
    }
}