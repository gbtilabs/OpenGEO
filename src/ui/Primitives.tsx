import { useId, type ReactNode } from 'react';
import { ChartColumn, Check, FileText, Lightbulb, Link, MessagesSquare, Minus, ScanSearch, Search, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { pointChange, shortDate } from '../format';

export function PageHeader({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon; children?: ReactNode }) {
  return <div className="page-heading"><div className="page-heading-copy"><span className="page-icon"><Icon size={22} aria-hidden="true" /></span><div><h1>{title}</h1><p>{description}</p></div></div>{children}</div>;
}

export function EmptyState({ title, children, icon: Icon = Search, action }: { title: string; children: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return <div className="empty"><Icon size={24} aria-hidden="true" /><h3>{title}</h3><p>{children}</p>{action}</div>;
}

const metricIcons: Record<string, LucideIcon> = { 'Brand mentions': MessagesSquare, 'Website citations': Link, 'Answers collected': Check, Opportunities: Lightbulb, 'Answers remaining': MessagesSquare };

/** Deltas come from the server's same-scope comparison, not adjacent check values. */
export function MetricCard({ title, value, detail, points, since, tone = 'mention' }: { title: string; value: string; detail: string; points?: number | null; since?: string; tone?: 'mention' | 'citation' }) {
  const Icon = metricIcons[title] ?? ChartColumn;
  const change = points === undefined ? null : pointChange(points);
  const ChangeIcon = change?.direction === 'up' ? TrendingUp : change?.direction === 'down' ? TrendingDown : Minus;
  return <section className={'metric ' + tone}>
    <span className="metric-title">{title}<span className="metric-icon"><Icon size={16} aria-hidden="true" /></span></span>
    <div className="metric-value"><strong className={value.length > 10 ? 'metric-text' : undefined}>{value}</strong>{change && since && <span className={'metric-change ' + change.direction} title={'Compared with the comparable check on ' + shortDate(since)}><ChangeIcon size={13} aria-hidden="true" />{change.label}<span className="visually-hidden"> since the comparable check on {shortDate(since)}</span></span>}</div>
    <small>{detail}</small>
  </section>;
}

/** A count is always paired with its denominator; missing evidence never becomes zero. */
export function CoverageRing({ count, total, label }: { count: number; total: number; label: string }) {
  const id = useId(), radius = 45, circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.max(0, Math.min(1, count / total)) : 0;
  return <svg className="coverage-ring" viewBox="0 0 120 120" role="img" aria-labelledby={id}>
    <title id={id}>{total > 0 ? `${count} of ${total} ${label}` : 'No answers collected yet'}</title>
    <circle className="coverage-ring-track" cx="60" cy="60" r={radius} fill="none" strokeWidth="8" />
    {total > 0 && <circle className="coverage-ring-value" cx="60" cy="60" r={radius} fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 60 60)" />}
    <text x="60" y="58" textAnchor="middle" className="coverage-ring-number">{total > 0 ? `${Math.round(ratio * 100)}%` : 'Pending'}</text>
    <text x="60" y="77" textAnchor="middle" className="coverage-ring-label">{total > 0 ? `${count} of ${total}` : 'first check'}</text>
  </svg>;
}

export const emptyIcon = (title: string) => /draft|create|content/i.test(title) ? FileText : /audit|page/i.test(title) ? ScanSearch : /answer|response/i.test(title) ? MessagesSquare : /recommendation|improvement/i.test(title) ? Lightbulb : Search;
