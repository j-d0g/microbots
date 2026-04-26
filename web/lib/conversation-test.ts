/**
 * Conversation Test Harness
 *
 * Test functions to verify each component of the conversation pipeline.
 * Includes mock audio data, mock WebSocket, and diagnostic utilities.
 */

import { useAgentStore } from "./store";
import { ALL_FAST_PATH_PATTERNS, type ConversationTurn, type IntentSummary } from "./agent/conversation-types";

// ============================================================================
// Test Result Types
// ============================================================================

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface PipelineTestResults {
  timestamp: number;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

// ============================================================================
// Mock Data
// ============================================================================

/** Mock audio data for testing (base64 encoded short silence) */
export const MOCK_AUDIO_DATA = {
  /** Base64 encoded WebM silence (1 second) */
  webm: "GkXfo59ChoEBQveBAULygQRC84EIQoKId2hChwDgQGEaGCAJBq0HhAomMhwFDILAiJCgA", // Truncated sample
  /** Base64 encoded WAV silence */
  wav: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
  /** Generate a blob of audio data */
  createBlob: (type: "webm" | "wav" = "webm") => {
    const base64 = type === "webm" ? MOCK_AUDIO_DATA.webm : MOCK_AUDIO_DATA.wav;
    const byteString = atob(base64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      bytes[i] = byteString.charCodeAt(i);
    }
    return new Blob([bytes], { type: type === "webm" ? "audio/webm" : "audio/wav" });
  },
};

/** Mock WebSocket for testing ElevenLabs connection */
export class MockWebSocket {
  url: string;
  readyState: number = WebSocket.CONNECTING;
  onopen: ((this: MockWebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: MockWebSocket, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: MockWebSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: MockWebSocket, ev: CloseEvent) => unknown) | null = null;

  private messageQueue: string[] = [];
  private simulateLatency = true;

  constructor(url: string | URL) {
    this.url = url.toString();
    
    // Simulate connection delay
    setTimeout(() => {
      this.readyState = WebSocket.OPEN;
      if (this.onopen) {
        this.onopen.call(this, new Event("open"));
      }
      
      // Send initial greeting
      this.simulateMessage({
        type: "agent_response",
        response: "Hello! I'm ready to help you.",
        isFinal: true,
      });
    }, 100);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    // Simulate processing user message
    setTimeout(() => {
      // Simulate transcript
      this.simulateMessage({
        type: "user_transcript",
        text: "open the graph",
        isFinal: true,
      });

      // Simulate agent response
      setTimeout(() => {
        this.simulateMessage({
          type: "agent_response",
          response: "I'll open the knowledge graph for you.",
          isFinal: true,
        });

        // Simulate audio
        setTimeout(() => {
          this.simulateMessage({
            type: "audio",
            audio: MOCK_AUDIO_DATA.webm,
            isFinal: true,
          });
        }, 200);
      }, 300);
    }, 100);
  }

  close(code?: number, reason?: string): void {
    this.readyState = WebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = WebSocket.CLOSED;
      if (this.onclose) {
        this.onclose.call(this, new CloseEvent("close", { code, reason }));
      }
    }, 50);
  }

  private simulateMessage(data: unknown): void {
    const message = JSON.stringify(data);
    this.messageQueue.push(message);
    
    if (this.onmessage) {
      const latency = this.simulateLatency ? Math.random() * 200 : 0;
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage.call(this, new MessageEvent("message", { data: message }));
        }
      }, latency);
    }
  }
}

// ============================================================================
// Test Functions
// ============================================================================

/**
 * Test 1: Conversation Mode Toggle
 * Verifies the store can toggle conversation mode
 */
