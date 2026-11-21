// Ally Bank is read by the browser extension (extension/sites/ally.js), not from here.
export default {
  id: 'ally', name: 'Ally Bank', needsBrowser: false, viaExtension: true,
  async sync() { throw new Error('Ally is read by the browser extension: log in to ally.com in Chrome, open your dashboard, press the coincell icon, then "Send this site".'); },
};
