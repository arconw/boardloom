import type {
  BoardValidationCatalog,
  ProviderDatasetCapabilities,
  ProviderDatasetDescriptor,
  ProviderFieldDescriptor,
} from "./board-validation-shared.js";
import type { DatasetDescriptor } from "./data-contract.js";

function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
}

export function createBoardValidationCatalog(
  datasets: readonly DatasetDescriptor[],
): BoardValidationCatalog {
  const catalogDatasets: Record<string, ProviderDatasetDescriptor> = Object.create(null) as Record<
    string,
    ProviderDatasetDescriptor
  >;
  for (const descriptor of datasets) {
    const fields: Record<string, ProviderFieldDescriptor> = Object.create(null) as Record<
      string,
      ProviderFieldDescriptor
    >;
    for (const field of descriptor.fields) {
      setOwn(fields, field.id, {
        type: field.type,
        role: field.role === "temporal" ? "dimension" : field.role,
        ...(field.label === undefined ? {} : { label: field.label }),
        ...(field.unit === undefined ? {} : { unit: field.unit.unit }),
        timezone: field.timezone ?? descriptor.timezone,
        operators: field.operators ?? descriptor.capabilities.filterOperators,
        ...(field.allowedValues === undefined ? {} : { allowedValues: field.allowedValues }),
      });
    }
    const slices: Record<string, readonly string[]> = Object.create(null) as Record<
      string,
      readonly string[]
    >;
    for (const slice of descriptor.slices) {
      setOwn(slices, slice.id, slice.fieldIds ?? descriptor.fields.map((field) => field.id));
    }
    setOwn(catalogDatasets, descriptor.id, {
      fields,
      slices,
      capabilities: {
        grouping: descriptor.capabilities.grouping,
        aggregations: descriptor.capabilities.aggregations,
        timeWindow: descriptor.capabilities.timeWindow,
        timezoneConversion: descriptor.capabilities.timezoneConversion,
        comparison: descriptor.capabilities.comparison,
        maxResultSize: descriptor.capabilities.maxResultSize,
      },
    });
  }
  return Object.freeze({ datasets: Object.freeze(catalogDatasets) });
}

function ownValue<T>(value: Record<string, unknown>, key: string): T | undefined {
  return Object.hasOwn(value, key) ? (value[key] as T) : undefined;
}

function mergeBoolean(
  base: boolean | undefined,
  provider: boolean | undefined,
): boolean | undefined {
  if (base === false || provider === false) {
    return false;
  }
  if (base === true || provider === true) {
    return true;
  }
  return undefined;
}

function mergeCapabilities(
  base: ProviderDatasetCapabilities | undefined,
  provider: ProviderDatasetCapabilities | undefined,
): ProviderDatasetCapabilities | undefined {
  const grouping = mergeBoolean(base?.grouping, provider?.grouping);
  const timeWindow = mergeBoolean(base?.timeWindow, provider?.timeWindow);
  const timezoneConversion = mergeBoolean(base?.timezoneConversion, provider?.timezoneConversion);
  const comparison = mergeBoolean(base?.comparison, provider?.comparison);
  const aggregations =
    base?.aggregations === undefined
      ? provider?.aggregations
      : provider?.aggregations === undefined
        ? base.aggregations
        : Object.freeze(
            provider.aggregations.filter((aggregation) => base.aggregations?.includes(aggregation)),
          );
  const maxResultSize =
    base?.maxResultSize === undefined
      ? provider?.maxResultSize
      : provider?.maxResultSize === undefined
        ? base.maxResultSize
        : base.maxResultSize === null
          ? provider.maxResultSize
          : provider.maxResultSize === null
            ? base.maxResultSize
            : Math.min(base.maxResultSize, provider.maxResultSize);
  if (
    grouping === undefined &&
    aggregations === undefined &&
    timeWindow === undefined &&
    timezoneConversion === undefined &&
    comparison === undefined &&
    maxResultSize === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(grouping === undefined ? {} : { grouping }),
    ...(aggregations === undefined ? {} : { aggregations }),
    ...(timeWindow === undefined ? {} : { timeWindow }),
    ...(timezoneConversion === undefined ? {} : { timezoneConversion }),
    ...(comparison === undefined ? {} : { comparison }),
    ...(maxResultSize === undefined ? {} : { maxResultSize }),
  });
}

