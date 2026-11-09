import { registerRootComponent } from 'expo';

// Antes que nada: define la tarea en segundo plano de las notificaciones, que Android puede lanzar
// sin la app abierta (ver src/notifications/backgroundTask.ts).
import './src/notifications/backgroundTask';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
