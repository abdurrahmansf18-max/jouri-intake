import { useEffect, useRef } from "react";
import type { ProductRecord } from "../types";

interface Handlers {
  onProductUpdated?: (p: ProductRecord) => void;
  onProductCreated?: (p: ProductRecord) => void;
  onProductDeleted?: (id: string) => void;
}

export function useProductSync(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    function connect() {
      if (dead) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const h = ref.current;
          if (msg.type === "product_updated" && h.onProductUpdated) h.onProductUpdated(msg.product as ProductRecord);
          if (msg.type === "product_created" && h.onProductCreated) h.onProductCreated(msg.product as ProductRecord);
          if (msg.type === "product_deleted" && h.onProductDeleted) h.onProductDeleted(msg.id as string);
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        if (!dead) timer = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws?.close();
    }

    connect();

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);
}
