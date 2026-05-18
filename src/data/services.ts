import type {
  Connection,
  HassEntity,
  HassServices,
} from "home-assistant-js-websocket";
import { getServices } from "home-assistant-js-websocket";

const log = (msg: string) => console.error(`[ha-tui:services] ${msg}`);

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Cached services keyed by connection instance (WeakRef avoids leaks) */
let cachedConn: WeakRef<Connection> | null = null;
let cachedServices: HassServices | null = null;

/**
 * Fetch services for all domains (cached per connection).
 * The cache is invalidated when a different connection instance is passed.
 */
export async function fetchAllServices(
  conn: Connection,
): Promise<HassServices> {
  if (cachedConn?.deref() === conn && cachedServices) {
    return cachedServices;
  }

  log("Fetching all services");
  const services = await getServices(conn);
  cachedConn = new WeakRef(conn);
  cachedServices = services;
  return services;
}

/** Clear the services cache (call on disconnect/reconnect) */
export function clearServicesCache(): void {
  cachedConn = null;
  cachedServices = null;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** Domains that support toggle-style actions in Lovelace entities rows. */
const DOMAINS_TOGGLE = new Set([
  "automation",
  "fan",
  "humidifier",
  "input_boolean",
  "light",
  "switch",
  "valve",
  "group",
]);

const STATES_OFF = ["closed", "locked", "off"];
const CLIMATE_SUPPORT_FLAGS_TURN_ON = 4096;

/**
 * Returns the service name used to toggle an entity in the given domain,
 * or `null` if the domain is not toggleable.
 */
export function canToggleEntityState(
  services: HassServices,
  entity: HassEntity,
  getEntityState?: (entityId: string) => HassEntity | undefined,
): boolean {
  const domain = computeDomain(entity.entity_id);

  if (domain === "group") {
    const groupMembers = entity.attributes.entity_id;
    if (!Array.isArray(groupMembers)) {
      return false;
    }

    const hasToggleableMember = groupMembers.some((entityId) => {
      const member = getEntityState?.(entityId);
      return member
        ? canToggleDomain(services, computeDomain(member.entity_id))
        : false;
    });

    return (
      hasToggleableMember && (entity.state === "on" || entity.state === "off")
    );
  }

  if (domain === "climate") {
    return (
      supportsFeature(entity, CLIMATE_SUPPORT_FLAGS_TURN_ON) &&
      canToggleDomain(services, domain)
    );
  }

  return canToggleDomain(services, domain);
}

/**
 * Check whether a domain has any callable services.
 * Returns false for read-only domains (sensor, binary_sensor, etc.)
 */
export function domainHasServices(
  services: HassServices,
  domain: string,
): boolean {
  const domainServices = services[domain];
  if (!domainServices) return false;
  return Object.keys(domainServices).length > 0;
}

/**
 * Get the list of services for a domain, sorted with toggle first.
 * Returns an array of `{ serviceId, name, description, fields, hasTarget }`.
 */
export function getServicesForDomain(
  services: HassServices,
  domain: string,
): ServiceInfo[] {
  const domainServices = services[domain];
  if (!domainServices) return [];

  const toggleName = getToggleServiceName(domain);
  const result: ServiceInfo[] = [];

  for (const [serviceId, service] of Object.entries(domainServices)) {
    result.push({
      serviceId,
      name: service.name ?? serviceId,
      description: service.description ?? "",
      fields: service.fields,
      hasTarget: service.target != null,
    });
  }

  // Sort: toggle service first, then alphabetically by name
  result.sort((a, b) => {
    if (toggleName) {
      if (a.serviceId === toggleName) return -1;
      if (b.serviceId === toggleName) return 1;
    }
    return a.name.localeCompare(b.name);
  });

  return result;
}

function getToggleServiceName(domain: string): string | null {
  if (domain === "lock") {
    return "lock";
  }

  if (domain === "cover") {
    return "open_cover";
  }

  if (domain === "valve") {
    return "open_valve";
  }

  if (DOMAINS_TOGGLE.has(domain) || domain === "climate") {
    return "turn_on";
  }

  return null;
}

export function getToggleAction(
  entity: HassEntity,
): { domain: string; service: string; turnOn: boolean } | null {
  const domain = computeDomain(entity.entity_id);
  const turnOn = !isOn(entity);

  if (domain === "lock") {
    return { domain: "lock", service: turnOn ? "unlock" : "lock", turnOn };
  }

  if (domain === "cover") {
    return {
      domain: "cover",
      service: turnOn ? "open_cover" : "close_cover",
      turnOn,
    };
  }

  if (domain === "valve") {
    return {
      domain: "valve",
      service: turnOn ? "open_valve" : "close_valve",
      turnOn,
    };
  }

  if (domain === "group") {
    return {
      domain: "homeassistant",
      service: turnOn ? "turn_on" : "turn_off",
      turnOn,
    };
  }

  if (domain === "climate") {
    return {
      domain: "climate",
      service: turnOn ? "turn_on" : "turn_off",
      turnOn,
    };
  }

  if (DOMAINS_TOGGLE.has(domain)) {
    return {
      domain,
      service: turnOn ? "turn_on" : "turn_off",
      turnOn,
    };
  }

  return null;
}

function computeDomain(entityId: string): string {
  return entityId.split(".")[0] ?? "";
}

function canToggleDomain(services: HassServices, domain: string): boolean {
  const domainServices = services[domain];
  if (!domainServices) {
    return false;
  }

  if (domain === "lock") {
    return "lock" in domainServices;
  }

  if (domain === "cover") {
    return "open_cover" in domainServices;
  }

  if (domain === "valve") {
    return "open_valve" in domainServices;
  }

  return "turn_on" in domainServices;
}

function supportsFeature(entity: HassEntity, feature: number): boolean {
  const supported = entity.attributes.supported_features;
  return typeof supported === "number" && (supported & feature) !== 0;
}

function isOn(entity: HassEntity): boolean {
  return !STATES_OFF.includes(entity.state) && entity.state !== "unavailable";
}

/**
 * Determine which fields are required for a service call.
 * Returns only fields that have `required: true`.
 */
export function getRequiredFields(
  fields: Record<string, ServiceFieldInfo>,
): ServiceFieldEntry[] {
  const entries: ServiceFieldEntry[] = [];
  for (const [fieldId, field] of Object.entries(fields)) {
    if (field.required) {
      entries.push({ fieldId, ...field });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceInfo {
  readonly serviceId: string;
  readonly name: string;
  readonly description: string;
  readonly fields: Record<string, ServiceFieldInfo>;
  readonly hasTarget: boolean;
}

export interface ServiceFieldInfo {
  readonly example?: string | boolean | number;
  readonly default?: unknown;
  readonly required?: boolean;
  readonly advanced?: boolean;
  readonly selector?: Record<string, unknown>;
  readonly filter?: {
    readonly supported_features?: number[];
    readonly attribute?: Record<string, unknown[]>;
  };
  readonly name?: string;
  readonly description?: string;
}

export interface ServiceFieldEntry extends ServiceFieldInfo {
  readonly fieldId: string;
}
