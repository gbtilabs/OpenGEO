import type { AuditCoverage, Finding, Job, PageSummary, Project } from "../server/contracts";
import type { EngineChoice, EngineSummary } from "../server/engines";
import type { Presentation } from "../server/presentation";
import type { PublicObservation as Observation } from "../server/public-results";
import type { TopicSummary } from "../server/topics";

/** The polled workspace, as the server's workspace route returns it. */
export type Workspace = {
  project: Project;
  jobs: Job[];
  askActivity: ReturnType<typeof import('../server/asks').askActivity>;
  pages: PageSummary[];
  auditId: string | null;
  revision: string;
  findingCounts: { total: number; done: number };
  auditCoverage: AuditCoverage | null;
  observations: Observation[];
  findings: Finding[];
  content: any[];
  metrics: {
    requested: number;
    completed: number;
    missing: number;
    mentionRate: number | null;
    citationRate: number | null;
    citations: number;
  };
  measurement: Job | null;
  presentation: Presentation;
  comparison: any;
  competitors: {
    domain: string;
    answersCiting: number;
    answersCollected: number;
    citationRate: number | null;
    urls: string[];
    observationIds: string[];
  }[];
  topics: TopicSummary[];
  /** Each engine's latest check, side by side; never added together. */
  engines: EngineSummary[];
  /** The engine last picked for this website, or null before the first pick. */
  engineChoice: EngineChoice | null;
};
