import { useEffect, useReducer, useState } from 'react';
import type { AppServices } from '../app/services';
import type { ConnectionState } from '../radio/RadioInterface';
import type { LinkState } from '../app/moduleManager';

/** Re-renders on engine events (messages, contacts) and every 30 s for "vu il y a". */
export function useEngineTick(s: AppServices, contactId?: string) {
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = s.engine.onEvent(e => {
      if (e.kind === 'log') return;
      if (!contactId || e.contactId === contactId) bump();
    });
    const t = setInterval(bump, 30_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [s, contactId]);
  return tick;
}

export function useModuleState(s: AppServices): ConnectionState {
  const [state, setState] = useState(s.hub.connectionState);
  useEffect(() => {
    const off = s.hub.onConnectionState(setState);
    return () => {
      off();
    };
  }, [s]);
  return state;
}

/** Module link supervision (connected / reconnecting since…), refreshed every 30 s. */
export function useLink(s: AppServices): {
  state: LinkState;
  since: number | null;
} {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = s.modules.onStateChange(() => bump());
    const t = setInterval(bump, 30_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [s]);
  return { state: s.modules.state, since: s.modules.disconnectedSince };
}
