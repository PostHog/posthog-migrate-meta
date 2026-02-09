// Mixpanel Types 

export interface MixpanelProfile {
  $distinct_id: string
  $properties: Record<string, unknown>
}

export interface MixpanelEngageResponse {
  page: number
  page_size: number
  results: MixpanelProfile[]
  session_id: string
  status: string
  total: number
}