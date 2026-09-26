"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API_URL, APP_NAME, APP_AUTHOR } from "@/lib/config";

interface MetricPoint {
  timestamp: string;
  total_latency: number;
  llm_latency: number;
  retrieval_latency: number;
  relevance_score: number | null;
  relevance_drift: number | null;
  status: string;
  feedback: number | null;
}

interface DashboardMetrics {
  stats: {
    total_requests: number;
    success_rate: number;
    avg_total_latency: number;
    avg_retrieval_latency: number;
    avg_llm_latency: number;
    avg_relevance: number;
    avg_drift: number;
    thumbs_up: number;
    thumbs_down: number;
    feedback_score: number;
  };
  charts: MetricPoint[];
  logs: (MetricPoint & { request_id: string; query: string })[];
  alerts: {
    id: number;
    type: string;
    timestamp: string;
    message: string;
    value: number;
    threshold: number;
  }[];
  settings: Record<string, string>;
}

export default function DashboardPage() {
  const [metricsData, setMetricsData] = useState<DashboardMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  
  // Settings Form State
  const [latencyThreshold, setLatencyThreshold] = useState("3.0");
  const [errorThreshold, setErrorThreshold] = useState("10.0");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [emailAlerts, setEmailAlerts] = useState("");



  const fetchMetrics = useCallback((signal?: AbortSignal) => {
    return fetch(`${API_URL}/metrics`, { signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Metrics request failed (${res.status})`);
        const data: DashboardMetrics = await res.json();
        if (signal?.aborted) return;
        setMetricsData(data);
        if (data.settings) {
          setLatencyThreshold(data.settings.latency_threshold || "3.0");
          setErrorThreshold(data.settings.error_rate_threshold || "10.0");
          setSlackWebhook(data.settings.slack_webhook || "");
          setEmailAlerts(data.settings.email_notifications || "");
        }
      })
      .catch((err: unknown) => {
        if (!signal?.aborted) console.error("Failed to fetch dashboard metrics:", err);
      })
      .finally(() => {
        if (!signal?.aborted) setLoadingMetrics(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMetrics(controller.signal);
    const interval = setInterval(() => void fetchMetrics(controller.signal), 10000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchMetrics]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_URL}/metrics/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latency_threshold: parseFloat(latencyThreshold) || 3.0,
          error_rate_threshold: parseFloat(errorThreshold) || 10.0,
          slack_webhook: slackWebhook,
          email_notifications: emailAlerts,
        }),
      });
      if (res.ok) {
        alert("Alert settings updated successfully!");
        fetchMetrics();
      } else {
        alert("Failed to update settings.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const renderLatencyChart = () => {
    const data = metricsData?.charts || [];
    if (data.length === 0) {
      return <div className="text-gray-500 text-xs h-40 flex items-center justify-center">No RAG requests captured yet.</div>;
    }

    const maxVal = Math.max(...data.map((d) => d.total_latency || 0), 1.5) * 1.15;
    const w = 500;
    const h = 180;
    const p = 25;
    const cw = w - p * 2;
    const ch = h - p * 2;

    const scaleX = (idx: number) => p + (idx / (data.length - 1 || 1)) * cw;
    const scaleY = (val: number) => p + ch - (val / maxVal) * ch;

    const pointsTotal = data.map((d, i: number) => `${scaleX(i)},${scaleY(d.total_latency || 0)}`).join(" ");
    const pointsLLM = data.map((d, i: number) => `${scaleX(i)},${scaleY(d.llm_latency || 0)}`).join(" ");
    const pointsRet = data.map((d, i: number) => `${scaleX(i)},${scaleY(d.retrieval_latency || 0)}`).join(" ");

    return (
      <div className="relative">
        <svg className="w-full h-44" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          <line x1={p} y1={p} x2={w-p} y2={p} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1={p} y1={p + ch/2} x2={w-p} y2={p + ch/2} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1={p} y1={p + ch} x2={w-p} y2={p + ch} stroke="rgba(255,255,255,0.15)" />
          
          <text x={p - 5} y={p + 3} fill="#888" fontSize="8" textAnchor="end">{maxVal.toFixed(1)}s</text>
          <text x={p - 5} y={p + ch/2 + 3} fill="#888" fontSize="8" textAnchor="end">{(maxVal/2).toFixed(1)}s</text>
          <text x={p - 5} y={p + ch + 3} fill="#888" fontSize="8" textAnchor="end">0s</text>

          {data.length > 1 && (
            <>
              <polyline fill="none" stroke="#3b82f6" strokeWidth="1.5" points={pointsRet} opacity="0.6" strokeDasharray="1,1" />
              <polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={pointsLLM} opacity="0.6" />
              <polyline fill="none" stroke="#a78bfa" strokeWidth="2.5" points={pointsTotal} />
            </>
          )}

          {data.map((d, i: number) => (
            <circle key={i} cx={scaleX(i)} cy={scaleY(d.total_latency)} r="3" fill="#a78bfa" className="cursor-pointer hover:r-4 transition-all" />
          ))}
        </svg>
        <div className="flex gap-4 justify-center text-[10px] text-gray-400 mt-2">
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-[#a78bfa]" /> Total Latency</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-[#10b981]" /> LLM Response</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-[#3b82f6] border-dashed" /> Hybrid Retrieval</span>
        </div>
      </div>
    );
  };

  const renderRelevanceChart = () => {
    const data = (metricsData?.charts || []).filter((d): d is MetricPoint & { relevance_score: number } => d.status === "success" && d.relevance_score !== null);
    if (data.length === 0) {
      return <div className="text-gray-500 text-xs h-40 flex items-center justify-center">No successful queries yet.</div>;
    }

    const w = 500;
    const h = 180;
    const p = 25;
    const cw = w - p * 2;
    const ch = h - p * 2;

    const scaleX = (idx: number) => p + (idx / (data.length - 1 || 1)) * cw;
    const scaleY = (val: number) => p + ch - (val * ch);

    const pointsRel = data.map((d, i: number) => `${scaleX(i)},${scaleY(d.relevance_score)}`).join(" ");
    const pointsDrift = data.map((d, i: number) => `${scaleX(i)},${scaleY(Math.max(0, Math.min(1, 0.5 + (d.relevance_drift ?? 0))))}`).join(" ");

    return (
      <div className="relative">
        <svg className="w-full h-44" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
          <line x1={p} y1={p} x2={w-p} y2={p} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1={p} y1={p + ch/2} x2={w-p} y2={p + ch/2} stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1={p} y1={p + ch} x2={w-p} y2={p + ch} stroke="rgba(255,255,255,0.15)" />
          
          <text x={p - 5} y={p + 3} fill="#888" fontSize="8" textAnchor="end">1.0</text>
          <text x={p - 5} y={p + ch/2 + 3} fill="#888" fontSize="8" textAnchor="end">0.5</text>
          <text x={p - 5} y={p + ch + 3} fill="#888" fontSize="8" textAnchor="end">0.0</text>

          {data.length > 1 && (
            <>
              <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={pointsDrift} opacity="0.6" strokeDasharray="2,2" />
              <polyline fill="none" stroke="#06b6d4" strokeWidth="2.5" points={pointsRel} />
            </>
          )}

          {data.map((d, i: number) => (
            <circle key={i} cx={scaleX(i)} cy={scaleY(d.relevance_score)} r="3" fill="#06b6d4" />
          ))}
        </svg>
        <div className="flex gap-4 justify-center text-[10px] text-gray-400 mt-2">
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-[#06b6d4]" /> Context Relevance</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-[#f59e0b] border-dashed" /> Relevance Drift (+/-)</span>
        </div>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-white p-6 font-sans selection:bg-emerald-500/30">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-center bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
          <div>
            <div className="flex items-center gap-2">
              <Link href="/" className="text-xs text-gray-400 hover:text-emerald-400 flex items-center gap-1">
                &larr; Back to Chat
              </Link>
            </div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-purple-400 via-blue-500 to-teal-400 bg-clip-text text-transparent mt-1">
              {APP_NAME} Operations
            </h1>
            <p className="text-xs text-gray-400 mt-1">By {APP_AUTHOR}</p>
            <p className="text-xs text-gray-400">Production-grade metrics visualizer, anomaly detector, and health logger.</p>
          </div>
          <button 
            onClick={() => { setLoadingMetrics(true); void fetchMetrics(); }}
            className="px-4 py-2 rounded-xl bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/20 text-emerald-400 text-xs transition-colors flex items-center gap-2"
            disabled={loadingMetrics}
          >
            <svg className={`w-4 h-4 ${loadingMetrics ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh Metrics
          </button>
        </div>

        {metricsData ? (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all flex flex-col justify-between">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Total Traffic</span>
                <span className="text-4xl font-extrabold text-white mt-2">{metricsData.stats.total_requests}</span>
                <span className="text-xs text-emerald-400 mt-2 flex items-center gap-1 font-medium">
                  {metricsData.stats.success_rate}% Success Rate
                </span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all flex flex-col justify-between">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Average Latency</span>
                <span className="text-4xl font-extrabold text-white mt-2">{metricsData.stats.avg_total_latency}s</span>
                <span className="text-xs text-gray-500 mt-2 font-mono">
                  Retr: {metricsData.stats.avg_retrieval_latency}s | LLM: {metricsData.stats.avg_llm_latency}s
                </span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all flex flex-col justify-between">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Context Relevance</span>
                <span className="text-4xl font-extrabold text-cyan-400 mt-2">{metricsData.stats.avg_relevance}</span>
                <span className={`text-xs mt-2 flex items-center gap-1 font-medium ${metricsData.stats.avg_drift >= 0 ? "text-emerald-400" : "text-amber-500"}`}>
                  Relevance Drift: {metricsData.stats.avg_drift >= 0 ? "+" : ""}{metricsData.stats.avg_drift}
                </span>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all flex flex-col justify-between">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">User Happiness</span>
                <span className="text-4xl font-extrabold text-purple-400 mt-2">{metricsData.stats.feedback_score}</span>
                <span className="text-xs text-gray-500 mt-2 font-mono">
                  Upvotes: {metricsData.stats.thumbs_up} | Downvotes: {metricsData.stats.thumbs_down}
                </span>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wider">Latency Profile Timeline</h3>
                {renderLatencyChart()}
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wider">Information Extraction Relevance</h3>
                {renderRelevanceChart()}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Alerts Log */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:col-span-1 flex flex-col h-80">
                <h3 className="text-sm font-bold text-rose-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Incidents & Alerts
                </h3>
                <div className="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
                  {metricsData.alerts.length === 0 ? (
                    <div className="text-gray-500 h-full flex items-center justify-center">No alert thresholds breached. System healthy.</div>
                  ) : (
                    metricsData.alerts.map((alert) => (
                      <div key={alert.id} className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
                        <div className="flex justify-between font-bold">
                          <span>{alert.type.toUpperCase()} THRESHOLD</span>
                          <span className="text-[10px] text-rose-400">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">{alert.message}</p>
                        <div className="mt-2 text-[10px] font-mono flex justify-between opacity-80">
                          <span>Observed: {alert.value}</span>
                          <span>Allowed: {alert.threshold}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Alert Settings */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 lg:col-span-2 flex flex-col h-80">
                <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wider">Operational Alert Threshold Settings</h3>
                <form onSubmit={handleSaveSettings} className="flex-1 flex flex-col justify-between text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-gray-400 mb-1">Latency Limit (seconds)</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        value={latencyThreshold} 
                        onChange={(e) => setLatencyThreshold(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 mb-1">Error Frequency Limit (%)</label>
                      <input 
                        type="number" 
                        step="1" 
                        value={errorThreshold} 
                        onChange={(e) => setErrorThreshold(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="block text-gray-400 mb-1">Slack Webhook URL</label>
                    <input 
                      type="text" 
                      placeholder="https://hooks.slack.com/services/..."
                      value={slackWebhook} 
                      onChange={(e) => setSlackWebhook(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-emerald-500 focus:outline-none text-[11px]"
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-gray-400 mb-1">Alert Destination Email</label>
                    <input 
                      type="email" 
                      placeholder="alerts@example.com"
                      value={emailAlerts} 
                      onChange={(e) => setEmailAlerts(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 focus:border-emerald-500 focus:outline-none text-[11px]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="mt-4 w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold py-2.5 rounded-xl transition-all hover:opacity-90 text-xs"
                  >
                    {savingSettings ? "Updating..." : "Save System Settings"}
                  </button>
                </form>
              </div>
            </div>

            {/* Audit Log Table */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-gray-300 mb-4 uppercase tracking-wider">Live Request Audit Log</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-400">
                      <th className="pb-3">Time</th>
                      <th className="pb-3">Query</th>
                      <th className="pb-3">Total Latency</th>
                      <th className="pb-3">Relevance</th>
                      <th className="pb-3">Reaction</th>
                      <th className="pb-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsData.logs.map((log) => (
                      <tr key={log.request_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 text-gray-500 font-mono">{new Date(log.timestamp).toLocaleTimeString()}</td>
                        <td className="py-3 text-gray-300 truncate max-w-sm" title={log.query}>{log.query}</td>
                        <td className="py-3 text-gray-300 font-mono">{log.total_latency?.toFixed(2)}s</td>
                        <td className="py-3 text-cyan-400 font-mono">{log.relevance_score !== null ? log.relevance_score.toFixed(2) : "-"}</td>
                        <td className="py-3">
                          {log.feedback === 1 ? "👍 Upvoted" : log.feedback === -1 ? "👎 Downvoted" : "-"}
                        </td>
                        <td className="py-3 text-right">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${log.status === "success" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"}`}>
                            {log.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center text-gray-500 text-sm">
            {loadingMetrics ? "Loading metrics..." : "Cannot reach metrics backend server. Verify the FastAPI application is running."}
          </div>
        )}
      </div>
    </main>
  );
}

