import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./browser',testMatch:'account-inbox-management.spec.js',workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:8100',channel:'chrome',viewport:{width:1440,height:900}},
  webServer:{cwd:process.cwd(),command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 8100 --strictPort',url:'http://127.0.0.1:8100',reuseExistingServer:false}});
