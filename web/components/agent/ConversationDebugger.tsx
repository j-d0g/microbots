"use client";

/**
 * ConversationDebugger
 *
 * A comprehensive debug panel for monitoring the end-to-end conversation flow.
 * Shows real-time state from the agent store and intercepts console logs
 * related to conversation, audio, and intent processing.
 *
 * Features:
 * - Real-time conversation mode state
 * - Dock state visualization
 * - Audio/VAD status monitoring
 * - Intent extraction logs
 * - WebSocket connection status
 * - Recent conversation history
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useAgentStore, type DockState } from "@/lib/store";
import type { ConversationTurn, IntentSummary } from "@/lib/agent/conversation-types";

interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
}

interface PipelineStatus {
  micAccess: boolean;
  websocketConnected: boolean;
  audioCapturing: boolean;
  audioSending: boolean;
  audioReceiving: boolean;
  audioPlaying: boolean;
  transcriptReceived: boolean;
  intentExtracted: boolean;
  uiActionTriggered: boolean;
}

export function ConversationDebugger() {
  /* Hidden by default. Toggle with Cmd/Ctrl+Shift+D. We persist the
   * preference in localStorage so the panel stays open across reloads
   * once you've intentionally summoned it. */
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("conversation-debugger:visible") === "1") {
      setVisible(true);
    }
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        setVisible((v) => {
          const next = !v;
          window.localStorage.setItem(
            "conversation-debugger:visible",
            next ? "1" : "0",
          );
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<"logs" | "state" | "pipeline" | "history">("pipeline");
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Pipeline test status
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>({
    micAccess: false,
    websocketConnected: false,
    audioCapturing: false,
    audioSending: false,
    audioReceiving: false,
    audioPlaying: false,
    transcriptReceived: false,
    intentExtracted: false,
    uiActionTriggered: false,
  });

  // Store selectors
  const store = useAgentStore();
  const conversationMode = useAgentStore((s) => s.conversationMode);
  const dock = useAgentStore((s) => s.dock);
  const isAgentSpeaking = useAgentStore((s) => s.isAgentSpeaking);
  const conversationHistory = useAgentStore((s) => s.conversationHistory);
  const currentIntent = useAgentStore((s) => s.currentIntent);
  const transcript = useAgentStore((s) => s.transcript);
  const agentStatus = useAgentStore((s) => s.agentStatus);
  const windows = useAgentStore((s) => s.windows);

  // Add log entry helper
  const addLog = useCallback((level: LogEntry["level"], source: string, message: string) => {
    setLogs((prev) => {
      const entry: LogEntry = {
        timestamp: Date.now(),
        level,
        source,
        message: message.slice(0, 200), // Truncate long messages
      };
      return [...prev.slice(-50), entry];
    });
  }, []);

  /* Intercept console methods only while the panel is open. Otherwise
   * the wrapper shows up in every unrelated console.error stack trace
   * (and pays a small runtime cost on every log). */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!visible) return;

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const relevantPatterns = [
      "[conversation",
      "[intent",
      "[audio",
      "[VAD",
      "[voice",
      "[agent-client",
      "[conversation-bridge",
      "[chat-persist",
    ];

    console.log = (...args: unknown[]) => {
      const msg = args.map((a) => String(a)).join(" ");
      if (relevantPatterns.some((p) => msg.includes(p))) {
        addLog("info", extractSource(msg), msg);
      }
      originalLog.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      const msg = args.map((a) => String(a)).join(" ");
      if (relevantPatterns.some((p) => msg.includes(p))) {
        addLog("warn", extractSource(msg), msg);
      }
      originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      const msg = args.map((a) => String(a)).join(" ");
      if (relevantPatterns.some((p) => msg.includes(p))) {
        addLog("error", extractSource(msg), msg);
      }
      originalError.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [addLog, visible]);

  // Track pipeline state changes
  useEffect(() => {
    // Update pipeline status based on store state
    setPipelineStatus((prev) => ({
      ...prev,
      audioCapturing: dock === "listening" || dock === "conversing",
      audioPlaying: isAgentSpeaking,
      transcriptReceived: transcript.length > 0,
      intentExtracted: currentIntent !== null,
      uiActionTriggered: windows.length > 0,
    }));
  }, [dock, isAgentSpeaking, transcript, currentIntent, windows.length]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current && activeTab === "logs") {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, activeTab]);

  // Track WebSocket connection (if available)
  useEffect(() => {
    // Check for WebSocket in window
    const checkWebSocket = () => {
      // This is a heuristic - in a real implementation you'd track the actual WebSocket
      setPipelineStatus((prev) => ({
        ...prev,
        websocketConnected: conversationMode, // Assume connected if mode is on
      }));
    };
    checkWebSocket();
  }, [conversationMode]);

  if (process.env.NODE_ENV === "production") return null;

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  const getDockColor = (d: DockState) => {
    switch (d) {
      case "idle": return "text-gray-400";
      case "listening": return "text-green-400";
      case "thinking": return "text-yellow-400";
      case "speaking": return "text-blue-400";
      case "conversing": return "text-purple-400";
      case "hidden": return "text-gray-600";
      default: return "text-gray-400";
    }
  };

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "info": return "text-green-400";
      case "warn": return "text-yellow-400";
      case "error": return "text-red-400";
      case "debug": return "text-blue-400";
      default: return "text-gray-400";
    }
  };

  const extractSource = (msg: string): string => {
    const match = msg.match(/^\[([^\]]+)\]/);
    return match ? match[1] : "unknown";
  };

  const runDiagnostics = async () => {
    addLog("info", "debugger", "🔍 Running conversation pipeline diagnostics...");
    
    // Check 1: Mic permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setPipelineStatus(p => ({ ...p, micAccess: true }));
      addLog("info", "debugger", "✅ Microphone access granted");
    } catch (err) {
      setPipelineStatus(p => ({ ...p, micAccess: false }));
      addLog("error", "debugger", `❌ Microphone access denied: ${err}`);
    }

    // Check 2: API endpoints
    const endpoints = ["/api/stt", "/api/tts", "/api/voice/config", "/api/agent/orchestrate"];
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { method: "HEAD" });
        addLog("info", "debugger", `${res.ok ? "✅" : "⚠️"} ${endpoint} - ${res.status}`);
      } catch (err) {
        addLog("error", "debugger", `❌ ${endpoint} - ${err}`);
      }
    }

    addLog("info", "debugger", "🏁 Diagnostics complete");
  };

  const toggleConversationMode = () => {
    store.toggleConversationMode();
    addLog("info", "debugger", `🔄 Conversation mode toggled: ${!conversationMode ? "ON" : "OFF"}`);
  };

  const simulateTranscript = () => {
    const testPhrase = "open the graph";
    store.appendTranscript(testPhrase);
    addLog("info", "debugger", `📝 Simulated transcript: "${testPhrase}"`);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  if (!visible) return null;

  return (
    <div className={`fixed top-4 right-4 z-50 font-mono text-xs transition-all duration-200 ${isExpanded ? "w-96" : "w-auto"}`}>
      {/* Header */}
      <div 
        className="bg-black/90 text-green-400 p-3 rounded-t-lg border border-green-800 cursor-pointer flex items-center justify-between"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-bold">🎙️ Conversation Debug</span>
          {conversationMode && (
            <span className="px-1.5 py-0.5 bg-green-900/50 text-green-300 rounded text-[10px]">
              ACTIVE
            </span>
          )}
        </div>
        <button className="text-green-600 hover:text-green-400">
          {isExpanded ? "▼" : "▶"}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Quick Stats Bar */}
          <div className="bg-black/80 border-x border-green-800 p-2 flex gap-3 text-[10px]">
            <div className={`flex items-center gap-1 ${conversationMode ? "text-green-400" : "text-gray-500"}`}>
              <span>{conversationMode ? "●" : "○"}</span> Mode
            </div>
            <div className={`flex items-center gap-1 ${getDockColor(dock)}`}>
              <span>{dock === "listening" ? "●" : dock === "speaking" ? "🔊" : "○"}</span> {dock}
            </div>
            <div className={`flex items-center gap-1 ${isAgentSpeaking ? "text-blue-400" : "text-gray-500"}`}>
              <span>{isAgentSpeaking ? "🔊" : "○"}</span> Speaking
            </div>
            <div className="text-gray-500">
              {windows.length} windows
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-black/80 border-x border-green-800 flex">
            {(["pipeline", "state", "logs", "history"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 text-[10px] uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? "bg-green-900/30 text-green-400 border-b-2 border-green-500"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="bg-black/90 border-x border-b border-green-800 rounded-b-lg p-3 max-h-80 overflow-auto">
            
            {/* Pipeline Tab */}
            {activeTab === "pipeline" && (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Pipeline Checklist
                </div>
                <PipelineItem 
                  label="1. Conversation Mode Toggle" 
                  status={conversationMode ? "pass" : "idle"}
                  detail={conversationMode ? "Enabled" : "Disabled - click to test"}
                />
                <PipelineItem 
                  label="2. Microphone Access" 
                  status={pipelineStatus.micAccess ? "pass" : "idle"}
                  detail={pipelineStatus.micAccess ? "Granted" : "Not tested"}
                />
                <PipelineItem 
                  label="3. Audio Capture (VAD)" 
                  status={dock === "listening" ? "active" : pipelineStatus.audioCapturing ? "pass" : "idle"}
                  detail={dock === "listening" ? "Listening now!" : "Waiting..."}
                />
                <PipelineItem 
                  label="4. Audio Sent to STT" 
                  status={pipelineStatus.audioSending ? "active" : "idle"}
                  detail={dock === "thinking" ? "Processing..." : "-"}
                />
                <PipelineItem 
                  label="5. Transcript Received" 
                  status={transcript ? "pass" : "idle"}
                  detail={transcript ? `"${transcript.slice(0, 30)}..."` : "No transcript yet"}
                />
                <PipelineItem 
                  label="6. Intent Extracted" 
                  status={currentIntent ? "pass" : "idle"}
                  detail={currentIntent ? `${currentIntent.action} → ${currentIntent.target || "?"}` : "No intent"}
                />
                <PipelineItem 
                  label="7. UI Action Triggered" 
                  status={windows.length > 0 ? "pass" : "idle"}
                  detail={`${windows.length} windows open`}
                />
                <PipelineItem 
                  label="8. Agent Response (TTS)" 
                  status={isAgentSpeaking ? "active" : agentStatus ? "pass" : "idle"}
                  detail={isAgentSpeaking ? "Speaking..." : agentStatus || "No response"}
                />

                {/* Action Buttons */}
                <div className="flex gap-2 mt-3 pt-2 border-t border-green-800">
                  <button
                    onClick={toggleConversationMode}
                    className={`flex-1 py-1.5 px-2 rounded text-[10px] font-bold transition-colors ${
                      conversationMode
                        ? "bg-red-900/50 text-red-400 hover:bg-red-900/70"
                        : "bg-green-900/50 text-green-400 hover:bg-green-900/70"
                    }`}
                  >
                    {conversationMode ? "Stop Mode" : "Start Mode"}
                  </button>
                  <button
                    onClick={runDiagnostics}
                    className="flex-1 py-1.5 px-2 rounded text-[10px] bg-blue-900/50 text-blue-400 hover:bg-blue-900/70"
                  >
                    Diagnose
                  </button>
                  <button
                    onClick={simulateTranscript}
                    className="flex-1 py-1.5 px-2 rounded text-[10px] bg-purple-900/50 text-purple-400 hover:bg-purple-900/70"
                  >
                    Simulate
                  </button>
                </div>
              </div>
            )}

            {/* State Tab */}
            {activeTab === "state" && (
              <div className="space-y-1 text-[10px]">
                <StateRow label="conversationMode" value={String(conversationMode)} />
                <StateRow label="dock" value={dock} color={getDockColor(dock)} />
                <StateRow label="isAgentSpeaking" value={String(isAgentSpeaking)} />
                <StateRow label="transcript" value={transcript || "(empty)"} />
                <StateRow label="agentStatus" value={agentStatus || "(none)"} />
                <StateRow label="chatRoom" value={store.chatRoom} />
                <StateRow label="uiMode" value={store.uiMode} />
                <StateRow label="windows.count" value={String(windows.length)} />
                <StateRow label="windows.types" value={windows.map(w => w.kind).join(", ") || "(none)"} />
                <StateRow label="history.length" value={String(conversationHistory.length)} />
                <StateRow label="currentIntent" value={currentIntent ? `${currentIntent.action}:${currentIntent.target}` : "(none)"} />
                <StateRow label="quietMode" value={String(store.quietMode)} />
                <StateRow label="confirmQueue" value={String(store.confirmQueue.length)} />
              </div>
            )}

            {/* Logs Tab */}
            {activeTab === "logs" && (
              <div className="space-y-1">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] text-gray-500">Recent Logs</span>
                  <button 
                    onClick={clearLogs}
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    Clear
                  </button>
                </div>
                <div className="space-y-0.5">
                  {logs.length === 0 ? (
                    <div className="text-gray-600 italic">No logs yet...</div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="break-all">
                        <span className="text-gray-600">{formatTime(log.timestamp).split(".")[0]}</span>{" "}
                        <span className={getLevelColor(log.level)}>[{log.source}]</span>{" "}
                        <span className="text-gray-300">{log.message}</span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}

            {/* History Tab */}
            {activeTab === "history" && (
              <div className="space-y-2">
                {conversationHistory.length === 0 ? (
                  <div className="text-gray-600 italic text-center py-4">
                    No conversation history yet...
                  </div>
                ) : (
                  conversationHistory.map((turn, i) => (
                    <div 
                      key={turn.id} 
                      className={`p-2 rounded border ${
                        turn.role === "user" 
                          ? "bg-green-900/20 border-green-800" 
                          : turn.role === "agent"
                          ? "bg-blue-900/20 border-blue-800"
                          : "bg-gray-800 border-gray-700"
                      }`}
                    >
                      <div className="flex justify-between text-[10px] text-gray-500">
                        <span className={turn.role === "user" ? "text-green-400" : "text-blue-400"}>
                          {turn.role}
                        </span>
                        <span>{formatTime(turn.timestamp)}</span>
                      </div>
                      <div className="text-gray-300 mt-1">{turn.text}</div>
                      {turn.intent && (
                        <div className="text-[10px] text-yellow-400 mt-1">
                          Intent: {turn.intent.action} {turn.intent.target ? `→ ${turn.intent.target}` : ""}
                          {" "}(confidence: {Math.round(turn.intent.confidence * 100)}%)
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PipelineItem({ 
  label, 
  status, 
  detail 
}: { 
  label: string; 
  status: "pass" | "fail" | "active" | "idle";
  detail: string;
}) {
  const colors = {
    pass: "text-green-400",
    fail: "text-red-400",
    active: "text-blue-400 animate-pulse",
    idle: "text-gray-500",
  };

  const icons = {
    pass: "✓",
    fail: "✗",
    active: "●",
    idle: "○",
  };

  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className={colors[status]}>{icons[status]}</span>
        <span className={status === "idle" ? "text-gray-500" : "text-gray-300"}>
          {label}
        </span>
      </div>
      <span className="text-[10px] text-gray-600 truncate max-w-32" title={detail}>
        {detail}
      </span>
    </div>
  );
}

function StateRow({ 
  label, 
  value, 
  color = "text-gray-300" 
}: { 
  label: string; 
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between border-b border-gray-800 py-1">
      <span className="text-gray-500">{label}</span>
      <span className={`${color} truncate max-w-40`} title={value}>{value}</span>
    </div>
  );
}
