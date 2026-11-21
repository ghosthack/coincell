// Demo mode: the made-up institutions plus the dashboard, on their own port and data folder.
process.env.COINCELL_DEMO = '1';
await import('../fakebanks/server.js');
await import('../src/server.js');
