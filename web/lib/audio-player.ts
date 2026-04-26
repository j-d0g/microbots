"use client";

/**
 * Audio Player Module
 *
 * Handles audio playback using Web Audio API with HTML5 Audio fallback.
 * Provides streaming-capable audio playback with proper state tracking
 * to prevent mic feedback loops.
 */

import { useRef, useCallback, useState, useEffect } from "react";

// Global audio context to be shared across components
let globalAudioContext: AudioContext | null = null;

// Track if audio is currently playing globally (for feedback prevention)
let isAudioPlayingGlobally = false;
let globalPlayingCallback: ((playing: boolean) => void) | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!globalAudioContext) {
    try {
      globalAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      console.log("[AudioPlayer] Created new AudioContext");
    } catch (e) {
      console.error("[AudioPlayer] Failed to create AudioContext:", e);
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (globalAudioContext.state === "suspended") {
    void globalAudioContext.resume();
  }
  return globalAudioContext;
}

export function setGlobalPlayingCallback(cb: (playing: boolean) => void) {
  globalPlayingCallback = cb;
}

export function getIsAudioPlaying(): boolean {
  return isAudioPlayingGlobally;
}

function setAudioPlaying(playing: boolean) {
  isAudioPlayingGlobally = playing;
  globalPlayingCallback?.(playing);
  console.log("[AudioPlayer] Global playing state:", playing);
}

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface PlayOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

/**
 * React hook for audio playback
 */
export function useAudioPlayer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const currentHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    isLoading: false,
    error: null,
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("[AudioPlayer] Cleanup - stopping audio");
      stopAudio();
    };
  }, []);

  /**
   * Stop any currently playing audio
   */
  const stopAudio = useCallback(() => {
    console.log("[AudioPlayer] stopAudio called");
    
    // Stop Web Audio source
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
        console.log("[AudioPlayer] Stopped Web Audio source");
      } catch (e) {
        // Ignore errors if already stopped
        console.log("[AudioPlayer] Error stopping source (may be already stopped):", e);
      }
      currentSourceRef.current = null;
    }

    // Stop HTML5 Audio
    if (currentHtmlAudioRef.current) {
      try {
        currentHtmlAudioRef.current.pause();
        currentHtmlAudioRef.current.currentTime = 0;
        console.log("[AudioPlayer] Stopped HTML5 Audio");
      } catch (e) {
        console.log("[AudioPlayer] Error stopping HTML5 Audio:", e);
      }
      currentHtmlAudioRef.current = null;
    }

    setAudioPlaying(false);
    setState((s) => ({ ...s, isPlaying: false, isLoading: false }));
  }, []);

  /**
   * Play audio from base64 encoded data
   * Supports PCM16, MP3, and WAV formats
   */
  const playAudioFromBase64 = useCallback(async (
    base64Audio: string,
    opts: PlayOptions = {}
  ): Promise<void> => {
    console.log("[AudioPlayer] playAudioFromBase64 called, base64 length:", base64Audio?.length);
    
    if (!base64Audio || base64Audio.length < 10) {
      console.error("[AudioPlayer] Invalid audio data");
      opts.onError?.(new Error("Invalid audio data"));
      return;
    }

    // Stop any existing audio first
    stopAudio();
    
    setState({ isPlaying: false, isLoading: true, error: null });
    setAudioPlaying(true);

    // Try Web Audio API first
    try {
      const ctx = getAudioContext();
      if (!ctx) {
        throw new Error("AudioContext not available");
      }

      // Ensure context is running
      if (ctx.state === "suspended") {
        console.log("[AudioPlayer] Resuming suspended AudioContext");
        await ctx.resume();
      }

      console.log("[AudioPlayer] Decoding base64 audio...");
      
      // Decode base64 to binary
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log("[AudioPlayer] Binary data length:", bytes.length, "bytes");

      // Try to decode as audio buffer
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        console.log("[AudioPlayer] Decoded audio buffer:", audioBuffer.duration.toFixed(2), "seconds,", audioBuffer.numberOfChannels, "channels");
      } catch (decodeError) {
        console.warn("[AudioPlayer] decodeAudioData failed, trying HTML5 Audio fallback:", decodeError);
        throw decodeError; // Will fall through to HTML5 fallback
      }

      // Create and play source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      
      currentSourceRef.current = source;
      
      source.onended = () => {
        console.log("[AudioPlayer] Audio playback ended naturally");
        setAudioPlaying(false);
        setState((s) => ({ ...s, isPlaying: false }));
        opts.onEnd?.();
      };

      console.log("[AudioPlayer] Starting Web Audio playback");
      source.start(0);
      
      setState({ isPlaying: true, isLoading: false, error: null });
      opts.onStart?.();
      
    } catch (webAudioError) {
      console.warn("[AudioPlayer] Web Audio failed, falling back to HTML5 Audio:", webAudioError);
      
      // Fallback to HTML5 Audio
      try {
        // Try to determine format from the base64 data
        // For now, assume it's MP3 or try to detect
        const mimeType = detectMimeType(base64Audio);
        console.log("[AudioPlayer] Detected MIME type:", mimeType);
        
        const byteCharacters = atob(base64Audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        currentHtmlAudioRef.current = audio;

        audio.onplay = () => {
          console.log("[AudioPlayer] HTML5 Audio started playing");
          setState({ isPlaying: true, isLoading: false, error: null });
          setAudioPlaying(true);
          opts.onStart?.();
        };

        audio.onended = () => {
          console.log("[AudioPlayer] HTML5 Audio ended");
          URL.revokeObjectURL(url);
          setAudioPlaying(false);
          setState((s) => ({ ...s, isPlaying: false }));
          opts.onEnd?.();
        };

        audio.onerror = (e) => {
          console.error("[AudioPlayer] HTML5 Audio error:", e);
          URL.revokeObjectURL(url);
          setAudioPlaying(false);
          setState((s) => ({ 
            ...s, 
            isPlaying: false, 
            isLoading: false, 
            error: "Audio playback failed" 
          }));
          opts.onError?.(new Error("HTML5 Audio playback failed"));
        };

        console.log("[AudioPlayer] Starting HTML5 Audio playback");
        await audio.play();
        
      } catch (html5Error) {
        console.error("[AudioPlayer] HTML5 Audio also failed:", html5Error);
        setAudioPlaying(false);
        setState((s) => ({ 
          ...s, 
          isPlaying: false, 
          isLoading: false, 
          error: "Audio playback failed" 
        }));
        opts.onError?.(html5Error as Error);
      }
    }
  }, [stopAudio]);

  /**
   * Play audio from a URL (blob or remote)
   */
  const playAudioFromUrl = useCallback(async (
    url: string,
    opts: PlayOptions = {}
  ): Promise<void> => {
    console.log("[AudioPlayer] playAudioFromUrl:", url);
    
    stopAudio();
    setState({ isPlaying: false, isLoading: true, error: null });
    setAudioPlaying(true);

    const audio = new Audio(url);
    currentHtmlAudioRef.current = audio;

    audio.onplay = () => {
      console.log("[AudioPlayer] URL audio started");
      setState({ isPlaying: true, isLoading: false, error: null });
      opts.onStart?.();
    };

    audio.onended = () => {
      console.log("[AudioPlayer] URL audio ended");
      setAudioPlaying(false);
      setState((s) => ({ ...s, isPlaying: false }));
      opts.onEnd?.();
    };

    audio.onerror = (e) => {
      console.error("[AudioPlayer] URL audio error:", e);
      setAudioPlaying(false);
      setState((s) => ({ 
        ...s, 
        isPlaying: false, 
        isLoading: false, 
        error: "Audio playback failed" 
      }));
      opts.onError?.(new Error("Audio playback failed"));
    };

    try {
      await audio.play();
    } catch (e) {
      console.error("[AudioPlayer] Failed to play URL audio:", e);
      setAudioPlaying(false);
      setState((s) => ({ 
        ...s, 
        isPlaying: false, 
        isLoading: false, 
        error: "Failed to start audio" 
      }));
      opts.onError?.(e as Error);
    }
  }, [stopAudio]);

  /**
   * Play audio from a Blob
   */
  const playAudioFromBlob = useCallback(async (
    blob: Blob,
    opts: PlayOptions = {}
  ): Promise<void> => {
    console.log("[AudioPlayer] playAudioFromBlob, size:", blob.size, "type:", blob.type);
    const url = URL.createObjectURL(blob);
    
    try {
      await playAudioFromUrl(url, {
        ...opts,
        onEnd: () => {
          URL.revokeObjectURL(url);
          opts.onEnd?.();
        },
        onError: (e) => {
          URL.revokeObjectURL(url);
          opts.onError?.(e);
        },
      });
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }, [playAudioFromUrl]);

  return {
    playAudioFromBase64,
    playAudioFromUrl,
    playAudioFromBlob,
    stopAudio,
    isPlaying: state.isPlaying,
    isLoading: state.isLoading,
    error: state.error,
  };
}

