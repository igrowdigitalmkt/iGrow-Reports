import { Circle, Line, Path, Polyline, Svg, Text } from "@react-pdf/renderer";
import { COLORS } from "./theme";
import { niceMax } from "./summary";

const axisText = { fontFamily: "Inter", fontSize: 12, fill: COLORS.muted };

type AreaChartProps = {
  values: Array<number | null>;
  labels: string[];
  color: string;
  format: (value: number) => string;
  width?: number;
  height?: number;
};

// Linha com área, eixo de valores à esquerda e datas embaixo. Dias sem dado interrompem a linha (nunca viram zero).
export function AreaChart({ values, labels, color, format, width = 523, height = 230 }: AreaChartProps) {
  const left = 64, right = width - 10, top = 12, base = height - 30;
  const max = niceMax(Math.max(0, ...values.map(value => value ?? 0)));
  const x = (index: number) => values.length <= 1 ? (left + right) / 2 : left + (index * (right - left)) / (values.length - 1);
  const y = (value: number) => base - (value / max) * (base - top);

  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value)) { if (current.length) segments.push(current); current = []; return; }
    current.push({ x: x(index), y: y(value) });
  });
  if (current.length) segments.push(current);

  const ticks = [0, 1, 2, 3, 4];
  const labelEvery = Math.max(1, Math.ceil(values.length / 5));
  const xLabels = labels.map((label, index) => ({ label, index })).filter(({ index }) => index % labelEvery === 0 || index === labels.length - 1);
  const lastLabelIndex = xLabels[xLabels.length - 1]?.index;
  const visibleLabels = xLabels.filter(({ index }, position) => position === xLabels.length - 1 || lastLabelIndex === undefined || lastLabelIndex - index >= labelEvery * 0.6);
  const showDots = values.length <= 14;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {ticks.map(tick => {
        const value = (max * tick) / 4, line = y(value);
        return [
          <Line key={`g${tick}`} x1={left} y1={line} x2={right} y2={line} stroke={COLORS.line} strokeWidth={0.7} />,
          <Text key={`t${tick}`} x={left - 8} y={line + 4} textAnchor="end" style={axisText}>{format(value)}</Text>,
        ];
      })}
      {segments.map((segment, index) => segment.length > 1 && (
        <Path key={`a${index}`} d={`M${segment.map(point => `${point.x},${point.y}`).join(" L")} L${segment[segment.length - 1]!.x},${base} L${segment[0]!.x},${base} Z`} fill={color} fillOpacity={0.1} />
      ))}
      {segments.map((segment, index) => segment.length > 1
        ? <Polyline key={`l${index}`} points={segment.map(point => `${point.x},${point.y}`).join(" ")} stroke={color} strokeWidth={2.6} fill="none" />
        : <Circle key={`p${index}`} cx={segment[0]!.x} cy={segment[0]!.y} r={3} fill={color} />)}
      {showDots && segments.flat().map((point, index) => <Circle key={`d${index}`} cx={point.x} cy={point.y} r={2.6} fill={color} />)}
      {visibleLabels.map(({ label, index }, position) => (
        <Text key={`x${index}`} x={x(index)} y={base + 20} textAnchor={position === 0 ? "start" : position === visibleLabels.length - 1 ? "end" : "middle"} style={axisText}>{label}</Text>
      ))}
    </Svg>
  );
}

function arc(cx: number, cy: number, inner: number, outer: number, from: number, to: number) {
  const point = (radius: number, angle: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  const large = to - from > Math.PI ? 1 : 0;
  const [x0, y0] = point(outer, from), [x1, y1] = point(outer, to), [x2, y2] = point(inner, to), [x3, y3] = point(inner, from);
  return `M${x0} ${y0} A${outer} ${outer} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
}

type DonutProps = { items: Array<{ value: number; color: string }>; size: number; centerTop: string; centerBottom?: string; valueFont?: number };

export function Donut({ items, size, centerTop, centerBottom, valueFont = 15 }: DonutProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  let angle = -Math.PI / 2;
  const slices = total > 0 ? items.filter(item => item.value > 0).map((item, index) => {
    const span = (item.value / total) * 2 * Math.PI;
    const path = <Path key={index} d={arc(60, 60, 37, 55, angle, angle + Math.min(span, 2 * Math.PI - 0.001))} fill={item.color} />;
    angle += span;
    return path;
  }) : [<Path key="empty" d={arc(60, 60, 37, 55, -Math.PI / 2, 1.5 * Math.PI - 0.001)} fill={COLORS.line} />];
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      {slices}
      <Text x={60} y={centerBottom ? 59 : 66} textAnchor="middle" style={{ fontFamily: "Inter", fontSize: valueFont, fontWeight: 700, fill: COLORS.ink }}>{centerTop}</Text>
      {centerBottom ? <Text x={60} y={75} textAnchor="middle" style={{ fontFamily: "Inter", fontSize: 9, fill: COLORS.muted }}>{centerBottom}</Text> : null}
    </Svg>
  );
}
