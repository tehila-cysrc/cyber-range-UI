import './env.js';
import { restoreDemoSnapshot } from './db/demoSnapshot.js';

// This must run before any module imports the shared database connection.
restoreDemoSnapshot();
await import('./server.js');
