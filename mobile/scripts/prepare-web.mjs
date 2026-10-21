import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const mobileRoot=path.resolve(scriptDir,"..");
const repoRoot=path.resolve(mobileRoot,"..");
async function copy(source,destination){await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination);}
for(const file of ["layout.tsx","page.tsx","globals.css","download.css"]){await copy(path.join(repoRoot,"app",file),path.join(mobileRoot,"app",file));}
await copy(path.join(repoRoot,"app","studio","page.tsx"),path.join(mobileRoot,"app","studio","page.tsx"));
for(const file of ["project-db.ts","edit-plan.ts","retrox-engine.ts","retrox-recipes.ts"]){await copy(path.join(repoRoot,"lib",file),path.join(mobileRoot,"lib",file));}
const coreSource=path.join(mobileRoot,"node_modules","@ffmpeg","core","dist","umd");
const coreDestination=path.join(mobileRoot,"public","retrox");
await mkdir(path.dirname(coreDestination),{recursive:true});
await rm(coreDestination,{recursive:true,force:true});
await cp(coreSource,coreDestination,{recursive:true});
console.log("Prepared ReEditX + the local Retrox FFmpeg/WASM core for Android.");
