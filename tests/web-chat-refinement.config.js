import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./browser',testMatch:'web-chat-refinement.spec.js',workers:1,timeout:30000,
use:{baseURL:'http://127.0.0.1:8100',channel:'chrome',viewport:{width:1536,height:900}}});
