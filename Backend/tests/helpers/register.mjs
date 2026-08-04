/**
 * Installs the test loader hooks. Used only via `node --import`.
 */
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
