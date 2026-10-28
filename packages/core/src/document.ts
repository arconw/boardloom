import { DIAGNOSTIC_CODES, createDiagnostic, hasError, type Diagnostic } from "./diagnostics.js";
import {
  cloneJson,
  freezeJson,
  isPlainObject,
  validateJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js";

export type BoardDocument = JsonObject;

export interface DocumentValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export type DocumentValidator = (document: unknown) => DocumentValidation;

export const defaultDocumentValidator: DocumentValidator = (document) => {
  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(document)) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, "", {
        message: "A board document must be a JSON object.",
      }),
    );
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  }

  const jsonResult = validateJsonValue(document);
  for (const issue of jsonResult.issues) {
    diagnostics.push(
      createDiagnostic(DIAGNOSTIC_CODES.DOCUMENT_INVALID, issue.path, {
        message: issue.message,
      }),
    );
  }

  return Object.freeze({
    valid: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics),
  });
};

export function snapshotDocument(document: BoardDocument): BoardDocument {
  return freezeJson(cloneJson(document));
}

export function documentSchemaVersion(document: BoardDocument): number | null {
  const value: JsonValue | undefined = document.schemaVersion;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function isBlockingValidation(validation: DocumentValidation): boolean {
  return !validation.valid || hasError(validation.diagnostics);
}

export function validationWarnings(validation: DocumentValidation): readonly Diagnostic[] {
  return Object.freeze(
    validation.diagnostics.filter((diagnostic) => diagnostic.severity === "warning"),
  );
}
