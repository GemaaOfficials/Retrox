export type EditRhythm = "steady" | "punchy" | "slow";
export type PlannedScene = { id:number; start:number; end:number; duration:number; label:string };
export function buildEditPlan(duration:number,rhythm:EditRhythm):PlannedScene[] {
 if(!Number.isFinite(duration)||duration<=0)return[];
 const targetLength=rhythm==="punchy"?2.8:rhythm==="slow"?7:5;
 const count=Math.min(120,Math.max(1,Math.ceil(duration/targetLength)));
 return Array.from({length:count},(_,index)=>{const start=duration*index/count;const end=duration*(index+1)/count;const n=String(index+1).padStart(2,"0");return{id:index+1,start:Number(start.toFixed(3)),end:Number(end.toFixed(3)),duration:Number((end-start).toFixed(3)),label:rhythm==="punchy"?"CUT "+n:"SCENE "+n};});
}
