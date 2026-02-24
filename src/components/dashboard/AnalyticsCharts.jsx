import React from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const hourlyData = [
  { hour: "00:00", detections: 2 },
  { hour: "02:00", detections: 1 },
  { hour: "04:00", detections: 0 },
  { hour: "06:00", detections: 3 },
  { hour: "08:00", detections: 8 },
  { hour: "10:00", detections: 12 },
  { hour: "12:00", detections: 15 },
  { hour: "14:00", detections: 9 },
  { hour: "16:00", detections: 11 },
  { hour: "18:00", detections: 7 },
  { hour: "20:00", detections: 4 },
  { hour: "22:00", detections: 2 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#1a2332] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
        <p className="text-[10px] text-gray-400">{label}</p>
        <p className="text-xs font-semibold text-cyan-400">{payload[0].value} detections</p>
      </div>
    );
  }
  return null;
};

export default function AnalyticsCharts({ missions }) {
  // Calculate zone distribution from missions
  const zoneMap = {};
  missions.forEach(m => {
    const zone = m.location || "Unknown";
    zoneMap[zone] = (zoneMap[zone] || 0) + 1;
  });
  const zoneData = Object.entries(zoneMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));

  const pieColors = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

  // Response time mock
  const responseData = [
    { label: "< 5m", count: 12 },
    { label: "5-15m", count: 8 },
    { label: "15-30m", count: 5 },
    { label: "30m+", count: 2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-200">Analytics</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Detection Timeline */}
        <div className="lg:col-span-2 rounded-xl border border-white/[0.06] bg-[#111827]/40 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-gray-400">Detection Timeline (Today)</h3>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400">
              <TrendingUp className="w-3 h-3" />
              Peak at 12:00
            </div>
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData}>
                <defs>
                  <linearGradient id="detGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="hour"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#4b5563" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "#4b5563" }}
                  width={30}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="detections"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  fill="url(#detGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Zone Distribution */}
        <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 p-4">
          <h3 className="text-xs font-medium text-gray-400 mb-4">Detections by Zone</h3>
          {zoneData.length > 0 ? (
            <>
              <div className="h-[120px] flex justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={zoneData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {zoneData.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {zoneData.map((z, i) => (
                  <div key={z.name} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pieColors[i % pieColors.length] }} />
                      <span className="text-gray-400 truncate max-w-[120px]">{z.name}</span>
                    </div>
                    <span className="text-gray-300 font-medium">{z.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-600 text-xs">No data yet</div>
          )}
        </div>
      </div>

      {/* Response Time */}
      <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 p-4">
        <h3 className="text-xs font-medium text-gray-400 mb-4">Average Response Time</h3>
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={responseData} barCategoryGap="30%">
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#4b5563" }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#4b5563" }}
                width={25}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {responseData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#10b981" : i === 1 ? "#06b6d4" : i === 2 ? "#f59e0b" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}