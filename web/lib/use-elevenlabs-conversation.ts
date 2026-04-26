"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "./store";
import type { IntentSummary } from "./agent/conversation-types";

interface ElevenLabsConversationOptions {
  agentId: string;
  apiKey: string;
  onIntent?: (intent: IntentSummary) => void;
  onTranscript?: (text: string) => void;
  onAudio?: (base64Audio: string) => void;
}

export function useElevenLabsConversation(opts: ElevenLabsConversationOptions | null) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const store = useAgentStore();

  const connect = useCallback(async () => {
    if (!opts || wsRef.current) return;
    
    setConnecting(true);
    setError(null);
    
    try {
      const ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/convai/agents/${opts.agentId}/stream?xi-api-key=${opts.apiKey}`
      );
      
      ws.onopen = () => {
        console.log("[ElevenLabs] Connected");
        setConnected(true);
        setConnecting(false);
      };
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log("[ElevenLabs] Received:", msg.type);
        
        switch (msg.type) {
          case "audio":
            opts.onAudio?.(msg.audio);
            break;
          case "user_transcript":
            opts.onTranscript?.(msg.text);
            break;
          case "agent_response":
            // Parse intent from response
            break;
          case "error":
            console.error("[ElevenLabs] Error:", msg.error);
            setError(msg.error);
            break;
        }
      };
      
      ws.onerror = (e) => {
        console.error("[ElevenLabs] WebSocket error:", e);
        setError("WebSocket error");
        setConnected(false);
      };
      
      ws.onclose = () => {
        console.log("[ElevenLabs] Disconnected");
        setConnected(false);
        wsRef.current = null;
      };
      
      wsRef.current = ws;
    } catch (e) {
      setError(String(e));
      setConnecting(false);
    }
  }, [opts]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const sendAudio = useCallback((base64Audio: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "user_audio",
        audio: base64Audio
      }));
    }
  }, []);

  const sendAudioEnd = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "user_audio_end" }));
    }
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    connected,
    connecting,
    error,
    connect,
    disconnect,
    sendAudio,
    sendAudioEnd
  };
}
