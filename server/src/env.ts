import { config } from 'dotenv';

// npm workspace scripts run with cwd = server/, so the repo-root .env is one level up.
config({ path: '../.env' });
