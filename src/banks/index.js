import harborline from './harborline.js';
import kestrel from './kestrel.js';
import copperleaf from './copperleaf.js';
import meridian from './meridian.js';
import lakeshore from './lakeshore.js';
import manual from './manual.js';

// Register bank adapters here. (mybank.js is an unregistered template for a real bank.)
export const BANKS = [harborline, kestrel, copperleaf, meridian, lakeshore, manual];
export const getBank = (id) => BANKS.find((b) => b.id === id);
