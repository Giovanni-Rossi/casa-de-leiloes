import { migrate, pool } from './db.js';
import { seed } from './seed.js';

await migrate();
await seed();
await pool.end();
