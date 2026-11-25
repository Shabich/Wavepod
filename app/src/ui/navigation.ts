/** Minimal stack navigation: the app has a handful of screens. */
export type Route =
  | { name: 'home' }
  | { name: 'module' }
  | { name: 'myQr' }
  | { name: 'addContact'; link?: string }
  | { name: 'chat'; contactId: string }
  | { name: 'diagnostics' };

export type Navigate = (route: Route) => void;