/**
 * Utility function to detect MIME type from base64 audio data
 */
function detectMimeType(base64Data: string): string {
  // Check for common audio format signatures in base64
  const header = base64Data.slice(0, 20);
  
  // MP3 signatures
  if (header.includes("SUQz") || header.includes("//uQx")) {
    return "audio/mpeg";
  }
  
  // WAV signature (RIFF....WAVE)
  if (header.startsWith("UklGR")) {
    return "audio/wav";
  }
  
  // OGG signature
  if (header.startsWith("T3dn")) {
    return "audio/ogg";
  }
  
  // Default to MP3 (most common for TTS)
  return "audio/mpeg";
}

/**
 * Standalone function to play base64 audio (for non-React contexts)
 */
export async function playBase64Audio(
  base64Audio: string,
  opts: PlayOptions = {}
): Promise<() => void> {
  console.log("[AudioPlayer] Standalone playBase64Audio called");
  
  const stopFns: Array<() => void> = [];
  
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      throw new Error("AudioContext not available");
    }

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    setAudioPlaying(true);
    
    source.onended = () => {
      setAudioPlaying(false);
      opts.onEnd?.();
    };

    source.start(0);
    opts.onStart?.();

    stopFns.push(() => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore
      }
      setAudioPlaying(false);
    });
    
  } catch (e) {
    console.warn("[AudioPlayer] Standalone Web Audio failed, trying HTML5:", e);
    
    // HTML5 fallback
    const mimeType = detectMimeType(base64Audio);
    const byteCharacters = atob(base64Audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    
    audio.onplay = () => {
      setAudioPlaying(true);
      opts.onStart?.();
    };
    
    audio.onended = () => {
      URL.revokeObjectURL(url);
      setAudioPlaying(false);
      opts.onEnd?.();
    };
    
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setAudioPlaying(false);
      opts.onError?.(new Error("Audio playback failed"));
    };

    await audio.play();
    
    stopFns.push(() => {
      audio.pause();
      URL.revokeObjectURL(url);
      setAudioPlaying(false);
    });
  }

  return () => stopFns.forEach((fn) => fn());
}
