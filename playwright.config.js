import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:8099',channel:process.env.CI?undefined:'chrome',viewport:{width:390,height:844},trace:'retain-on-failure'},
  webServer:{command:'node tests/start-test-server.js',url:'http://127.0.0.1:8099/healthz',reuseExistingServer:false,timeout:15000},
});
