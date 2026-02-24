import React from "react";
import CameraCard from "./CameraCard";
import { Camera } from "lucide-react";

export default function CameraGrid({ cameras, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array(4).fill(0).map((_, i) => (
          <div key={i} className="rounded-xl bg-[#111827]/60 border border-white/[0.06] overflow-hidden">
            <div className="aspect-video bg-gray-800/50 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-gray-700/50 rounded w-2/3 animate-pulse" />
              <div className="h-2 bg-gray-700/30 rounded w-1/2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Camera className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-gray-200">Live Camera Feeds</h2>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-medium">
          {cameras.filter(c => c.status !== "offline").length} active
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cameras.map((camera, i) => (
          <CameraCard key={camera.id} camera={camera} index={i} />
        ))}
      </div>
    </div>
  );
}