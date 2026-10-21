import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const mobileRoot=path.resolve(scriptDir,"..");
const repoRoot=path.resolve(mobileRoot,"..");
async function copy(source,destination){await mkdir(path.dirname(destination),{recursive:true});await copyFile(source,destination);}
for(const file of ["layout.tsx","page.tsx","globals.css","download.css"]){await copy(path.join(repoRoot,"app",file),path.join(mobileRoot,"app",file));}
await copy(path.join(repoRoot,"app","studio","page.tsx"),path.join(mobileRoot,"app","studio","page.tsx"));
for(const file of ["project-db.ts","edit-plan.ts"]){await copy(path.join(repoRoot,"lib",file),path.join(mobileRoot,"lib",file));}
await mkdir(path.join(mobileRoot,"public"),{recursive:true});
console.log("Prepared the current ReEditX studio for a static Capacitor bundle.");
