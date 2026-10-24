import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {start} from '../server/main.js';
import {projectInput,jobInput} from '../server/contracts.js';

// A fresh installation and a public reserved example domain keep capture assets free of customer data.
const directory=mkdtempSync(join(tmpdir(),'opengeo-preview-'));
const output=join(process.env.LOCALAPPDATA ?? tmpdir(),'OpenGEO','public-preview');
mkdirSync(output,{recursive:true});
writeFileSync(join(directory,'secret'),randomBytes(48));
process.env.OPENGEO_SECRET_FILE=join(directory,'secret');
const runtime=await start({directory,port:0});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await runtime.runner.stop();runtime.scheduler.stop();
 const project=runtime.store.createProject(projectInput.parse({domain:'example.com',brand:'Example Domain'}));
 runtime.store.set('onboarding',{completed:true});
 const job=runtime.store.enqueue(jobInput.parse({projectId:project.id,kind:'audit'}),'preview-audit');
 await runtime.runner.tick();
 if(runtime.store.job(job.id).status!=='completed')throw new Error('The public example audit did not complete; do not replace it with fabricated results.');
 const context=await browser.newContext({viewport:{width:1360,height:960},deviceScaleFactor:2});
 const page=await context.newPage();const address=runtime.app.server.address() as any;
 await page.goto('http://127.0.0.1:'+address.port);
 await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
 await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
 await page.locator('.workspace-loading').waitFor({state:'hidden'});
 await page.evaluate(()=>document.fonts.ready);
 async function capture(name:string) {
  const file=join(output,name+'.png');
  await page.setViewportSize({width:1360,height:960});
  const height=await page.locator('main').evaluate(element=>Math.ceil(element.scrollHeight+element.getBoundingClientRect().top));
  await page.setViewportSize({width:1360,height:Math.max(960,height)});
  await page.locator('.shell').screenshot({path:file});
  await sharp(file).resize({width:2040}).webp({quality:76}).toFile('assets/'+name+'.webp');
 }
 await capture('workspace-preview');
 await page.getByRole('button',{name:'Site Audit',exact:true}).click();
 await page.getByRole('link',{name:/Example Domain/}).first().waitFor();
 await capture('audit-preview');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('heading',{name:'Your connections',exact:true}).waitFor();
 await capture('provider-preview');
 console.log(JSON.stringify({auditPages:runtime.store.pages(project.id,job.id).length,findings:runtime.store.findings(project.id).length,output,images:['workspace-preview','audit-preview','provider-preview']}));
}finally{await browser.close();await runtime.app.close();rmSync(directory,{recursive:true,force:true});}
