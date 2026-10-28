import type {
  BoardValidationCatalog,
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
        ...(field.unit === undefined ? {} : { unit: field.unit.unit }),
        timezone: field.timezone ?? descriptor.timezone,
        operators: field.operators ?? descriptor.capabilities.filterOperators,
      });
    }
    const slices: Record<string, readonly string[]> = Object.create(null) as Record<
      string,
      readonly string[]
    >;
    for (const slice of descriptor.slices) {
      setOwn(slices, slice.id, slice.fieldIds ?? descriptor.fields.map((field) => field.id));
    }
    setOwn(catalogDatasets, descriptor.id, { fields, slices });
  }
  return Object.freeze({ datasets: Object.freeze(catalogDatasets) });
}
