import React from "react";
import { motion } from "framer-motion";
import { Clock, MapPin, User, Zap } from "lucide-react";
import { format } from "date-fns";

const priorityConfig = {
  critical: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-400" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20", dot: "bg-orange-400" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", dot: "bg-amber-400" },
  low: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", dot: "bg-blue-400" },
};

const statusConfig = {
  pending: { bg: "bg-gray-500/10", text: "text-gray-400", label: "Pending" },
  assigned: { bg: "bg-violet-500/10", text: "text-violet-400", label: "Assigned" },
  in_progress: { bg: "bg-cyan-500/10", text: "text-cyan-400", label: "In Progress" },
  completed: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Completed" },
};

export default function MissionCard({ mission, index }) {
  const p = priorityConfig[mission.priority] || priorityConfig.medium;
  const s = statusConfig[mission.status] || statusConfig.pending;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`flex items-start gap-3 p-3 rounded-lg border ${p.border} ${p.bg} hover:bg-white/[0.03] transition-all group`}
    >
      {/* Priority dot */}
      <div className="mt-1 shrink-0">
        <div className={`w-2 h-2 rounded-full ${p.dot} ${mission.priority === "critical" ? "animate-pulse" : ""}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-200 truncate">{mission.title}</h4>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text} font-medium`}>
            {s.label}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            <MapPin className="w-2.5 h-2.5" />
            {mission.location}
          </span>
          {mission.assigned_to && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <User className="w-2.5 h-2.5" />
              {mission.assigned_to}
            </span>
          )}
          {mission.detection_confidence && (
            <span className="flex items-center gap-1 text-[10px] text-cyan-500">
              <Zap className="w-2.5 h-2.5" />
              {mission.detection_confidence}% AI
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-gray-600">
            <Clock className="w-2.5 h-2.5" />
            {format(new Date(mission.created_date), "HH:mm")}
          </span>
        </div>
      </div>
    </motion.div>
  );
}