function mergeDatasetEntry(
  base: ProviderDatasetDescriptor | undefined,
  provider: ProviderDatasetDescriptor,
): ProviderDatasetDescriptor {
  const baseRecord = base === undefined ? undefined : (base as unknown as Record<string, unknown>);
  const baseFields =
    baseRecord !== undefined && Object.hasOwn(baseRecord, "fields")
      ? ownValue<ProviderDatasetDescriptor["fields"]>(baseRecord, "fields")
      : undefined;
  const baseSlices =
    baseRecord !== undefined && Object.hasOwn(baseRecord, "slices")
      ? ownValue<ProviderDatasetDescriptor["slices"]>(baseRecord, "slices")
      : undefined;
  const fields = baseFields ?? provider.fields;
  const slices = baseSlices ?? provider.slices;
  const capabilities = mergeCapabilities(base?.capabilities, provider.capabilities);
  return Object.freeze({
    ...(fields === undefined ? {} : { fields }),
    ...(slices === undefined ? {} : { slices }),
    ...(capabilities === undefined ? {} : { capabilities }),
  });
}

export function createEffectiveValidationCatalog(
  catalog: BoardValidationCatalog | undefined,
  datasets: readonly DatasetDescriptor[],
): BoardValidationCatalog | undefined {
  if (datasets.length === 0) {
    return catalog;
  }
  const providerCatalog = createBoardValidationCatalog(datasets);
  if (catalog === undefined) {
    return providerCatalog;
  }
  const baseDatasets = catalog.datasets;
  const merged: Record<string, ProviderDatasetDescriptor> = Object.create(null) as Record<
    string,
    ProviderDatasetDescriptor
  >;
  if (baseDatasets !== undefined) {
    for (const datasetId of Object.getOwnPropertyNames(baseDatasets)) {
      if (Object.hasOwn(providerCatalog.datasets, datasetId)) {
        continue;
      }
      const entry = ownValue<ProviderDatasetDescriptor>(baseDatasets, datasetId);
      if (entry !== undefined) {
        setOwn(merged, datasetId, entry);
      }
    }
  }
  for (const datasetId of Object.getOwnPropertyNames(providerCatalog.datasets)) {
    const provider = ownValue<ProviderDatasetDescriptor>(providerCatalog.datasets, datasetId);
    if (provider === undefined) {
      continue;
    }
    const base =
      baseDatasets === undefined
        ? undefined
        : ownValue<ProviderDatasetDescriptor>(baseDatasets, datasetId);
    setOwn(merged, datasetId, mergeDatasetEntry(base, provider));
  }
  return Object.freeze({
    datasets: Object.freeze(merged),
    ...(catalog.blockTypes === undefined
      ? {}
      : { blockTypes: Object.freeze([...catalog.blockTypes]) }),
    ...(catalog.conversionProviders === undefined
      ? {}
      : { conversionProviders: Object.freeze([...catalog.conversionProviders]) }),
  });
}

export function createProviderCapabilitiesCatalog(
  datasets: readonly DatasetDescriptor[],
): BoardValidationCatalog | undefined {
  if (datasets.length === 0) {
    return undefined;
  }
  const catalogDatasets: Record<string, ProviderDatasetDescriptor> = Object.create(null) as Record<
    string,
    ProviderDatasetDescriptor
  >;
  for (const descriptor of datasets) {
    setOwn(catalogDatasets, descriptor.id, {
      capabilities: {
        grouping: descriptor.capabilities.grouping,
        aggregations: descriptor.capabilities.aggregations,
        timeWindow: descriptor.capabilities.timeWindow,
        timezoneConversion: descriptor.capabilities.timezoneConversion,
        comparison: descriptor.capabilities.comparison,
        maxResultSize: descriptor.capabilities.maxResultSize,
      },
    });
  }
  return Object.freeze({ datasets: Object.freeze(catalogDatasets) });
}