export async function testConversationModeToggle(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    const store = useAgentStore.getState();
    const initialState = store.conversationMode;
    
    // Toggle on
    store.setConversationMode(true);
    if (!useAgentStore.getState().conversationMode) {
      throw new Error("Failed to enable conversation mode");
    }

    // Toggle off
    store.setConversationMode(false);
    if (useAgentStore.getState().conversationMode) {
      throw new Error("Failed to disable conversation mode");
    }

    // Restore initial state
    store.setConversationMode(initialState);

    return {
      name: "Conversation Mode Toggle",
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name: "Conversation Mode Toggle",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 2: WebSocket Connection (Simulated)
 * Verifies WebSocket can connect and exchange messages
 */
export async function testWebSocketConnection(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    // Create mock WebSocket
    const ws = new MockWebSocket("wss://api.elevenlabs.io/v1/convai/conversation");
    
    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout")), 2000);
      
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };
    });

    // Test sending a message
    ws.send(JSON.stringify({ type: "ping" }));

    // Wait for response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Response timeout")), 2000);
      
      ws.onmessage = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    ws.close();

    return {
      name: "WebSocket Connection (Mock)",
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name: "WebSocket Connection (Mock)",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 3: Audio Capture Simulation
 * Verifies audio capture functionality
 */
export async function testAudioCapture(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    // Check for MediaRecorder support
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder not supported");
    }

    // Check supported MIME types
    const supportedTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
    ];
    const availableTypes = supportedTypes.filter(t => MediaRecorder.isTypeSupported(t));

    if (availableTypes.length === 0) {
      throw new Error("No supported audio MIME types");
    }

    // Create a test stream (this requires mic permission in real browser)
    // For testing, we use a generated audio blob
    const audioBlob = MOCK_AUDIO_DATA.createBlob("webm");
    
    if (audioBlob.size === 0) {
      throw new Error("Failed to create audio blob");
    }

    return {
      name: "Audio Capture",
      passed: true,
      duration: performance.now() - start,
      details: {
        supportedTypes: availableTypes,
        blobSize: audioBlob.size,
      },
    };
  } catch (error) {
    return {
      name: "Audio Capture",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 4: Intent Pattern Matching
 * Verifies fast-path intent patterns work correctly
 */
export async function testIntentExtraction(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    const testCases = [
      { input: "show me the graph", expectedAction: "navigate", expectedTarget: "graph" },
      { input: "open chat", expectedAction: "navigate", expectedTarget: "chat" },
      { input: "view my entities", expectedAction: "navigate", expectedTarget: "entities" },
      { input: "hello", expectedAction: "chat", expectedTarget: undefined },
      { input: "yes", expectedAction: "confirm", expectedTarget: "current" },
      { input: "cancel", expectedAction: "cancel", expectedTarget: "current" },
    ];

    const results = testCases.map(({ input, expectedAction, expectedTarget }) => {
      let matched = null;
      for (const pattern of ALL_FAST_PATH_PATTERNS) {
        if (pattern.pattern.test(input)) {
          matched = pattern;
          break;
        }
      }
      
      return {
        input,
        passed: matched?.action === expectedAction && matched?.target === expectedTarget,
        actual: matched,
      };
    });

    const failedTests = results.filter(r => !r.passed);
    
    if (failedTests.length > 0) {
      throw new Error(`Failed tests: ${failedTests.map(f => f.input).join(", ")}`);
    }

    return {
      name: "Intent Extraction",
      passed: true,
      duration: performance.now() - start,
      details: {
        testsRun: testCases.length,
        passed: results.filter(r => r.passed).length,
      },
    };
  } catch (error) {
    return {
      name: "Intent Extraction",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 5: Store State Management
 * Verifies conversation state is properly managed
 */
export async function testStoreStateManagement(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    const store = useAgentStore.getState();
    
    // Test adding conversation turns
    const testTurn: ConversationTurn = {
      id: `test-${Date.now()}`,
      role: "user",
      text: "test message",
      timestamp: Date.now(),
    };

    store.addConversationTurn(testTurn);
    
    const history = useAgentStore.getState().conversationHistory;
    if (!history.find(t => t.id === testTurn.id)) {
      throw new Error("Failed to add conversation turn");
    }

    // Test setting intent
    const testIntent: IntentSummary = {
      action: "navigate",
      target: "graph",
      confidence: 0.95,
      rawTranscript: "open the graph",
      timestamp: new Date().toISOString(),
    };

    store.setCurrentIntent(testIntent);
    
    if (useAgentStore.getState().currentIntent?.action !== "navigate") {
      throw new Error("Failed to set current intent");
    }

    // Clean up
    store.clearConversation();
    
    if (useAgentStore.getState().conversationHistory.length !== 0) {
      throw new Error("Failed to clear conversation");
    }

    return {
      name: "Store State Management",
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name: "Store State Management",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 6: Dock State Transitions
 * Verifies dock states can be set correctly
 */
export async function testDockStateTransitions(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    const store = useAgentStore.getState();
    const states: Array<"idle" | "listening" | "thinking" | "speaking" | "conversing" | "hidden"> = [
      "idle", "listening", "thinking", "speaking", "conversing", "idle"
    ];

    for (const state of states) {
      store.setDock(state);
      const current = useAgentStore.getState().dock;
      if (current !== state) {
        throw new Error(`Expected dock state ${state}, got ${current}`);
      }
      // Small delay to simulate transition
      await new Promise(r => setTimeout(r, 10));
    }

    return {
      name: "Dock State Transitions",
      passed: true,
      duration: performance.now() - start,
      details: {
        statesTested: states.length,
      },
    };
  } catch (error) {
    return {
      name: "Dock State Transitions",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 7: Window Open/Close
 * Verifies windows can be opened and closed via intent
 */
export async function testWindowOperations(): Promise<TestResult> {
  const start = performance.now();
  
  try {
    const store = useAgentStore.getState();
    const initialWindowCount = store.windows.length;

    // Open a window
    const windowId = store.openWindow("graph");
    
    if (!windowId) {
      throw new Error("Failed to open window");
    }

    const afterOpen = useAgentStore.getState().windows.length;
    if (afterOpen !== initialWindowCount + 1) {
      throw new Error(`Expected ${initialWindowCount + 1} windows, got ${afterOpen}`);
    }

    // Close the window
    store.closeWindow(windowId);
    
    const afterClose = useAgentStore.getState().windows.length;
    if (afterClose !== initialWindowCount) {
      throw new Error(`Expected ${initialWindowCount} windows after close, got ${afterClose}`);
    }

    return {
      name: "Window Open/Close",
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name: "Window Open/Close",
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test 8: API Endpoint Availability
 * Verifies API endpoints are accessible
 */
export async function testApiEndpoints(): Promise<TestResult> {
  const start = performance.now();
  
  const endpoints = [
    { path: "/api/voice/config", method: "GET" },
    { path: "/api/stt", method: "POST" },
    { path: "/api/tts", method: "POST" },
    { path: "/api/agent/orchestrate", method: "POST" },
  ];

  const results = [];
  
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint.path, { 
        method: endpoint.method,
        // For POST endpoints, we just check if they exist (will likely fail validation)
      });
      
      // We're checking if the endpoint exists, not if it returns 200
      // 400/401/403 responses mean the endpoint exists
      const exists = res.status !== 404;
      results.push({ path: endpoint.path, exists, status: res.status });
    } catch (error) {
      results.push({ 
        path: endpoint.path, 
        exists: false, 
        status: 0, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  const allExist = results.every(r => r.exists);

  return {
    name: "API Endpoints",
    passed: allExist,
    duration: performance.now() - start,
    details: { endpoints: results },
    error: allExist ? undefined : `Some endpoints not found`,
  };
}

// ============================================================================
// Test Runner
// ============================================================================

/**
 * Run all conversation pipeline tests
 */
export async function runAllConversationTests(): Promise<PipelineTestResults> {
  const tests = [
    testConversationModeToggle,
    testWebSocketConnection,
    testAudioCapture,
    testIntentExtraction,
    testStoreStateManagement,
    testDockStateTransitions,
    testWindowOperations,
    testApiEndpoints,
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
    } catch (error) {
      results.push({
        name: test.name,
        passed: false,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    timestamp: Date.now(),
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    },
  };
}

/**
 * Run a single test by name
 */
export async function runConversationTest(testName: string): Promise<TestResult | null> {
  const tests: Record<string, () => Promise<TestResult>> = {
    "conversation-mode": testConversationModeToggle,
    "websocket": testWebSocketConnection,
    "audio-capture": testAudioCapture,
    "intent-extraction": testIntentExtraction,
    "store-state": testStoreStateManagement,
    "dock-state": testDockStateTransitions,
    "window-operations": testWindowOperations,
    "api-endpoints": testApiEndpoints,
  };

  const test = tests[testName];
  if (!test) return null;

  return test();
}

/**
 * Simulate a full conversation flow for testing
 */
export async function simulateConversationFlow(): Promise<void> {
  const store = useAgentStore.getState();
  
  console.log("[conversation-test] Starting simulated conversation flow...");

  // Step 1: Enable conversation mode
  console.log("[conversation-test] Step 1: Enable conversation mode");
  store.setConversationMode(true);
  store.setDock("conversing");
  await new Promise(r => setTimeout(r, 500));

  // Step 2: Simulate user speech (VAD listening)
  console.log("[conversation-test] Step 2: User speaks");
  store.setDock("listening");
  store.appendTranscript("open the graph");
  await new Promise(r => setTimeout(r, 1000));

  // Step 3: Audio sent to STT
  console.log("[conversation-test] Step 3: Sending to STT");
  store.setDock("thinking");
  await new Promise(r => setTimeout(r, 800));

  // Step 4: Transcript received
  console.log("[conversation-test] Step 4: Transcript received");
  store.clearTranscript();
  const turn: ConversationTurn = {
    id: `user-${Date.now()}`,
    role: "user",
    text: "open the graph",
    timestamp: Date.now(),
  };
  store.addConversationTurn(turn);

  // Step 5: Intent extracted
  console.log("[conversation-test] Step 5: Intent extracted");
  const intent: IntentSummary = {
    action: "navigate",
    target: "graph",
    confidence: 0.95,
    rawTranscript: "open the graph",
    timestamp: new Date().toISOString(),
  };
  store.setCurrentIntent(intent);
  await new Promise(r => setTimeout(r, 200));

  // Step 6: UI Action triggered
  console.log("[conversation-test] Step 6: UI action triggered");
  store.openWindow("graph");
  await new Promise(r => setTimeout(r, 500));

  // Step 7: Agent response
  console.log("[conversation-test] Step 7: Agent responding");
  store.setIsAgentSpeaking(true);
  store.setDock("speaking");
  await new Promise(r => setTimeout(r, 1500));

  // Step 8: Done
  console.log("[conversation-test] Step 8: Conversation complete");
  store.setIsAgentSpeaking(false);
  store.setDock("conversing");

  console.log("[conversation-test] Simulation complete!");
  console.log("[conversation-test] Final state:", {
    conversationMode: store.conversationMode,
    dock: store.dock,
    windows: store.windows.length,
    history: store.conversationHistory.length,
    intent: store.currentIntent,
  });
}

// ============================================================================
// Export for browser console use
// ============================================================================

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).ConversationTests = {
    runAll: runAllConversationTests,
    run: runConversationTest,
    simulate: simulateConversationFlow,
    mockWebSocket: MockWebSocket,
    mockAudio: MOCK_AUDIO_DATA,
  };
}
