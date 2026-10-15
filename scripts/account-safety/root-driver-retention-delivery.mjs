/** The Root producer derives the current immutable original itself. There is
 * no pre-created delivery file, caller UUID/cutoff or fallback authority. */
export { produceDriverRetention as serveDriverRetention } from './root-driver-retention-producer.mjs';
