/**
 * @format
 */

import './src/polyfills';
import { AppRegistry } from 'react-native';
import { registerEarlyHandlers } from './src/app/startup';
import App from './App';
import { name as appName } from './app.json';

registerEarlyHandlers();
AppRegistry.registerComponent(appName, () => App);
