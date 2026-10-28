import type {
  DatasetDescriptor,
  DatasetProvider,
  LocalDatasetSource,
  QueryFilter,
} from "../../../../packages/core/src/index.js";
import {
  QUERY_OPERATIONS,
  createLocalDatasetProvider,
  queryFilterKey,
} from "../../../../packages/core/src/index.js";

const FIELD_IDS = [
  "student_id",
  "school_id",
  "class_id",
  "subject",
  "submitted_at",
  "score",
  "attendance_rate",
] as const;

export const ASSESSMENT_ROWS = Object.freeze([
  Object.freeze({
    student_id: "student-01",
    school_id: "north",
    class_id: "north-1",
    subject: "math",
    submitted_at: "2026-09-30T23:30:00Z",
    score: 10,
    attendance_rate: 0.9,
  }),
  Object.freeze({
    student_id: "student-02",
    school_id: "north",
    class_id: "north-1",
    subject: "math",
    submitted_at: "2026-10-01T00:30:00Z",
    score: 0,
    attendance_rate: 1,
  }),
  Object.freeze({
    student_id: "student-03",
    school_id: "south",
    class_id: "south-2",
    subject: "reading",
    submitted_at: "2026-10-01T12:00:00Z",
    score: 7.5,
    attendance_rate: null,
  }),
  Object.freeze({
    student_id: "student-04",
    school_id: "south",
    class_id: "south-2",
    subject: "reading",
    submitted_at: "2026-10-02T01:00:00Z",
    score: null,
    attendance_rate: 0.8,
  }),
  Object.freeze({
    student_id: "student-05",
    school_id: "east",
    class_id: "east-3",
    subject: "science",
    submitted_at: "2026-10-02T15:00:00Z",
    score: 5,
    attendance_rate: 0.95,
  }),
  Object.freeze({
    student_id: "student-06",
    school_id: "east",
    class_id: "east-3",
    subject: "science",
    submitted_at: "2026-10-03T22:30:00Z",
    score: 2,
    attendance_rate: 0.5,
  }),
  Object.freeze({
    student_id: "student-07",
    school_id: "north",
    class_id: "north-1",
    subject: "science",
    submitted_at: "2026-10-04T00:00:00Z",
    score: 8,
    attendance_rate: 0.85,
  }),
  Object.freeze({
    student_id: "student-08",
    school_id: "east",
    class_id: "east-3",
    subject: "math",
    submitted_at: "2026-10-05T03:00:00Z",
    score: 0,
    attendance_rate: 1,
  }),
]);

export const ASSESSMENT_DESCRIPTOR: DatasetDescriptor = Object.freeze({
  id: "assessment-results",
  label: "Synthetic school assessment results",
  version: "2026.1",
  timezone: "UTC",
  temporalRepresentation: "iso8601-offset",
  fields: Object.freeze([
    Object.freeze({
      id: "student_id",
      key: "student_id",
      label: "Student",
      type: "string",
      role: "dimension",
      nullable: false,
    }),
    Object.freeze({
      id: "school_id",
      key: "school_id",
      label: "School",
      type: "string",
      role: "dimension",
      nullable: false,
      allowedValues: Object.freeze(["north", "south", "east"]),
    }),
    Object.freeze({
      id: "class_id",
      key: "class_id",
      label: "Class",
      type: "string",
      role: "dimension",
      nullable: false,
    }),
    Object.freeze({
      id: "subject",
      key: "subject",
      label: "Subject",
      type: "string",
      role: "dimension",
      nullable: false,
      allowedValues: Object.freeze(["math", "reading", "science"]),
    }),
    Object.freeze({
      id: "submitted_at",
      key: "submitted_at",
      label: "Submitted at",
      type: "datetime",
      role: "temporal",
      nullable: false,
      timezone: "UTC",
      temporalRepresentation: "iso8601-offset",
    }),
    Object.freeze({
      id: "score",
      key: "score",
      label: "Score",
      type: "number",
      role: "measure",
      nullable: true,
      unit: Object.freeze({ unit: "points", label: "points" }),
    }),
    Object.freeze({
      id: "attendance_rate",
      key: "attendance_rate",
      label: "Attendance rate",
      type: "number",
      role: "measure",
      nullable: true,
      unit: Object.freeze({ unit: "percent", scale: 100, label: "percent" }),
    }),
  ]),
  slices: Object.freeze([
    Object.freeze({
      id: "all-results",
      datasetId: "assessment-results",
      label: "All results",
      fieldIds: Object.freeze([...FIELD_IDS]),
      supportedOperations: Object.freeze([...QUERY_OPERATIONS]),
    }),
    Object.freeze({
      id: "summary",
      datasetId: "assessment-results",
      label: "Summary slice",
      fieldIds: Object.freeze(["school_id", "subject", "submitted_at", "score"]),
      supportedOperations: Object.freeze([
        "project",
        "filter",
        "group",
        "aggregate",
        "order",
        "limit",
      ] as const),
    }),
  ]),
  capabilities: Object.freeze({
    grouping: true,
    aggregations: Object.freeze([
      "count",
      "countDistinct",
      "sum",
      "average",
      "min",
      "max",
      "median",
      "mode",
    ] as const),
    filterOperators: Object.freeze([
      "equals",
      "notEquals",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "between",
      "in",
      "notIn",
      "contains",
      "isNull",
      "isNotNull",
      "before",
      "after",
      "onOrBefore",
      "onOrAfter",
    ] as const),
    timeWindow: true,
    timezoneConversion: true,
    local: true,
    pushdownFilters: true,
    serverPaging: false,
    realtime: false,
    comparison: false,
    maxResultSize: null,
  }),
});

export const ASSESSMENT_SOURCE: LocalDatasetSource = Object.freeze({
  descriptor: ASSESSMENT_DESCRIPTOR,
  rows: ASSESSMENT_ROWS,
});

export function cloneAssessmentDescriptor(
  overrides: Partial<DatasetDescriptor> = {},
): DatasetDescriptor {
  return {
    ...ASSESSMENT_DESCRIPTOR,
    ...overrides,
    fields: overrides.fields ?? ASSESSMENT_DESCRIPTOR.fields,
    slices: overrides.slices ?? ASSESSMENT_DESCRIPTOR.slices,
    capabilities: overrides.capabilities ?? ASSESSMENT_DESCRIPTOR.capabilities,
  };
}

export function createAssessmentProvider(
  descriptor: DatasetDescriptor = ASSESSMENT_DESCRIPTOR,
): DatasetProvider {
  const provider = createLocalDatasetProvider({
    providerId: "assessment-fixture",
    datasets: [{ descriptor, rows: ASSESSMENT_ROWS }],
  });
  if (!provider.ok) {
    throw new Error(provider.diagnostics.map((diagnostic) => diagnostic.code).join(", "));
  }
  return provider.value;
}

export function appliedFilters(filters: readonly QueryFilter[]): readonly string[] {
  return Object.freeze(filters.map(queryFilterKey));
}
