import { MixpanelEngageResponse } from './types'

// MixpanelAPI - reads user profiles from a Mixpanel project.
// Docs: https://developer.mixpanel.com/reference/engage-query

//init of mixpanel API 
export class MixpanelAPI {
  private baseUrl: string
  private authHeader: string
  private projectId: string

  constructor(config: {
    username: string
    secret: string
    projectId: string
    baseUrl?: string
  }) {
    this.baseUrl = config.baseUrl || 'https://mixpanel.com/api'
    this.projectId = config.projectId

    const credentials = Buffer.from(
      `${config.username}:${config.secret}`
    ).toString('base64')
    this.authHeader = `Basic ${credentials}`
  }

//query profiles
  async queryProfiles(params?: {
    where?: string
    session_id?: string
    page?: number
    page_size?: number
    output_properties?: string[]
    filter_by_cohort?: string
  }): Promise<MixpanelEngageResponse> {
    const url = new URL(`${this.baseUrl}/query/engage`)
    url.searchParams.set('project_id', this.projectId)

    //build body 
    const formParts: string[] = []
    if (params?.where) {
      formParts.push(`where=${encodeURIComponent(params.where)}`)
    }
    if (params?.session_id) {
      formParts.push(`session_id=${encodeURIComponent(params.session_id)}`)
    }
    if (params?.page !== undefined) {
      formParts.push(`page=${params.page}`)
    }
    if (params?.page_size) {
      formParts.push(`page_size=${params.page_size}`)
    }
    if (params?.output_properties) {
      formParts.push(
        `output_properties=${encodeURIComponent(JSON.stringify(params.output_properties))}`
      )
    }
    if (params?.filter_by_cohort) {
      formParts.push(`filter_by_cohort=${encodeURIComponent(params.filter_by_cohort)}`)
    }

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formParts.join('&') || undefined,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Mixpanel Engage API error ${response.status}: ${body}`
      )
    }

    return response.json() as Promise<MixpanelEngageResponse>
  }

  // api response is in {'results': [{},{}]} -- this will paginate through the response 
  async *iterateAllProfiles(params?: {
    where?: string
    page_size?: number
    output_properties?: string[]
    filter_by_cohort?: string
  }): AsyncGenerator<MixpanelEngageResponse> {
    let sessionId: string | undefined
    let page = 0
    let total = 0

    while (true) {
      const response = await this.queryProfiles({
        ...params,
        session_id: sessionId,
        page,
      })

      yield response

      total = response.total
      sessionId = response.session_id
      const fetched = (page + 1) * response.page_size

      if (response.results.length === 0 || fetched >= total) {
        break
      }

      page++
    }
  }
}