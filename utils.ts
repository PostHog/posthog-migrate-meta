import * as fs from 'fs'

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

    public async loadState(): Promise<void> {
        this.state = {}
        if (fs.existsSync('state.json')) {
            const state = await fs.promises.readFile('state.json', 'utf8');
            this.state = JSON.parse(state)
        }
    }

    public async save(): Promise<void> {
        await fs.promises.writeFile('state.json', JSON.stringify(this.state));
    }
}
 