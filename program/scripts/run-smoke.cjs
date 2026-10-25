'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const token=fs.readFileSync(path.resolve(__dirname,'../../.build/activation-test-code.txt'),'utf8').trim();
const p=spawn(require('electron'),['.','--smoke-test'],{cwd:path.resolve(__dirname,'..'),stdio:'inherit',env:{...process.env,RE_HELPER_TEST_ACTIVATION:token}});p.on('exit',c=>process.exitCode=c??1);p.on('error',e=>{console.error(e.message);process.exitCode=1;});
