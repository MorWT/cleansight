import React from "react";
import { motion } from "framer-motion";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

const statusConfig = {
  online: { dot: "bg-emerald-400", label: "Live", labelColor: "text-emerald-400", border: "border-emerald-500/20" },
  detecting: { dot: "bg-amber-400 animate-pulse", label: "Detecting", labelColor: "text-amber-400", border: "border-amber-500/30" },
  offline: { dot: "bg-gray-500", label: "Offline", labelColor: "text-gray-500", border: "border-gray-600/30" },
};

export default function CameraCard({ camera, index }) {
  const cfg = statusConfig[camera.status] || statusConfig.online;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.06 }}
      className={`group relative rounded-xl border ${cfg.border} bg-[#111827]/60 backdrop-blur-sm overflow-hidden hover:border-cyan-500/30 transition-all duration-300`}
    >
      {/* Camera feed placeholder */}
      <div className="relative aspect-video bg-gradient-to-br from-gray-900 to-gray-800 overflow-hidden">
        {camera.thumbnail_url ? (
          <img src={camera.thumbnail_url} alt={camera.name} className="w-full h-full object-cover opacity-80" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.03] flex items-center justify-center">
              {camera.status === "offline" ? (
                <WifiOff className="w-6 h-6 text-gray-600" />
              ) : (
                <Wifi className="w-6 h-6 text-cyan-500/50" />
              )}
            </div>
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm">
          <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          <span className={`text-[10px] font-medium ${cfg.labelColor}`}>{cfg.label}</span>
        </div>

        {/* Detection alert overlay */}
        {camera.status === "detecting" && (
          <div className="absolute inset-0 border-2 border-amber-400/40 rounded-xl pointer-events-none">
            <div className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-amber-500/20 backdrop-blur-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
          </div>
        )}

        {/* Scan line effect for detecting */}
        {camera.status === "detecting" && (
          <div className="absolute inset-0 scan-line pointer-events-none" />
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-200 truncate">{camera.name}</h3>
          {camera.detection_count_today > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
              {camera.detection_count_today} alerts
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5 truncate">{camera.location}</p>
      </div>
    </motion.div>
  );
}