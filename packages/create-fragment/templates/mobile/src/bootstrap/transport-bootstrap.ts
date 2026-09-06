import { setTransport } from "{{PACKAGE_SCOPE}}/ui/transport/types.js";
import { WebSocketTransport, type ConnStatus } from "../transport/ws-transport.js";
// Re-export the transport status type so consumers (e.g. settings.tsx) can import
// it from this single bootstrap surface rather than reaching into ws-transport.
export type { ConnStatus } from "../transport/ws-transport.js";
import { loadHostUrl } from "../transport/host-config.js";

let current: WebSocketTransport | null = null;
const listeners = new Set<(s: ConnStatus) => void>();
let status: ConnStatus = "connecting";

export function onStatus(cb: (s: ConnStatus) => void): () => void {
  listeners.add(cb);
  cb(status);
  return () => listeners.delete(cb);
}

export async function bootstrapTransport(url?: string): Promise<void> {
  const target = url ?? (await loadHostUrl());
  current?.close();
  current = new WebSocketTransport({
    url: target,
    onStatusChange: (s) => {
      status = s;
      for (const l of listeners) l(s);
    },
  });
  setTransport(current); // MUST run before AppStateProvider mounts
}
