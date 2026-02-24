import React from "react";
import { motion } from "framer-motion";
import { Users } from "lucide-react";

const statusDot = {
  available: "bg-emerald-400",
  busy: "bg-amber-400",
  offline: "bg-gray-500",
  on_break: "bg-violet-400",
};

const statusLabel = {
  available: "Available",
  busy: "On Mission",
  offline: "Offline",
  on_break: "On Break",
};

export default function TeamStatus({ members, isLoading }) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 p-4">
        <div className="h-4 bg-gray-700/50 rounded w-1/3 animate-pulse mb-4" />
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="h-12 bg-gray-800/30 rounded-lg animate-pulse mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Users className="w-4 h-4 text-violet-400" />
        <h2 className="text-sm font-semibold text-gray-200">Team Status</h2>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {members.length === 0 ? (
          <div className="text-center py-6 text-gray-600 text-xs">No team members yet</div>
        ) : (
          members.map((member, i) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-all"
            >
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-600 flex items-center justify-center text-[11px] font-bold text-gray-300">
                  {member.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111827] ${statusDot[member.status]}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-200 truncate">{member.name}</p>
                <p className="text-[10px] text-gray-500">{member.zone || member.role || "—"}</p>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-[10px] text-gray-500">{statusLabel[member.status]}</span>
                <span className="text-[10px] text-emerald-500 font-medium">{member.missions_completed_today || 0} done</span>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}