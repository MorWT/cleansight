import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Loader2, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const DETECTION_TYPES = [
  "trash",
  "messy desk",
  "objects on the floor",
  "scattered paper",
  "dirty dishes",
  "misplaced dishes",
  "misaligned chair",
  "messy room",
];

export default function SimulateDetection({ cameras, onDetectionCreated }) {
  const [selectedCamera, setSelectedCamera] = useState("");
  const [detectionType, setDetectionType] = useState("trash");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleSimulate = async () => {
    if (!selectedCamera) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke("processDetection", {
        action: "simulate",
        camera_id: selectedCamera,
        detection_type: detectionType,
        confidence: 85,
      });
      setResult({ type: "success", message: `Mission created & assigned!`, data: res.data });
      if (onDetectionCreated) onDetectionCreated();
    } catch (e) {
      setResult({ type: "error", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111827]/40 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-gray-200">Simulate Detection</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">DEMO</span>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] text-gray-500 mb-1 block">Camera</label>
          <Select value={selectedCamera} onValueChange={setSelectedCamera}>
            <SelectTrigger className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-gray-200">
              <SelectValue placeholder="Select camera…" />
            </SelectTrigger>
            <SelectContent>
              {cameras.map(c => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name} — {c.location}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-[160px]">
          <label className="text-[10px] text-gray-500 mb-1 block">Detection Type</label>
          <Select value={detectionType} onValueChange={setDetectionType}>
            <SelectTrigger className="h-8 text-xs bg-white/[0.04] border-white/[0.08] text-gray-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DETECTION_TYPES.map(t => (
                <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          disabled={!selectedCamera || loading}
          onClick={handleSimulate}
          className="h-8 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
          Fire
        </Button>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`mt-2 text-[11px] flex items-center gap-1.5 ${result.type === "success" ? "text-emerald-400" : "text-red-400"}`}
          >
            {result.type === "success" && <CheckCircle2 className="w-3.5 h-3.5" />}
            {result.message}
            {result.data?.assigned_to && (
              <span className="text-gray-500">→ assigned to {result.data.assigned_to}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}