/**
 * GenAI Content Platform — WebSocket Hook
 * Auto-reconnect, streaming token handling
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/stores';
import type { StreamMessage } from '@/types';

interface UseWebSocketOptions {
  url: string;
  connectionId: string;
  onToken?: (text: string) => void;
  onComplete?: (msg: StreamMessage) => void;
  onError?: (msg: StreamMessage) => void;
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxRetries?: number;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (data: string) => void;
}

export function useWebSocket({
  url,
  connectionId,
  onToken,
  onComplete,
  onError,
  autoConnect = true,
  reconnectInterval = 3000,
  maxRetries = 10,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { appendStreamToken, setGenerating } = useEditorStore();

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();

    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const fullUrl = `${url}/${connectionId}`;
    const ws = new WebSocket(fullUrl);

    ws.onopen = () => {
      setIsConnected(true);
      retriesRef.current = 0;
      console.log(`[WS] Connected: ${connectionId}`);
    };

    ws.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'token':
            appendStreamToken(msg.text);
            onToken?.(msg.text);
            break;
          case 'complete':
            setGenerating(false);
            onComplete?.(msg);
            break;
          case 'error':
            setGenerating(false);
            onError?.(msg);
            break;
        }
      } catch {
        // Non-JSON message (e.g., pong)
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log(`[WS] Disconnected: ${connectionId}`);

      // Auto-reconnect
      if (retriesRef.current < maxRetries) {
        retriesRef.current += 1;
        const delay = reconnectInterval * Math.min(retriesRef.current, 5);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${retriesRef.current})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };

    wsRef.current = ws;
  }, [url, connectionId, onToken, onComplete, onError, cleanup, reconnectInterval, maxRetries, appendStreamToken, setGenerating]);

  const disconnect = useCallback(() => {
    cleanup();
    retriesRef.current = maxRetries; // Prevent auto-reconnect
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, [cleanup, maxRetries]);

  const sendMessage = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  // Keepalive ping every 30 seconds
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => sendMessage('ping'), 30000);
    return () => clearInterval(interval);
  }, [isConnected, sendMessage]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) connect();
    return () => disconnect();
  }, [autoConnect, connect, disconnect]);

  return { isConnected, connect, disconnect, sendMessage };
}
