import {
  MessageNotifier,
  foregroundText,
  shouldNotify,
  type Notifier,
} from '../src/app/notifications';
import type { EngineEvent } from '../src/delivery/engine';
import { tick } from './helpers';

function setup(appState = 'background') {
  const listeners = new Set<(e: EngineEvent) => void>();
  const engine = {
    onEvent: (l: (e: EngineEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const shown: { contactId: string; title: string; body: string }[] = [];
  const notifier: Notifier = {
    requestPermission: async () => true,
    showMessage: async (contactId, title, body) => {
      shown.push({ contactId, title, body });
    },
    setForeground: async () => undefined,
  };
  const bodies = new Map<number, string>([
    [1, 'On se retrouve au refuge ?'],
    [2, 'x'.repeat(300)],
  ]);
  let state = appState;
  const n = new MessageNotifier({
    engine: engine as never,
    contacts: { get: async (id: string) => ({ id, name: 'Léa' }) } as never,
    messages: {
      get: async (_c: string, _d: string, id: number) =>
        bodies.has(id) ? { body: bodies.get(id) } : null,
    } as never,
    notifier,
    appState: () => state,
  });
  n.start();
  const receive = async (
    contactId: string,
    messageId: number,
    direction: 'in' | 'out' = 'in',
  ) => {
    listeners.forEach(l =>
      l({ kind: 'message', contactId, direction, messageId }),
    );
    await tick();
  };
  return { n, shown, receive, setState: (s: string) => (state = s) };
}

describe('MessageNotifier', () => {
  it('notifies incoming messages while the app is in background', async () => {
    const { shown, receive } = setup('background');
    await receive('c1', 1);
    expect(shown).toEqual([
      { contactId: 'c1', title: 'Léa', body: 'On se retrouve au refuge ?' },
    ]);
  });

  it('stays silent for the conversation on screen, but not for others', async () => {
    const { n, shown, receive, setState } = setup('active');
    n.setOpenChat('c1');
    await receive('c1', 1);
    expect(shown).toHaveLength(0);
    await receive('c2', 1);
    expect(shown.map(x => x.contactId)).toEqual(['c2']);
    setState('background');
    await receive('c1', 1);
    expect(shown.map(x => x.contactId)).toEqual(['c2', 'c1']);
  });

  it('ignores outgoing messages and unknown messages', async () => {
    const { shown, receive } = setup('background');
    await receive('c1', 1, 'out');
    await receive('c1', 99);
    expect(shown).toHaveLength(0);
  });

  it('truncates long messages', async () => {
    const { shown, receive } = setup('background');
    await receive('c1', 2);
    expect(shown[0].body.length).toBe(140);
    expect(shown[0].body.endsWith('…')).toBe(true);
  });

  it('stops after dispose', async () => {
    const { n, shown, receive } = setup('background');
    n.dispose();
    await receive('c1', 1);
    expect(shown).toHaveLength(0);
  });
});

describe('shouldNotify', () => {
  it.each([
    ['active', 'c1', 'c1', false],
    ['active', 'c1', 'c2', true],
    ['active', null, 'c1', true],
    ['background', 'c1', 'c1', true],
    ['inactive', 'c1', 'c1', true],
  ])('%s, open %s, message from %s → %s', (state, open, from, expected) => {
    expect(
      shouldNotify(state as string, open as string | null, from as string),
    ).toBe(expected);
  });
});

describe('foregroundText', () => {
  it('keeps the Android service while a module is followed', () => {
    expect(foregroundText('connected', 'WP-1234')).toContain('WP-1234');
    expect(foregroundText('reconnecting', 'WP-1234')).toContain('Recherche');
    expect(foregroundText('connecting', null)).toContain('ton module');
    expect(foregroundText('idle', 'WP-1234')).toBeNull();
  });
});
