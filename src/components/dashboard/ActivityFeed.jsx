import React from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, CheckCircle2, UserPlus, Eye } from "lucide-react";
import { format } from "date-fns";

export default function ActivityFeed({ missions }) {
  const recentActivity = [...missions]
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .slice(0, 8);

  const getIcon = (mission) => {
    if (mission.status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (mission.status === "assigned" || mission.status === "in_progress") return <UserPlus className="w-3.5 h-3.5 text-violet-400" />;
    if (mission.priority === "critical") return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />;
    return <Eye className="w-3.5 h-3.5 text-amber-400" />;
  };

  const getMessage = (mission) => {
    if (mission.status === "completed") return `"${mission.title}" completed`;
    if (mission.status === "in_progress") return `${mission.assigned_to || "Team"} working on "${mission.title}"`;
    if (mission.status === "assigned") return `"${mission.title}" assigned to ${mission.assigned_to || "team"}`;
    return `Mess detected: "${mission.title}"`;
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Activity className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-200">Activity Feed</h2>
      </div>

      <div className="px-4 pb-4 space-y-1 max-h-[300px] overflow-y-auto">
        {recentActivity.length === 0 ? (
          <div className="text-center py-6 text-gray-600 text-xs">No recent activity</div>
        ) : (
          recentActivity.map((mission, i) => (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-start gap-2.5 py-2 border-b border-white/[0.03] last:border-0"
            >
              <div className="mt-0.5 shrink-0">{getIcon(mission)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-300 leading-relaxed truncate">
                  {getMessage(mission)}
                </p>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {format(new Date(mission.created_date), "HH:mm")} · {mission.location}
                </p>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}