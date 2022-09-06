import server from './index.js';
import { createServer } from 'http';

createServer(server).listen(process.env.PORT ?? 3000);