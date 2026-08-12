"use client";

import { useMemo, useState } from "react";
import type { FluSeries } from "@/lib/cdc-flu";
import type { NewsItem } from "@/lib/medlineplus-news";
import type { HealthTopic } from "@/lib/medlineplus";

// Categorical hues, one fixed slot per state. Color follows the ENTITY,
// not its rank — toggling a state off must never repaint the survivors.
// This exact 5-slot order was run through the palette validator
// (adjacent CVD ΔE 9.1 protan, normal-vision 19.6, lightness + chroma
// pass). Three of them sit under 3:1 on white, which triggers the relief
// rule — hence the always-on direct end-labels and the table view below.
const STATE_COLOR: Record<string, string> = {
  PA: "#2a78d6", // blue
  NJ: "#eb6834", // orange
  NY: "#1baf7a", // aqua
  DE: "#eda100", // yellow
  MD: "#e87ba4", // magenta
};

// Plot geometry, in viewBox units. Right padding leaves room for the
// direct end-labels so they're never clipped.
const W = 760;
const H = 300;
const PAD = { top: 18, right: 82, bottom: 34, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// Smallest ceiling from a 1/1.5/2/2.5/… ladder that clears the data with a
// little headroom. A coarser ladder wastes the top half of the plot — a 4.5%
// peak rounding up to 6% leaves the lines squashed along the floor.
const CEILINGS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];

function niceMax(v: number): number {
  return CEILINGS.find((c) => c >= v) ?? Math.ceil(v / 5) * 5;
}

// One formatter for every tick, so the axis never mixes "0.0%" with "3%".
function fmtTick(t: number): string {
  return `${Number(t.toFixed(1))}%`;
}

// Vertical pitch for the direct end-labels, in viewBox units. Sized for the
// largest type the labels ever wear (13px at mobile).
const LABEL_PITCH = 16;

