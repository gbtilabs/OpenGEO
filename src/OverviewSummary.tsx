import { ArrowRight, Link, ScanSearch } from 'lucide-react';
import { CoverageRing } from './ui/Primitives';
import type { Presentation } from '../server/presentation';

/** The overview reads the same mutually exclusive outcome counts as the evidence panels. */
export function OverviewSummary({ brand, presentation, collected, audited, missing, onAnswers, onAudit }: { brand: string; presentation: Presentation; collected: number; audited: number; missing: number; onAnswers: () => void; onAudit: () => void }) {
  const cited = presentation.outcomes.find(group => group.kind === 'cited')?.count ?? 0;
  return <section className="overview-summary" aria-label="Your visibility at a glance">
    <div className="overview-summary-copy">
      <h2>{collected ? cited ? <>{brand} is a source in <strong>{cited} of {collected}</strong> collected answers.</> : <>{brand} has no website citations in this check.</> : audited ? <>Your site is audited. See how AI talks about {brand}.</> : <>Start with your website. Build a clearer view of your visibility.</>}</h2>
      <p>{collected ? `${missing ? `${missing} requested answers are still missing. ` : ''}Explore the answers, see who gets cited, and find your next improvement.` : audited ? `${audited} ${audited === 1 ? 'page is' : 'pages are'} ready to explore. A visibility check measures mentions and citations.` : 'A local audit checks your public pages without a provider account.'}</p>
      <button className="summary-action" onClick={collected ? onAnswers : onAudit}>{collected ? 'Explore your answers' : audited ? 'Explore your site audit' : 'Review site audit'}<ArrowRight size={16} /></button>
    </div>
    <div className="overview-summary-visual">{collected ? <><CoverageRing count={cited} total={collected} label="collected answers cite your website" /><span><Link size={15} /> Website citations</span></> : <><ScanSearch size={42} strokeWidth={1.5} /><strong>{audited || 'Local'}</strong><span>{audited ? `${audited === 1 ? 'page' : 'pages'} audited` : 'site audit'}</span></>}</div>
  </section>;
}
