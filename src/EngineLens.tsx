import { Layers } from "lucide-react";
import { Select, type SelectOption } from "./Select";
import { ProviderIcon } from "./provider-ui";
import { shortDate } from "./format";
import { engineName } from "../server/engine-key";
import type { EngineSummary } from "../server/engines";
import type { EngineScope } from "./engine-scope";
import "./engines.css";

const checkAnother = "check-another-engine";

/** The list's detail line says what each engine has to show before it is picked. */
function engineDetail(engine: EngineSummary) {
  if (engine.latest) return shortDate(engine.latest.at) + " · " + engine.latest.completed + " answers";
  return "Topic checks only" + (engine.nextRunAt ? ", full check " + shortDate(engine.nextRunAt) : "");
}

export function engineOptions(engines: EngineSummary[]): SelectOption[] {
  const checked = engines.filter((engine) => engine.latest || engine.topicCheck).length;
  return [
    { value: "all", label: "All engines", detail: checked + " side by side", icon: <Layers size={16} aria-hidden="true" /> },
    ...engines.map((engine) => ({ value: engine.key, label: engineName(engine), detail: engineDetail(engine), group: "Checked",
      icon: <ProviderIcon provider={engine.provider === "chatgpt" ? "chatgpt" : engine.platform} size={16} /> })),
    { value: checkAnother, label: "Check another engine", group: "More engines" },
  ];
}

/** A lens like the topic lens: it narrows which engine's answers the brand view reads, never the saved evidence. */
export function EngineLens({ scope, onCheck, mobile = false }: { scope: EngineScope; onCheck: () => void; mobile?: boolean }) {
  return <div className={"engine-lens" + (mobile ? " in-page" : "") + (scope.picked ? " scoped" : "")}>
    <Select label={mobile ? "Mobile engine" : "Engine"} compact searchable={false} value={scope.choice ?? "all"}
      onChange={(value) => value === checkAnother ? onCheck() : scope.choose(value)} options={engineOptions(scope.engines)} />
    {scope.picked && <button className="text-button" onClick={() => scope.choose("all")}>Show all engines</button>}
  </div>;
}
