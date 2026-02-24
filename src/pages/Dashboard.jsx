import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

import StatsBar from "@/components/dashboard/StatsBar";
import CameraGrid from "@/components/dashboard/CameraGrid";
import MissionsList from "@/components/dashboard/MissionsList";
import TeamStatus from "@/components/dashboard/TeamStatus";
import AnalyticsCharts from "@/components/dashboard/AnalyticsCharts";
import ActivityFeed from "@/components/dashboard/ActivityFeed";

export default function Dashboard() {
  const { data: cameras = [], isLoading: camerasLoading } = useQuery({
    queryKey: ["cameras"],
    queryFn: () => base44.entities.Camera.list("-created_date"),
  });

  const { data: missions = [], isLoading: missionsLoading } = useQuery({
    queryKey: ["missions"],
    queryFn: () => base44.entities.Mission.list("-created_date", 50),
  });

  const { data: team = [], isLoading: teamLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => base44.entities.TeamMember.list(),
  });

  const statsData = {
    cameras: cameras.filter(c => c.status !== "offline").length,
    activeMissions: missions.filter(m => m.status !== "completed").length,
    completed: missions.filter(m => m.status === "completed").length,
    teamAvailable: team.filter(t => t.status === "available").length,
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* Page title */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-gray-100">Command Center</h1>
        <p className="text-xs text-gray-500 mt-1">Real-time monitoring & mission control</p>
      </div>

      {/* Stats */}
      <StatsBar data={statsData} />

      {/* Camera Grid */}
      <CameraGrid cameras={cameras} isLoading={camerasLoading} />

      {/* Missions + Team + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <MissionsList missions={missions} isLoading={missionsLoading} />
        </div>
        <div className="lg:col-span-1">
          <TeamStatus members={team} isLoading={teamLoading} />
        </div>
        <div className="lg:col-span-1">
          <ActivityFeed missions={missions} />
        </div>
      </div>

      {/* Analytics */}
      <AnalyticsCharts missions={missions} />
    </div>
  );
}