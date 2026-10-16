import { readFile,writeFile } from 'node:fs/promises';
const root=new URL('../supabase/',import.meta.url);
const files=['202610160005_operations.sql','202610160006_sync_worker.sql'];
let output='-- CRM Laiora operational upgrade.\n-- Run ONCE on a project that already applied SETUP_LAIORA.sql (migrations001-004).\n-- Preserves existing orders, account binding, bucket files, and counters.\n-- No credentials or sample customers. Do not replay initial setup.\nbegin;\n';
for(const file of files){const source=await readFile(new URL(`migrations/${file}`,root),'utf8');if((source.match(/^begin;\s*$/gmi)||[]).length!==1||(source.match(/^commit;\s*$/gmi)||[]).length!==1)throw new Error(`Unexpected transaction structure in ${file}`);output+=`\n-- Source: ${file}\n`+source.replace(/^begin;\s*\n/gmi,'').replace(/^commit;\s*$/gmi,'').trimEnd()+'\n';}
output+='\ncommit;\n';await writeFile(new URL('UPGRADE_OPERASIONAL.sql',root),output);console.log('Operational upgrade bundled from005 and006.');
