import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { dayNumber, niceTicks, type Point, splitOnGaps } from "../progress";

// Small time-series line chart (progress charts, issue #8). One series: a 2px line in the validated blue
// series colour, optional faint dots behind it (raw values the line smooths). Tap or drag anywhere to snap
// the crosshair to the nearest date; the caller renders that date's readout. Arrow keys move it too.
export function LineChart({
  points,
  dots = [],
  markers = true,
  clock = false,
  gapDays,
  format,
  detail,
  label,
  height = 140,
}: {
  points: Point[]; // the line, oldest first
  dots?: Point[]; // faint background values (e.g. daily weigh-ins under their rolling average)
  markers?: boolean; // a dot on every line point (sparse series)
  clock?: boolean; // values are times in seconds: ticks at whole clock steps
  gapDays?: number; // break the line where points are further apart than this
  format: (v: number) => string; // y tick labels
  detail: (date: string) => ReactNode; // readout for the picked date
  label: string; // accessible name
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const dates = useMemo(() => [...new Set([...points, ...dots].map((p) => p.date))].sort(), [points, dots]);
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked && dates.includes(picked) ? picked : dates.at(-1);

  const values = [...points, ...dots].map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4, clock);
  const [lo, hi] = [ticks[0], ticks.at(-1)!];
  const tickText = ticks.map(format);

  const padL = Math.max(...tickText.map((t) => t.length)) * 6.5 + 10;
  const padR = 8;
  const padT = 8;
  const axisH = 20; // x-axis label band, inside the svg so it's never clipped
  const plotH = height - padT - axisH;

  const days = dates.map(dayNumber);
  const [d0, d1] = days.length && days[0] !== days.at(-1)! ? [days[0], days.at(-1)!] : [(days[0] ?? 0) - 1, (days[0] ?? 0) + 1];
  const x = (date: string) => padL + 6 + ((dayNumber(date) - d0) / (d1 - d0)) * (width - padL - padR - 12);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  const segments = gapDays === undefined ? [points] : splitOnGaps(points, gapDays);
  const path = (seg: Point[]) => seg.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  function pickAt(e: PointerEvent<SVGSVGElement>) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = dates[0];
    for (const d of dates) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
    setPicked(best);
  }

  function onKey(e: KeyboardEvent) {
    const i = current ? dates.indexOf(current) : -1;
    const next = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    if (next === null || next < 0 || next >= dates.length) return;
    e.preventDefault();
    setPicked(dates[next]);
  }

  // x labels: first and last date, and the middle one when there's room
  const xLabels = dates.length > 1 ? [dates[0], ...(width > 280 && dates.length > 2 ? [dates[Math.floor((dates.length - 1) / 2)]] : []), dates.at(-1)!] : dates;
  const short = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  const pickedPoint = [...points].reverse().find((p) => p.date === current);

  return (
    <div className="line-chart" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pickAt(e);
        }}
        onPointerMove={(e) => e.buttons && pickAt(e)}
      >
        {ticks.map((t, i) => (
          <g key={t}>
            <line className="lc-grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text className="lc-tick" x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {tickText[i]}
            </text>
          </g>
        ))}
        {xLabels.map((d, i) => (
          <text
            key={d}
            className="lc-tick"
            x={x(d)}
            y={height - 4}
            textAnchor={xLabels.length > 1 && i === 0 ? "start" : i === xLabels.length - 1 && xLabels.length > 1 ? "end" : "middle"}
          >
            {short(d)}
          </text>
        ))}
        {current && <line className="lc-cross" x1={x(current)} x2={x(current)} y1={padT} y2={padT + plotH} />}
        {dots.map((p) => (
          <circle key={p.date} className="lc-dot" cx={x(p.date)} cy={y(p.value)} r={3} />
        ))}
        {segments.map((seg, i) =>
          seg.length > 1 ? (
            <path key={i} className="lc-line" d={path(seg)} />
          ) : (
            seg.length === 1 && !markers && <circle key={i} className="lc-mark" cx={x(seg[0].date)} cy={y(seg[0].value)} r={2.5} />
          ),
        )}
        {markers && points.map((p, i) => <circle key={i} className="lc-mark" cx={x(p.date)} cy={y(p.value)} r={4} />)}
        {pickedPoint && <circle className="lc-mark picked" cx={x(pickedPoint.date)} cy={y(pickedPoint.value)} r={5} />}
      </svg>
      {current && <p className="small lc-detail">{detail(current)}</p>}
    </div>
  );
}

// Width of the container, following rotation and resizes. Starts at a phone-ish width before first layout.
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 320);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || 320));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
