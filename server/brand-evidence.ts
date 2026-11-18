import type { Job, PageSummary, Project } from "./contracts.js";
import { competitorEvidence, measurementMetrics, recheckComparison } from "./analysis.js";
import { workspacePresentation } from "./presentation.js";
import { displayedMeasurement } from "./portable-results.js";
import type { Store } from "./storage.js";

/**
 * The brand view's evidence from one set of brand checks: the displayed check, its answers, metrics, presentation,
 * recheck comparison and competitors. The workspace passes every engine's checks; an engine view passes one
 * engine's, so both read the evidence the same way.
 */
export function brandEvidence(store: Store, project: Project, brandJobs: Job[], pages: PageSummary[] = []) {
  const measure = displayedMeasurement(brandJobs, (job) => store.answerCount(project.id, job.id));
  const observations = measure ? store.observations(project.id, measure.id) : [];
  const snapshot = measure ? store.step(measure.id, "project") : undefined;
  const prompts: string[] = snapshot?.body ? JSON.parse(snapshot.body).prompts : project.prompts;
  const metrics = measurementMetrics(measure, observations, measure ? prompts.length : 0);
  const presentation = workspacePresentation(brandJobs, measure, observations,
    snapshot?.body ? prompts : measure ? null : project.prompts, metrics.requested, pages);
  return {
    measure,
    observations,
    metrics,
    presentation,
    comparison: recheckComparison(brandJobs),
    competitors: competitorEvidence(project, observations),
  };
}