function levelWord(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export default function HealthMonitor({
  series,
  topics,
  news,
  sources,
}: {
  series: FluSeries[];
  topics: HealthTopic[];
  news: NewsItem[];
  sources: { source: string; count: number }[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [focusState, setFocusState] = useState<string>(series[0]?.state ?? "PA");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string | null>(null);

  const visible = series.filter((s) => !hidden.has(s.state));
  const weeks = series[0]?.points.map((p) => p.label) ?? [];

  const yMax = useMemo(() => {
    const vals = visible.flatMap((s) =>
      s.points.map((p) => p.wili).filter((v): v is number => v !== null)
    );
    return niceMax(vals.length ? Math.max(...vals) * 1.06 : 1);
  }, [visible]);

  const x = (i: number) =>
    PAD.left + (weeks.length > 1 ? (i * PLOT_W) / (weeks.length - 1) : 0);
  const y = (v: number) => PAD.top + PLOT_H - (v / yMax) * PLOT_H;

  const focus = series.find((s) => s.state === focusState) ?? series[0];
  const delta =
    focus?.latest != null && focus?.previous != null
      ? focus.latest - focus.previous
      : null;

  // Anything that rounds to 0.00 at the displayed precision is flat — an
  // arrow beside "0.00" claiming "rising" is just wrong.
  const trend =
    delta === null
      ? null
      : delta >= 0.005
      ? "up"
      : delta <= -0.005
      ? "down"
      : "flat";

  const toggle = (state: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      // Never hide the last visible series — an empty chart isn't a state
      // worth reaching by accident.
      else if (series.length - next.size > 1) next.add(state);
      return next;
    });

  const filteredNews = topicFilter
    ? news.filter((n) => n.relatedTopics.includes(topicFilter))
    : news;

  const allTopicTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of news) {
      for (const t of n.relatedTopics) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  }, [news]);

  const maxSourceCount = Math.max(1, ...sources.map((s) => s.count));
  const yTicks = [0, yMax / 2, yMax];

  // Direct end-labels, de-collided. Off-season the five states converge into
  // a fraction of a percentage point of each other, which stacks four labels
  // into one illegible pile — so walk down the sorted list pushing each label
  // to a minimum pitch, then slide the whole stack back inside the plot if
  // the pushdown ran off the floor. A leader line keeps each label tied to
  // its endpoint once the two no longer line up.
  const endLabels = (() => {
    const rows = visible
      .map((s) => {
        const i = s.points.length - 1;
        const v = s.points[i]?.wili;
        return v == null
          ? null
          : { state: s.state, v, cx: x(i), cy: y(v), ly: y(v) };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.cy - b.cy);

    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i].ly - rows[i - 1].ly;
      if (gap < LABEL_PITCH) rows[i].ly = rows[i - 1].ly + LABEL_PITCH;
    }

    // A few units above the baseline, so the bottom label never dips below
    // the zero gridline and read as a value under 0.
    const floor = PAD.top + PLOT_H - 5;
    const overflow = rows.length ? rows[rows.length - 1].ly - floor : 0;
    if (overflow > 0) for (const r of rows) r.ly -= overflow;

    return rows;
  })();

  return (
    <div className="mon">
      {/* ---------- headline stats ---------- */}
      <section className="mon-stats" aria-label="Current flu activity">
        <div className="mon-hero">
          <div className="mon-stat-label">
            Flu-like illness · {focus?.label ?? "—"}
          </div>
          <div className="mon-hero-value">
            {focus?.latest != null ? `${focus.latest.toFixed(2)}%` : "—"}
          </div>
          <div className="mon-hero-meta">
            of outpatient visits, week {focus?.points.at(-1)?.label ?? "—"}
            {focus && (
              <span className={`mon-badge mon-badge-${focus.level}`}>
                {levelWord(focus.level)}
              </span>
            )}
          </div>
        </div>

        <div className="mon-stat">
          <div className="mon-stat-label">Week over week</div>
          <div className="mon-stat-value">
            {delta === null ? (
              "—"
            ) : (
              <>
                {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}{" "}
                {Math.abs(delta).toFixed(2)}
                <span className="mon-stat-unit">pts</span>
              </>
            )}
          </div>
          <div className="mon-stat-foot">
            {trend === null
              ? "no prior week"
              : trend === "up"
              ? "rising"
              : trend === "down"
              ? "falling"
              : "flat week over week"}
          </div>
        </div>

        <div className="mon-stat">
          <div className="mon-stat-label">Season peak</div>
          <div className="mon-stat-value">
            {focus?.peak != null ? `${focus.peak.toFixed(2)}%` : "—"}
          </div>
          <div className="mon-stat-foot">highest week in range</div>
        </div>

        <div className="mon-stat">
          <div className="mon-stat-label">New from NLM</div>
          <div className="mon-stat-value">{news.length}</div>
          <div className="mon-stat-foot">items in the last 60 days</div>
        </div>
      </section>

      {/* ---------- trend chart ---------- */}
      <section className="mon-panel">
        <div className="mon-panel-head">
          <div>
            <h2 className="mon-panel-title">
              Flu-like illness, last {weeks.length} weeks
            </h2>
            <p className="mon-panel-sub">
              Weighted share of outpatient visits for influenza-like illness.
              CDC FluView via the Delphi Epidata API.
            </p>
          </div>
          <button
            className="mon-toggle"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>

        {/* Filters in one row above the chart. Each chip carries its
            state's own fixed color, so the legend and the lines agree. */}
        <div className="mon-legend" role="group" aria-label="Toggle states">
          {series.map((s) => {
            const off = hidden.has(s.state);
            return (
              <button
                key={s.state}
                className={`mon-chip${off ? " is-off" : ""}${
                  s.state === focusState ? " is-focus" : ""
                }`}
                onClick={() => toggle(s.state)}
                onDoubleClick={() => setFocusState(s.state)}
                aria-pressed={!off}
                title={`${s.label} — click to show/hide, double-click to feature in the stats above`}
              >
                <span
                  className="mon-swatch"
                  style={{ background: STATE_COLOR[s.state] }}
                  aria-hidden="true"
                />
                {s.state}
              </button>
            );
          })}
          <span className="mon-legend-hint">
            click to hide · double-click to feature
          </span>
        </div>

        {showTable ? (
          <div className="mon-table-wrap">
            <table className="mon-table">
              <caption className="mon-table-caption">
                Weighted influenza-like illness, % of outpatient visits
              </caption>
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  {visible.map((s) => (
                    <th scope="col" key={s.state}>
                      {s.state}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((wk, i) => (
                  <tr key={wk}>
                    <th scope="row">{wk}</th>
                    {visible.map((s) => (
                      <td key={s.state}>
                        {s.points[i]?.wili != null
                          ? s.points[i].wili!.toFixed(2)
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mon-chart-wrap">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="mon-chart"
              role="img"
              aria-label={`Line chart of weighted influenza-like illness over ${weeks.length} weeks for ${visible
                .map((s) => s.label)
                .join(", ")}`}
              onMouseLeave={() => setHoverIdx(null)}
              onMouseMove={(e) => {
                const svg = e.currentTarget;
                const r = svg.getBoundingClientRect();
                const px = ((e.clientX - r.left) / r.width) * W;
                const ratio = (px - PAD.left) / PLOT_W;
                const idx = Math.round(ratio * (weeks.length - 1));
                setHoverIdx(idx >= 0 && idx < weeks.length ? idx : null);
              }}
            >
              {/* recessive gridlines + y ticks */}
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + PLOT_W}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="#e6edf0"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 9}
                    y={y(t) + 4}
                    textAnchor="end"
                    className="mon-axis-text"
                  >
                    {fmtTick(t)}
                  </text>
                </g>
              ))}

              {/* x labels, thinned to avoid collisions */}
              {weeks.map((wk, i) =>
                i % 4 === 0 || i === weeks.length - 1 ? (
                  <text
                    key={wk}
                    x={x(i)}
                    y={H - 12}
                    textAnchor="middle"
                    className="mon-axis-text"
                  >
                    {wk.slice(5)}
                  </text>
                ) : null
              )}

              {/* crosshair */}
              {hoverIdx !== null && (
                <line
                  x1={x(hoverIdx)}
                  x2={x(hoverIdx)}
                  y1={PAD.top}
                  y2={PAD.top + PLOT_H}
                  stroke="#b9c8d0"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}

              {visible.map((s) => {
                const pts = s.points
                  .map((p, i) => (p.wili === null ? null : `${x(i)},${y(p.wili)}`))
                  .filter(Boolean)
                  .join(" ");
                return (
                  <polyline
                    key={s.state}
                    points={pts}
                    fill="none"
                    stroke={STATE_COLOR[s.state]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}

              {/* emphasized endpoint + direct end-label (the relief the
                  contrast WARN requires) */}
              {endLabels.map((d) => (
                <g key={`end-${d.state}`}>
                  <circle
                    cx={d.cx}
                    cy={d.cy}
                    r="4.5"
                    fill={STATE_COLOR[d.state]}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {Math.abs(d.ly - d.cy) > 1.5 && (
                    <polyline
                      points={`${d.cx + 5},${d.cy} ${d.cx + 9},${d.cy} ${
                        d.cx + 11
                      },${d.ly} ${d.cx + 14},${d.ly}`}
                      fill="none"
                      stroke={STATE_COLOR[d.state]}
                      strokeWidth="1"
                    />
                  )}
                  <text x={d.cx + 17} y={d.ly + 3.5} className="mon-end-label">
                    {d.state} {d.v.toFixed(2)}
                  </text>
                </g>
              ))}

              {/* hovered markers */}
              {hoverIdx !== null &&
                visible.map((s) => {
                  const v = s.points[hoverIdx]?.wili;
                  if (v == null) return null;
                  return (
                    <circle
                      key={`h-${s.state}`}
                      cx={x(hoverIdx)}
                      cy={y(v)}
                      r="4"
                      fill={STATE_COLOR[s.state]}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                  );
                })}
            </svg>

            {hoverIdx !== null && (
              <div
                className="mon-tooltip"
                style={{
                  left: `${((x(hoverIdx) / W) * 100).toFixed(2)}%`,
                }}
              >
                <div className="mon-tooltip-week">{weeks[hoverIdx]}</div>
                {visible.map((s) => (
                  <div className="mon-tooltip-row" key={s.state}>
                    <span
                      className="mon-swatch"
                      style={{ background: STATE_COLOR[s.state] }}
                      aria-hidden="true"
                    />
                    <span className="mon-tooltip-state">{s.state}</span>
                    <span className="mon-tooltip-val">
                      {s.points[hoverIdx]?.wili != null
                        ? `${s.points[hoverIdx].wili!.toFixed(2)}%`
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------- topics ---------- */}
      <section className="mon-panel">
        <div className="mon-panel-head">
          <div>
            <h2 className="mon-panel-title">Today&apos;s topics</h2>
            <p className="mon-panel-sub">
              Plain-language summaries from the National Library of Medicine,
              rotating daily.
            </p>
          </div>
        </div>
        <div className="mon-topics">
          {topics.map((t) => (
            <article className="mon-topic" key={t.url}>
              <h3>{t.title}</h3>
              <p>{t.summary}</p>
              <a href={t.url} target="_blank" rel="noopener noreferrer">
                MedlinePlus &rarr;
              </a>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- news + source bars ---------- */}
      <section className="mon-panel">
        <div className="mon-panel-head">
          <div>
            <h2 className="mon-panel-title">Recently added by NLM</h2>
            <p className="mon-panel-sub">
              New links published to MedlinePlus in the last 60 days. Filter by
              the topic each one is attached to.
            </p>
          </div>
        </div>

        <div className="mon-sources">
          <div className="mon-sources-title">Where it came from</div>
          {sources.slice(0, 5).map((s) => (
            <div className="mon-bar-row" key={s.source}>
              <span className="mon-bar-label" title={s.source}>
                {s.source}
              </span>
              <span className="mon-bar-track">
                <span
                  className="mon-bar-fill"
                  style={{ width: `${(s.count / maxSourceCount) * 100}%` }}
                />
              </span>
              <span className="mon-bar-val">{s.count}</span>
            </div>
          ))}
        </div>

        {allTopicTags.length > 0 && (
          <div className="mon-filters" role="group" aria-label="Filter news by topic">
            <button
              className={`mon-tag${topicFilter === null ? " is-on" : ""}`}
              onClick={() => setTopicFilter(null)}
              aria-pressed={topicFilter === null}
            >
              All ({news.length})
            </button>
            {allTopicTags.map(([tag, n]) => (
              <button
                key={tag}
                className={`mon-tag${topicFilter === tag ? " is-on" : ""}`}
                onClick={() => setTopicFilter(topicFilter === tag ? null : tag)}
                aria-pressed={topicFilter === tag}
              >
                {tag} ({n})
              </button>
            ))}
          </div>
        )}

        <ul className="mon-news">
          {filteredNews.map((n) => (
            <li className="mon-news-item" key={n.url + n.title}>
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
              <div className="mon-news-meta">
                {n.source && <span>{n.source}</span>}
                {n.publishedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <time dateTime={n.publishedAt}>
                      {new Date(n.publishedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </>
                )}
              </div>
              {n.relatedTopics.length > 0 && (
                <div className="mon-news-topics">
                  {n.relatedTopics.map((t) => (
                    <button
                      key={t}
                      className="mon-news-topic"
                      onClick={() => setTopicFilter(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {filteredNews.length === 0 && (
          <p className="mon-panel-sub">Nothing filed under that topic.</p>
        )}
      </section>
    </div>
  );
}
