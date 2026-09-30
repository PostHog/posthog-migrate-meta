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

export const replaceActionsRecurse = function(object, state) {
        if (Array.isArray(object)) {
            for (let i = 0; i < object.length; i++) {
                replaceActionsRecurse(object[i], state);
            }
        }
        else if (typeof object === "object" && object) {
            // Legacy filters use `type: 'actions'`, queries use `kind: 'ActionsNode'`
            if ((object.kind === 'ActionsNode' || object.type === 'actions') && object.id !== undefined) {
                if(!state[object.id]) {
                    throw Error(`Not moving object that contains action ${object.id}.`)
                }
                object.id = state[object.id]
            }
            for (const key in object) {
                replaceActionsRecurse(object[key], state);
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
        const hash = crypto.createHash('sha256').update(this.options.source + this.options.sourcekey + this.options.destination + this.options.destinationkey).digest('hex');
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
 