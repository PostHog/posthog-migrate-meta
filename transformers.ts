import { MixpanelProfile } from './types'

/*
 * PostHog capture docs: https://posthog.com/docs/api/capture
 */

export function transformProfileToPostHogEvent(
  profile: MixpanelProfile,
  projectApiKey: string
): Record<string, unknown> {
  const distinctId = String(profile.$distinct_id)
  const props = profile.$properties || {}

  // Map Mixpanel properties to PostHog equivalents
  const mappedProps: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    // Skip internal Mixpanel properties
    if (SKIP_PROPERTIES.has(key)) continue

    const mappedKey = mapPropertyName(key)
    mappedProps[mappedKey] = value
  }

  return {
    api_key: projectApiKey,
    event: '$set',
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      distinct_id: distinctId,
      $set: mappedProps,
    },
  }
}

/**
 * Map Mixpanel to PostHog equivalents.
 */
export function mapPropertyName(mixpanelProp: string): string {
  return PROPERTY_MAP[mixpanelProp] || mixpanelProp
}

// we can skip these properites since they already exist in posthog
const SKIP_PROPERTIES = new Set([
  '$distinct_id',     
  '$mp_api_endpoint',
  '$mp_api_timestamp_ms',
  '$import',
  '$bucket_key',
])

// map the names of the properties 
const PROPERTY_MAP: Record<string, string> = {
  '$first_name': '$first_name',  
  '$last_name': '$last_name',
  '$name': 'name',
  '$email': 'email',
  '$phone': 'phone',
  '$avatar': '$avatar',
  '$city': '$geoip_city_name',
  '$region': '$geoip_subdivision_1_name',
  '$country_code': '$geoip_country_code',
  'mp_country_code': '$geoip_country_code',
  '$timezone': '$timezone',
  '$os': '$os',
  '$browser': '$browser',
  '$browser_version': '$browser_version',
  '$device': '$device_type',
  '$screen_height': '$screen_height',
  '$screen_width': '$screen_width',
  '$initial_referrer': '$initial_referrer',
  '$initial_referring_domain': '$initial_referring_domain',
  'utm_source': '$utm_source',
  'utm_medium': '$utm_medium',
  'utm_campaign': '$utm_campaign',
  'utm_content': '$utm_content',
  'utm_term': '$utm_term',
  '$created': '$created_at',
  '$last_seen': '$last_seen',
  '$lib': '$lib',
  '$lib_version': '$lib_version',
  'mp_lib': '$lib',
}