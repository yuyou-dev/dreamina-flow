import {
  buildWorkflowDownloadPayload,
  parseWorkflowDocumentText,
  prepareStarterWorkflowDocument,
  prepareWorkflowDocumentImport,
  type PreparedWorkflowDocument,
  type WorkflowDocumentPreparation,
  type WorkflowDownloadPayload,
} from "@workflow-studio/workflow-core";

export type {
  PreparedWorkflowDocument,
  WorkflowDocumentPreparation,
  WorkflowDownloadPayload,
};

export interface FailedWorkflowDocumentPreparation {
  ok: false;
  error: string;
  warnings: string[];
}

export function isWorkflowDocumentPreparationFailure(
  preparation: WorkflowDocumentPreparation,
): preparation is FailedWorkflowDocumentPreparation {
  return preparation.ok === false;
}

export {
  buildWorkflowDownloadPayload,
  parseWorkflowDocumentText,
  prepareStarterWorkflowDocument,
  prepareWorkflowDocumentImport,
};
