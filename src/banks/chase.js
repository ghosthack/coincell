// Chase is read by the browser extension (extension/sites/chase.js), not from here.
export default {
  id: 'chase', name: 'Chase', needsBrowser: false, viaExtension: true,
  async sync() { throw new Error('Chase is read by the browser extension: log in to chase.com in Chrome, press the coincell icon, then "Send this site".'); },
};
