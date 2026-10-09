export type User={id:string;name:string;email:string;role:'STUDENT'|'FACULTY'|'ADMIN';department:string;semester:number;bio?:string};
export type Project={id:string;title:string;description:string;department:string;semester:number;type:string;techStack:string[];teamMembers:string[];githubUrl?:string;demoUrl?:string;screenshots:string[];status:string;feedback?:string;views:number;createdAt:string;updatedAt:string;ownerId:string;owner:User;likes:number;liked:boolean;bookmarked:boolean};
export type Listing={items:Project[];total:number;page:number;limit:number;pages:number};
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{const isForm=options.body instanceof FormData;const r=await fetch(`/api${path}`,{credentials:'include',...options,headers:{...(!isForm&&options.body?{'Content-Type':'application/json'}:{}),...options.headers}});let data;try{data=await r.json()}catch{data={}}if(!r.ok)throw new Error(Array.isArray(data.message)?data.message.join('. '):data.message||`Request failed (${r.status})`);return data as T;}
export const departments=['Computer Science','Information Technology','Electronics','Mechanical Engineering','Civil Engineering','Environmental Engineering','Design','Business','Other'];
export const projectTypes=['Web Application','Mobile Application','AI / Machine Learning','IoT / Hardware','Research','Design','Other'];
export const initials=(name:string)=>name.split(' ').filter(Boolean).map(n=>n[0]).slice(0,2).join('').toUpperCase();
export function mediaUrl(url:string){return url.startsWith('/uploads/')?url:url;}
