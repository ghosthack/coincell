import { DEMO } from '../paths.js';
import manual from './manual.js';
import fidelity from './fidelity.js';
import chase from './chase.js';
import ally from './ally.js';
import harborline from './demo/harborline.js';
import kestrel from './demo/kestrel.js';
import copperleaf from './demo/copperleaf.js';
import meridian from './demo/meridian.js';
import lakeshore from './demo/lakeshore.js';

// Your real institutions. Copy mybank.js for each one, fill it in, import it and add it here.
const REAL = [fidelity, chase, ally, manual];

// The made-up institutions served by fakebanks/, used only in demo mode.
const DEMO_BANKS = [harborline, kestrel, copperleaf, meridian, lakeshore, manual];

export const BANKS = DEMO ? DEMO_BANKS : REAL;
export const getBank = (id) => BANKS.find((b) => b.id === id);
