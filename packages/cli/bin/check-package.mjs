import { payloadManifest } from '../dist/files.js';
import { fileURLToPath, URL } from 'node:url';
await payloadManifest(fileURLToPath(new URL('../payload/', import.meta.url)));
