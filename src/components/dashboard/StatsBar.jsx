import React from "react";
import { motion } from "framer-motion";
import { Camera, AlertTriangle, CheckCircle2, Users, TrendingUp, TrendingDown } from "lucide-react";

const stats = [
  { key: "cameras", label: "Active Cameras", icon: Camera, color: "cyan", trend: null },
  { key: "activeMissions", label: "Active Missions", icon: AlertTriangle, color: "amber", trend: null },
  { key: "completed", label: "Completed Today", icon: CheckCircle2, color: "emerald", trend: "up" },
  { key: "teamAvailable", label: "Team Available", icon: Users, color: "violet", trend: null },
];

const colorMap = {
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/20", text: "text-cyan-400", icon: "text-cyan-400" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", icon: "text-amber-400" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", icon: "text-emerald-400" },
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/20", text: "text-violet-400", icon: "text-violet-400" },
};

export default function StatsBar({ data }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {stats.map((stat, i) => {
        const c = colorMap[stat.color];
        return (
          <motion.div
            key={stat.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className={`relative rounded-xl border ${c.border} ${c.bg} p-4 lg:p-5 overflow-hidden`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">{stat.label}</p>
                <p className={`text-2xl lg:text-3xl font-bold mt-1 ${c.text}`}>
                  {data?.[stat.key] ?? "—"}
                </p>
              </div>
              <div className={`p-2 rounded-lg ${c.bg}`}>
                <stat.icon className={`w-5 h-5 ${c.icon}`} />
              </div>
            </div>
            {stat.trend === "up" && (
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                <span className="text-[11px] text-emerald-400">+12% vs yesterday</span>
              </div>
            )}
            {/* Decorative gradient */}
            <div className={`absolute -bottom-4 -right-4 w-24 h-24 rounded-full ${c.bg} opacity-40 blur-2xl`} />
          </motion.div>
        );
      })}
    </div>
  );
}