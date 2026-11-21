// Citi is read by the browser extension (extension/sites/citi.js), not from here.
export default {
  id: 'citi', name: 'Citi', needsBrowser: false, viaExtension: true,
  async sync() { throw new Error('Citi is read by the browser extension: log in to citi.com in Chrome, press the coincell icon, then "Send this site".'); },
};
