import { useState } from "react";
import { api } from "./api";
import { useApiResource } from "./useApiResource";
import { engineKey } from "../server/engine-key";
import type { EngineView } from "../server/engines";
import type { Job } from "../server/contracts";
import type { Workspace } from "./workspace";

/** The pages the engine lens applies to. Overview shows All engines side by side; the others need one engine. */
export const enginePages = ["Overview", "Visibility", "Responses", "Sources", "Competitors"];

/**
 * The engine lens over the brand view. With two or more engines checked, the first visit to a website lands on
 * All engines and later visits on the engine last picked there. Picking an engine lays that engine's evidence
 * (its displayed check, answers, metrics, trend, comparison and competitors) over the workspace; jobs, findings
 * and the website audit stay the workspace's own, so recommendations keep their basis whatever is picked.
 */
export function useEngineScope(workspace: Workspace | null, page: string) {
  const [local, setLocal] = useState<{ projectId: string; choice: string } | null>(null);
  const projectId = workspace?.project.id, engines = workspace?.engines ?? [], several = engines.length >= 2;
  const wanted = (local?.projectId === projectId ? local?.choice : null) ?? workspace?.engineChoice ?? "all";
  const choice = !several ? null : wanted === "all" || engines.some((engine) => engine.key === wanted) ? wanted : "all";
  const picked = choice && choice !== "all" ? choice : null;
  const { data } = useApiResource<EngineView>(projectId && picked ? "/projects/" + projectId + "/engines/" + picked : null, workspace?.revision ?? "");
  const view = data?.engine === picked ? data : null;
  const scoped: Workspace | null = workspace && view ? {
    ...workspace,
    measurement: view.measurement,
    observations: view.observations,
    metrics: view.metrics,
    presentation: { ...view.presentation, audit: workspace.presentation.audit },
    comparison: view.comparison,
    competitors: view.competitors,
  } : workspace;
  const lensPage = enginePages.includes(page);
  return {
    workspace: scoped,
    engines,
    choice,
    picked,
    /** All engines is showing on a page the lens applies to. */
    all: several && choice === "all" && lensPage,
    /** An engine was picked and its view has not arrived yet; pages wait rather than show another engine. */
    loading: !!picked && !view && lensPage,
    /** The picked engine has answered topics but not yet every question, so brand pages show its first-check state. */
    empty: !!picked && !!view && !view.measurement && lensPage,
    /** The picked engine's summary, for the first-check state. */
    summary: engines.find((engine) => engine.key === picked) ?? null,
    /** The lens shows only where it applies and only when there is more than one engine to choose from. */
    lens: several && lensPage,
    matches: (job: Pick<Job, "provider" | "platform">) => !picked || engineKey(job) === picked,
    choose(next: string) {
      if (!projectId) return;
      setLocal({ projectId, choice: next });
      // A failed save costs only the memory for the next visit; this visit keeps the pick either way.
      void api("/projects/" + projectId + "/engine-choice", { engine: next }, "PUT").catch(() => undefined);
    },
  };
}
export type EngineScope = ReturnType<typeof useEngineScope>;
