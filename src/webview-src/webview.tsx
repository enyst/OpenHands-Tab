import { createRoot } from 'react-dom/client';
import { App } from './components/App';
// Global CSS now linked via HTML (media/index.css). No CSS imports here.

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('Failed to find app element');
}
const root = createRoot(appElement);
root.render(<App />);
