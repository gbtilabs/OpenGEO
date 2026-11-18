import { ArrowRight, Layers } from "lucide-react";
import { ProviderIcon, platformLabel } from "./provider-ui";
import { CheckHistory } from "./DataPresentation";
import { useApiResource } from "./useApiResource";
import { dateTime, percent } from "./format";
import { engineName } from "../server/engine-key";
import type { EngineSummary } from "../server/engines";
import type { Job } from "../server/contracts";
import type { EngineScope } from "./engine-scope";
import "./engines.css";

const surfaces: Record<string, string> = { chatgpt: "API answers", deepseek: "API answers with DeepSeek search",
  console: "Answers from the app", dataforseo: "Answers collected by DataForSEO", openrouter: "Model answers" };
const rate = (count: number, of: number) => of ? 100 * count / of : null;
const icon = (engine: Pick<EngineSummary, "provider" | "platform">) => engine.provider === "chatgpt" ? "chatgpt" : engine.platform;

function EngineCard({ engine, open }: { engine: EngineSummary; open: () => void }) {
  const { latest, topicCheck } = engine, name = engineName(engine);
  return <article className="panel engine-card">
    <div className="engine-card-heading"><ProviderIcon provider={icon(engine)} size={28} /><div><h2>{name}</h2>
      <span>{surfaces[engine.provider] ?? "Answers"}{latest ? " · " + dateTime(latest.at) : ""}</span></div></div>
    <div className="engine-badges">
      {latest && <span className="badge">{latest.completed} of {latest.requested} answers</span>}
      {engine.preparesRecommendations && <span className="badge engine-basis">Prepares recommendations</span>}
      {!latest && <span className="badge medium">Topic checks only</span>}
    </div>
    {latest ? <div className="engine-rates">
      <div><span>Brand mentions</span><strong className="mention">{percent(rate(latest.mentioned, latest.completed))}</strong><small>{latest.mentioned} of {latest.completed} answers</small></div>
      <div><span>Website citations</span><strong className="citation">{percent(rate(latest.cited, latest.completed))}</strong><small>{latest.cited} of {latest.completed} answers</small></div>
    </div> : <div className="engine-pending">
      <strong>{engine.nextRunAt ? "Its first full check runs " + dateTime(engine.nextRunAt) : "Check all your questions to see its rates"}</strong>
      <span>Its rates appear here once every question is answered. Other engines' figures never stand in.</span>
    </div>}
    {latest?.topCited.length ? <div className="engine-list"><span>Most cited</span>
      {latest.topCited.map((row) => <div key={row.domain}><span>{row.domain}</span><small>{row.answers} {row.answers === 1 ? "answer" : "answers"}</small></div>)}
    </div> : topicCheck && <div className="engine-list"><span>Latest topic check</span>
      <div><span>{topicCheck.topic}</span><small>{dateTime(topicCheck.at)}</small></div>
      <small>Mentioned in {topicCheck.mentioned} of {topicCheck.completed} answers, cited in {topicCheck.cited} of {topicCheck.completed}</small>
    </div>}
    <div className="engine-card-footer">{latest && engine.nextRunAt ? <span>Next check {dateTime(engine.nextRunAt)}</span> : <span />}
      <button className="text-button" onClick={open}>Open {name} view <ArrowRight size={14} /></button></div>
  </article>;
}

/** SurfacedBy's consumer apps appear only when the connection can check them and none of them has a check yet. */
function SurfacedByCard({ engines, onCheck }: { engines: EngineSummary[]; onCheck: () => void }) {
  const { data } = useApiResource<{ platforms?: { key: string; name: string }[]; selected_question_platforms?: string[] }>("/providers/console/capabilities", "once");
  const checked = new Set(engines.filter((engine) => engine.provider === "console").map((engine) => engine.platform.replace("chat_gpt", "chatgpt")));
  const ready = (data?.selected_question_platforms ?? []).filter((key) => !checked.has(key));
  if (!ready.length) return null;
  return <article className="panel engine-card engine-card-ready">
    <div className="engine-card-heading"><ProviderIcon provider="console" size={28} /><div><h2>Through SurfacedBy</h2><span>Answers from the consumer apps</span></div></div>
    <p>Your SurfacedBy connection can check these apps. Each one becomes its own engine here after its first check.</p>
    <div className="engine-badges">{ready.map((key) => <span className="badge" key={key}>{data?.platforms?.find((row) => row.key === key)?.name ?? platformLabel(key)}</span>)}</div>
    <p className="small">Each check is quoted before it runs. App answers stay apart from API answers, even for the same model.</p>
    <div><button className="secondary" onClick={onCheck}>Plan a check</button></div>
  </article>;
}

