import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Linking } from 'react-native';
import { createServices } from '../app/services';
import type { WavepodIdentity } from '../crypto/identity';
import type { SqlDatabase } from '../storage/types';
import { CARD_URL_PREFIX } from '../contacts/card';
import {
  initialNotificationContact,
  onNotificationPressed,
} from '../app/notifeeNotifier';
import type { Route } from './navigation';
import { AddContactScreen } from './screens/AddContactScreen';
import { ChatScreen } from './screens/ChatScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ModuleScreen } from './screens/ModuleScreen';
import { MyQrScreen } from './screens/MyQrScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { NewGroupScreen } from './screens/NewGroupScreen';
import { GroupChatScreen } from './screens/GroupChatScreen';

export function AppNavigator({
  identity,
  db,
}: {
  identity: WavepodIdentity;
  db: SqlDatabase;
}) {
  const s = useMemo(() => createServices(identity, db), [identity, db]);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const go = useCallback((r: Route) => setStack(st => [...st, r]), []);
  const back = useCallback(
    () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st)),
    [],
  );
  const replace = useCallback(
    (r: Route) => setStack(st => [...st.slice(0, -1), r]),
    [],
  );

  // wavepod://add#... links opened from another app (shared contact links).
  useEffect(() => {
    const open = (url?: string | null) => {
      if (url?.toLowerCase().startsWith(CARD_URL_PREFIX)) {
        go({ name: 'addContact', link: url });
      }
    };
    Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', e => open(e.url));
    return () => sub.remove();
  }, [go]);

  // Tap on a message notification: open that conversation.
  useEffect(() => {
    const open = (key: string) =>
      key.startsWith('group:')
        ? go({ name: 'group', groupId: key.slice(6) })
        : go({ name: 'chat', contactId: key });
    initialNotificationContact()
      .then(id => id && open(id))
      .catch(() => undefined);
    return onNotificationPressed(open);
  }, [go]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, back]);

  const route = stack[stack.length - 1];
  switch (route.name) {
    case 'home':
      return <HomeScreen s={s} go={go} />;
    case 'module':
      return <ModuleScreen s={s} back={back} />;
    case 'myQr':
      return <MyQrScreen s={s} back={back} />;
    case 'addContact':
      return (
        <AddContactScreen
          s={s}
          back={back}
          initialLink={route.link}
          openChat={id => replace({ name: 'chat', contactId: id })}
        />
      );
    case 'chat':
      return <ChatScreen s={s} contactId={route.contactId} back={back} />;
    case 'diagnostics':
      return <DiagnosticsScreen s={s} back={back} />;
    case 'settings':
      return <SettingsScreen s={s} back={back} />;
    case 'profile':
      return <ProfileScreen s={s} back={back} />;
    case 'newGroup':
      return (
        <NewGroupScreen
          s={s}
          back={back}
          openGroup={id => replace({ name: 'group', groupId: id })}
        />
      );
    case 'group':
      return <GroupChatScreen s={s} groupId={route.groupId} back={back} />;
  }
}
