// Newrez (mortgage) is read by the browser extension (extension/sites/newrez.js), not from here.
export default {
  id: 'newrez', name: 'Newrez', needsBrowser: false, viaExtension: true,
  async sync() { throw new Error('Newrez is read by the browser extension: log in to Newrez in Chrome, open your dashboard, press the coincell icon, then "Send this site".'); },
};
