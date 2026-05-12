-- Average time from MissionCreated → Assigned (T_assign)
SELECT AVG(EXTRACT(EPOCH FROM (t_assigned - t_created))) AS T_assign_avg_seconds
FROM kpi_task_deltas
WHERE t_assigned IS NOT NULL;

-- Average time from Assigned → CleanerOnSite (T_arrival)
SELECT AVG(EXTRACT(EPOCH FROM (t_onsite - t_assigned))) AS T_arrival_avg_seconds
FROM kpi_task_deltas
WHERE t_onsite IS NOT NULL AND t_assigned IS NOT NULL;

-- Average time from CleanerOnSite → Verification (T_clear)
SELECT AVG(EXTRACT(EPOCH FROM (t_verify - t_onsite))) AS T_clear_avg_seconds
FROM kpi_task_deltas
WHERE t_verify IS NOT NULL AND t_onsite IS NOT NULL;

-- Average time from MissionCreated → Resolved (T_resolve)
SELECT AVG(EXTRACT(EPOCH FROM (t_resolved - t_created))) AS T_resolve_avg_seconds
FROM kpi_task_deltas
WHERE t_resolved IS NOT NULL AND t_created IS NOT NULL;

-- Assignment success rate (missions that reached 'Assigned')
SELECT 100.0 * COUNT(t_assigned) / COUNT(*) AS assignment_success_rate_percent
FROM kpi_task_deltas;

-- First-pass resolution rate (resolved without 'Reopen')
SELECT 100.0 * COUNT(*) FILTER (WHERE t_resolved IS NOT NULL)
       / NULLIF(COUNT(*),0) AS first_pass_resolution_percent
FROM tasks
WHERE status = 'Resolved';

-- Optional: False-positive rate (missions canceled because mess not real)
SELECT 100.0 * COUNT(*) FILTER (WHERE status = 'Canceled')
       / NULLIF(COUNT(*),0) AS false_positive_rate_percent
FROM tasks;
