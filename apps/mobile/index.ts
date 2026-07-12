// Shims MUST import before anything touches protobuf/i18n (see src/shims.ts).
import './src/shims';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
