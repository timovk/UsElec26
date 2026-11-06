import type { CSSProperties, ReactNode } from 'react';
import type { OfficeHolderDto, PartyDto } from '../../engine/protocol';
import { formatDate } from '../../core/time';

export const PARTY_COLORS: Record<number, string> = { 0: '#3a4166', 1: '#1F5FD6', 2: '#D7263D', 3: '#E0A800', 4: '#2E9E5B', 5: '#8A8F9E' };
export const PARTY_ABBR: Record<number, string> = { 0: 'Vacant', 1: 'D', 2: 'R', 3: 'L', 4: 'G', 5: 'I' };
export const PARTY_NAME: Record<number, string> = { 0: 'Vacant', 1: 'Democratic', 2: 'Republican', 3: 'Libertarian', 4: 'Green', 5: 'Independent' };

export function PartyBadge({ party }: { party: number }) {
  const cls = party === 1 ? 'd' : party === 2 ? 'r' : 'i';
  return <span className={`badge ${cls}`} title={PARTY_NAME[party]}>{PARTY_ABBR[party] ?? '?'}</span>;
}

export function Avatar({ name, party, size = 34 }: { name: string; party: number; size?: number }) {
  const initials = name.split(' ').filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).slice(0, 1).concat(name.split(' ').slice(-1).map((w) => w[0] ?? '')).join('');
  return <span className="avatar" style={{ width: size, height: size, background: PARTY_COLORS[party] ?? '#555' }} aria-hidden>{initials}</span>;
}

export function Truth({ children = 'Simulation truth' }: { children?: ReactNode }) {
  return <span className="badge truth" title="Latent state of the simulated electorate. Not a poll or an election result.">◆ {children}</span>;
}
export function Planned({ phase, children }: { phase: number; children?: ReactNode }) {
  return <span className="badge planned" title={`This feature arrives in Phase ${phase} of the roadmap.`}>{children ?? 'Planned'} · Phase {phase}</span>;
}
export function PreSim() {
  return <span className="badge" title="Generated as part of the universe's starting conditions; not produced by a simulated election.">Pre-simulation background</span>;
}

export function OfficeHolder({ o, showTitle = true }: { o: OfficeHolderDto; showTitle?: boolean }) {
  if (!o.holder) {
    return (
      <div className="officeholder">
        <span className="avatar" style={{ background: '#2a3155' }}>—</span>
        <div><div className="title">{o.title}</div><div className="name muted">Vacant</div>{o.vacancy && <div className="tiny muted">{o.vacancy.resolution}</div>}</div>
      </div>
    );
  }
  return (
    <div className="officeholder">
      <a href={`#/people/${o.holder.id}`} className="row" style={{ gap: 10 }}>
        <Avatar name={o.holder.name} party={o.holder.party} />
        <div>
          {showTitle && <div className="title">{o.title}</div>}
          <div className="name">{o.holder.name} <span className="muted small">({PARTY_ABBR[o.holder.party]}{o.holder.state ? `–${o.holder.state}` : ''}) · {o.holder.age}</span></div>
          {o.since !== null && <div className="tiny muted">In office since {formatDate(o.since)}{o.acquired ? ` · ${o.acquired}` : ''}</div>}
        </div>
      </a>
      {showTitle && /\b[A-Z]{2}-(AL|\d{2})\b/.test(o.title) && <a className="tiny" style={{ marginLeft: 44 }} href={districtHref(/\b[A-Z]{2}-(AL|\d{2})\b/.exec(o.title)![0])}>District history ›</a>}
    </div>
  );
}

export function SeatBar({ composition, seats, majorityLine = true }: { composition: { party: number; seats: number }[]; seats: number; majorityLine?: boolean }) {
  const order = [1, 5, 4, 3, 0, 2];
  const sorted = [...composition].sort((a, b) => order.indexOf(a.party) - order.indexOf(b.party));
  return (
    <div className="seatbar" role="img" aria-label={sorted.map((c) => `${PARTY_NAME[c.party]} ${c.seats}`).join(', ')}>
      {sorted.map((c) => <div key={c.party} style={{ width: `${(100 * c.seats) / seats}%`, background: PARTY_COLORS[c.party] }} title={`${PARTY_NAME[c.party]}: ${c.seats}`} />)}
      {majorityLine && <div className="majority" />}
    </div>
  );
}

export function PartyName({ parties, id }: { parties?: PartyDto[]; id: number }) {
  return <>{parties?.find((p) => p.id === id)?.short ?? PARTY_NAME[id] ?? 'Unknown'}</>;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmtBytes = (n: number | null) => (n === null ? '—' : n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const fmtLean = (m: number) => `${m >= 0 ? 'D' : 'R'}+${Math.abs(m).toFixed(1)}`;

/** Congressional district codes in text ("TX-15", "NC-02", "WY-AL"). */
const CODE_RE = /\b([A-Z]{2})-(AL|\d{2})\b/g;
export const districtHref = (code: string) => `#/district/${code}`;

/**
 * Text with every congressional district code linked to the district's history. The rest of the text links to
 * `href` when given (as separate links, never nested).
 */
export function CodeLinks({ text, href, style }: { text: string; href?: string; style?: CSSProperties }) {
  const parts: ReactNode[] = [];
  let last = 0, k = 0;
  const plain = (s: string) => (s ? (href ? <a key={k++} href={href} style={style}>{s}</a> : <span key={k++}>{s}</span>) : null);
  for (const m of text.matchAll(CODE_RE)) {
    parts.push(plain(text.slice(last, m.index)));
    parts.push(<a key={k++} href={districtHref(m[0])} title={`${m[0]}: every election in the district`} style={{ ...style, textDecoration: 'underline dotted' }} onClick={(e) => e.stopPropagation()}>{m[0]}</a>);
    last = m.index! + m[0].length;
  }
  parts.push(plain(text.slice(last)));
  return <>{parts}</>;
}
