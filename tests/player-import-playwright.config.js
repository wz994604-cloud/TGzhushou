import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./browser',testMatch:'player-import.spec.js',workers:1,fullyParallel:false,timeout:45000,
  outputDir:'../.design/bot-user-import-20261004/browser-output',
  use:{baseURL:'http://127.0.0.1:8101',channel:'chrome',viewport:{width:1280,height:900},trace:'retain-on-failure'},
  webServer:{command:'node tests/start-player-import-server.js',cwd:process.cwd(),url:'http://127.0.0.1:8101/healthz',reuseExistingServer:false,timeout:15000}
});