/** Overview with All engines picked: each engine's latest check side by side, never added together. */
export function AllEngines({ scope, jobs, topics, consoleConnected, onCheck }: {
  scope: EngineScope; jobs: Job[]; topics: Record<string, string>; consoleConnected: boolean; onCheck: () => void;
}) {
  return <>
    <div className="engine-scope"><span className="badge"><Layers size={14} aria-hidden="true" />All engines</span>
      <span>Each engine's latest check, side by side. Rates are never combined into one score.</span></div>
    <div className="engine-cards">
      {scope.engines.map((engine) => <EngineCard key={engine.key} engine={engine} open={() => scope.choose(engine.key)} />)}
      {consoleConnected && <SurfacedByCard engines={scope.engines} onCheck={onCheck} />}
    </div>
    <CheckHistory jobs={jobs} topics={topics} />
  </>;
}

/** Visibility, Responses, Sources and Competitors read one engine's answers; with All engines they ask for one. */
export function AllEnginesStrip({ scope, page }: { scope: EngineScope; page: string }) {
  const noun = page === "Responses" ? "answers" : page === "Sources" ? "sources" : page === "Competitors" ? "competitor comparison" : "trend and coverage";
  return <section className="panel engine-strip">
    <div className="panel-heading"><h2>All engines</h2><span>Pick an engine to see its {noun}.</span></div>
    <div className="table-wrap"><table className="analytics-table responsive-evidence-table">
      <caption className="visually-hidden">Each engine's latest check</caption>
      <thead><tr><th>Engine</th><th>Latest check</th><th>Brand mentions</th><th>Website citations</th><th>Answers</th><th><span className="visually-hidden">Open</span></th></tr></thead>
      <tbody>{scope.engines.map((engine) => {
        const latest = engine.latest;
        return <tr key={engine.key}>
          <td><span className="check-date"><ProviderIcon provider={icon(engine)} size={16} />{engineName(engine)}</span></td>
          <td data-label="Latest check">{latest ? dateTime(latest.at) : "Topic checks only"}</td>
          <td data-label="Brand mentions">{latest ? percent(rate(latest.mentioned, latest.completed)) : "After a full check"}</td>
          <td data-label="Website citations">{latest ? percent(rate(latest.cited, latest.completed)) : "After a full check"}</td>
          <td data-label="Answers">{latest ? latest.completed + " / " + latest.requested : "After a full check"}</td>
          <td><button className="text-button" onClick={() => scope.choose(engine.key)}>Open <ArrowRight size={14} /></button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

export function EngineWaiting() {
  return <div className="workspace-loading" role="status"><span className="visually-hidden">Loading this engine's checks</span><div className="panel skeleton tall" aria-hidden="true" /></div>;
}

/** A picked engine that has answered a topic but not yet every question: its topic answers are one step away. */
export function EngineFirstCheck({ engine, questions, openTopic, onCheck }: {
  engine: EngineSummary; questions: number; openTopic: (topicId: string) => void; onCheck: () => void;
}) {
  const name = engineName(engine), topic = engine.topicCheck;
  return <section className="panel engine-first-check">
    <ProviderIcon provider={icon(engine)} size={32} />
    <h2>{name} is waiting for a check of all {questions} questions</h2>
    <p>{engine.nextRunAt ? "Its first full check runs " + dateTime(engine.nextRunAt) + "." : "Check all your questions to see its brand rates."}
      {topic && " Until then, its latest topic check is " + topic.topic + ": mentioned in " + topic.mentioned + " of " + topic.completed + " answers, cited in " + topic.cited + " of " + topic.completed + "."}</p>
    <div className="button-row">
      {topic && <button className="primary" onClick={() => openTopic(topic.topicId)}>Open {topic.topic}</button>}
      <button className="secondary" onClick={onCheck}>Check all questions now</button>
    </div>
    <p className="small">Pages keep their layout and wait for the full check. Other engines' figures never stand in.</p>
  </section>;
}
