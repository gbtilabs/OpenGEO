import type { Job, Project } from "./contracts.js";
import { brandEvidence } from "./brand-evidence.js";
import { sourceCoverage } from "./presentation.js";
import { analysisBasisCheck, completedMeasurement, measurementTime, portableJobResult } from "./portable-results.js";
import { publicJob, publicObservation } from "./public-results.js";
import type { Store } from "./storage.js";
import { withTopicChecks } from "./topics.js";
import { engineChoice, engineKey, type EngineChoice } from "./engine-key.js";

export { engineChoice, engineKey, engineParam, type EngineChoice } from "./engine-key.js";

const choiceKey = (projectId: string) => "engineChoice:" + projectId;
export function savedEngineChoice(store: Store, projectId: string): EngineChoice | null {
  const saved = engineChoice.safeParse(store.setting<unknown>(choiceKey(projectId), null));
  return saved.success ? saved.data : null;
}
export function saveEngineChoice(store: Store, projectId: string, choice: EngineChoice) {
  store.project(projectId);
  store.set(choiceKey(projectId), choice);
  return choice;
}

const isCheck = (job: Job) => ["measure", "recheck"].includes(job.kind) && completedMeasurement(job);

function checkSummary(store: Store, project: Project, job: Job) {
  const metrics = portableJobResult(job)?.metrics;
  const observations = store.observations(project.id, job.id);
  return {
    jobId: job.id,
    at: measurementTime(job),
    requested: metrics?.requested ?? job.requestedAnswers ?? observations.length,
    completed: metrics?.completed ?? observations.length,
    missing: metrics?.missing ?? 0,
    mentioned: observations.filter((answer) => answer.mentioned).length,
    cited: observations.filter((answer) => answer.cited).length,
    topCited: sourceCoverage(observations).domains.slice(0, 3).map((domain) => ({ domain: domain.key, answers: domain.answers })),
  };
}

/**
 * One entry per engine with a completed check: its latest brand check, or its latest topic check when it has
 * no brand check yet. Each engine stands alone; nothing here adds engines together.
 */
export function engineSummaries(store: Store, project: Project, jobs: Job[]) {
  const groups = new Map<string, Job[]>();
  for (const job of jobs.filter(isCheck)) groups.set(engineKey(job), [...(groups.get(engineKey(job)) ?? []), job]);
  const schedules = store.setting<{ job?: { projectId?: string; provider?: string; platform?: string; topicId?: string }; nextAt?: string }[]>("schedules", []);
  const names = new Map(project.topics.map((topic) => [topic.id, topic.name]));
  return [...groups].map(([key, checks]) => {
    const brand = checks.find((job) => !job.topicId), topic = brand ? undefined : checks[0];
    const next = schedules
      .filter((row) => row.job?.projectId === project.id && !row.job.topicId && row.nextAt && engineKey({ provider: row.job.provider, platform: row.job.platform }) === key)
      .map((row) => row.nextAt!).sort()[0] ?? null;
    return {
      key,
      provider: checks[0].provider ?? "chatgpt",
      platform: key.slice(key.indexOf(":") + 1),
      latest: brand ? checkSummary(store, project, brand) : null,
      topicCheck: topic ? { ...checkSummary(store, project, topic), topicId: topic.topicId!, topic: names.get(topic.topicId!) ?? "Removed topic" } : null,
      preparesRecommendations: !!brand && analysisBasisCheck(brand),
      nextRunAt: next,
    };
  }).sort((a, b) => Date.parse((b.latest ?? b.topicCheck)!.at) - Date.parse((a.latest ?? a.topicCheck)!.at));
}
export type EngineSummary = ReturnType<typeof engineSummaries>[number];

/** The brand view for one engine: its own displayed check, trend, recheck comparison and competitors. */
export function engineView(store: Store, project: Project, key: string) {
  const jobs = store.jobs(project.id).filter((job) => ["measure", "recheck"].includes(job.kind) && engineKey(job) === key);
  const evidence = brandEvidence(store, project, jobs.filter((job) => !job.topicId));
  return {
    engine: key,
    measurement: evidence.measure ? publicJob(evidence.measure) : null,
    observations: evidence.observations.map(publicObservation),
    metrics: evidence.metrics,
    presentation: { ...evidence.presentation, history: withTopicChecks(evidence.presentation.history, jobs, project) },
    comparison: evidence.comparison,
    competitors: evidence.competitors,
  };
}
export type EngineView = ReturnType<typeof engineView>;
