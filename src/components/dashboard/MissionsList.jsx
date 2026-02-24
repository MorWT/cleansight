import React, { useState } from "react";
import { ClipboardList, CheckCircle2, AlertCircle } from "lucide-react";
import MissionCard from "./MissionCard";

export default function MissionsList({ missions, isLoading }) {
  const [tab, setTab] = useState("active");

  const activeMissions = missions.filter(m => m.status !== "completed");
  const completedMissions = missions.filter(m => m.status === "completed");

  const tabs = [
    { key: "active", label: "Active", icon: AlertCircle, count: activeMissions.length, color: "amber" },
    { key: "completed", label: "Done", icon: CheckCircle2, count: completedMissions.length, color: "emerald" },
  ];

  const displayed = tab === "active" ? activeMissions : completedMissions;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 p-4">
        <div className="h-4 bg-gray-700/50 rounded w-1/3 animate-pulse mb-4" />
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="h-16 bg-gray-800/30 rounded-lg animate-pulse mb-2" />
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-gray-200">Missions</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-4 gap-1 mb-3">
        {tabs.map(t => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${isActive
                  ? t.color === "amber"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-emerald-500/10 text-emerald-400"
                  : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]"
                }`}
            >
              <t.icon className="w-3 h-3" />
              {t.label}
              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${isActive
                ? t.color === "amber" ? "bg-amber-500/20" : "bg-emerald-500/20"
                : "bg-white/[0.06]"}`}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="px-4 pb-4 space-y-2 max-h-[400px] overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-xs">
            {tab === "active" ? "No active missions — all clear!" : "No completed missions yet"}
          </div>
        ) : (
          displayed.map((mission, i) => (
            <MissionCard key={mission.id} mission={mission} index={i} />
          ))
        )}
      </div>
    </div>
  );
}