import { createRoot } from 'react-dom/client';
import { App } from './components/App';
// Global CSS now linked via HTML (media/index.css). No CSS imports here.

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
