/**
 * Camera QR scanner. iOS only for now: VisionCamera 5 has no built-in code scanner on
 * Android (needs the ML Kit plugin, to add once an Android build is possible).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from './components';
import { useStyles, useTheme, type Colors } from './theme';

/** A failing camera (simulator, missing hardware) must never take the screen down. */
class ScannerBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <CameraUnavailable />;
    return this.props.children;
  }
}

function CameraUnavailable() {
  const { ui } = useTheme();
  return (
    <Text style={ui.muted}>
      La caméra n’est pas disponible. Colle le lien partagé par ton contact.
    </Text>
  );
}

export function QrScanner({ onCode }: { onCode: (value: string) => void }) {
  return (
    <ScannerBoundary>
      <PlatformScanner onCode={onCode} />
    </ScannerBoundary>
  );
}

function PlatformScanner({ onCode }: { onCode: (value: string) => void }) {
  const { ui } = useTheme();
  if (Platform.OS !== 'ios') {
    return (
      <Text style={ui.muted}>
        La lecture par la caméra arrive bientôt sur Android. En attendant, colle
        le lien partagé par ton contact.
      </Text>
    );
  }
  return <IosScanner onCode={onCode} />;
}

function IosScanner({ onCode }: { onCode: (value: string) => void }) {
  const { ui } = useTheme();
  const styles = useStyles(makeStyles);
  // Lazy require: native Nitro modules are not loaded until the scanner is shown.
  const vc = useMemo(
    () =>
      require('react-native-vision-camera') as typeof import('react-native-vision-camera'),
    [],
  );
  const permission = vc.useCameraPermission();
  // Undefined on the simulator or on hardware without a back camera.
  const device = vc.useCameraDevice('back');
  const done = useRef(false);
  const output = vc.useObjectOutput({
    types: ['qr'],
    onObjectsScanned(objects) {
      if (done.current) return;
      for (const o of objects) {
        if (vc.isScannedCode(o) && o.value?.startsWith('wavepod://')) {
          done.current = true;
          onCode(o.value);
          return;
        }
      }
    },
  });

  const asked = useRef(false);
  useEffect(() => {
    // Ask once when the scanner opens; afterwards the button below asks again.
    if (asked.current) return;
    asked.current = true;
    if (!permission.hasPermission && permission.canRequestPermission) {
      permission.requestPermission();
    }
  });

  if (!device) {
    return (
      <Text style={ui.muted}>
        Aucune caméra disponible. Colle le lien partagé par ton contact.
      </Text>
    );
  }

  if (!permission.hasPermission) {
    return (
      <View style={styles.placeholder}>
        <Text style={ui.muted}>
          Wavepod a besoin de la caméra pour lire le QR de ton contact.
        </Text>
        {permission.canRequestPermission && (
          <PrimaryButton
            title="Autoriser la caméra"
            onPress={() => permission.requestPermission()}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <vc.Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={[output]}
      />
    </View>
  );
}

const makeStyles = (_c: Colors) =>
  StyleSheet.create({
    frame: {
      height: 300,
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: 'black',
    },
    placeholder: { gap: 12, paddingVertical: 24 },
  });
