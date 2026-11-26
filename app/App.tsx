/**
 * @format
 */

import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppRoot } from './src/app/AppRoot';
import { ThemeProvider, useTheme } from './src/ui/theme';

function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <ThemedRoot />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function ThemedRoot() {
  const { scheme, colors } = useTheme();
  return (
    <>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <AppRoot />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export default App;
