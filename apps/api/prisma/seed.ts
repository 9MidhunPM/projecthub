import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security';
async function main(){
 if(process.env.NODE_ENV==='production'||process.env.DEV_SEED!=='true')throw new Error('Development seed requires DEV_SEED=true and cannot run in production');
 const password=process.env.DEV_SEED_PASSWORD;if(!password||password.length<12)throw new Error('Provide DEV_SEED_PASSWORD with at least 12 characters');
 const db=new PrismaClient();try{
 const passwordHash=await hashPassword(password);
 const student=await db.user.upsert({where:{email:'student@projecthub.test'},update:{passwordHash},create:{name:'Alex Morgan',email:'student@projecthub.test',passwordHash,department:'Computer Science',semester:6,bio:'Building thoughtful tools for everyday campus life.'}});
 for(const [email,name,role] of [['faculty@projecthub.test','Dr. Taylor Reed','FACULTY'],['admin@projecthub.test','Jordan Ellis','ADMIN']] as const)await db.user.upsert({where:{email},update:{passwordHash},create:{email,name,role,passwordHash,department:'Computer Science',semester:1}});
 const items=[
 ['campus-connect','Campus Connect','A smarter way to find your way around campus. Accessible indoor navigation, live room availability, and campus events in one thoughtful experience.',['Next.js','TypeScript','PostgreSQL'],'Web Application','Computer Science',6],
 ['ecotrack','EcoTrack','An intelligent plant care companion that connects soil sensors with a friendly dashboard, helping communities grow healthier urban gardens.',['React','Python','Arduino'],'IoT / Hardware','Electronics',4],
 ['study-space','Study Space','A collaborative learning workspace that brings shared notes, focused study sessions, and peer learning circles together in one calm experience.',['Next.js','TypeScript','PostgreSQL'],'Web Application','Computer Science',8],
 ['accessmap','AccessMap','An accessible campus map designed for everyone. Explore step-free routes, locate building entrances, and find important campus facilities with confidence.',['React','Node.js','PostgreSQL'],'Web Application','Information Technology',6],
 ['lab-notes','Lab Notes','A collaborative research notebook combining experiment logs, shared observations, and structured lab reports to help student teams work together.',['Next.js','Prisma','Tailwind CSS'],'Web Application','Computer Science',4],
 ['openshelf','OpenShelf','An intelligent library discovery prototype that organizes open educational resources and helps students find their next great read through semantic search.',['Python','PyTorch','FastAPI'],'AI / Machine Learning','Computer Science',8],
 ['recycle-route','Recycle Route','Connecting campus recycling stations with an interactive map and educational waste-sorting guide to make sustainable choices easier every day.',['Flutter','Dart','Firebase'],'Mobile Application','Environmental Engineering',6],
 ['orbit-notes','Orbit Notes','A distraction-free note-taking application with connected ideas, fast search, and markdown support. Your next great idea deserves a little space.',['React','TypeScript','Node.js'],'Web Application','Information Technology',4]
 ] as const;
 for(const [id,title,description,techStack,type,department,semester] of items)await db.project.upsert({where:{id},update:{},create:{id,title,description,techStack:[...techStack],teamMembers:['Alex Morgan','Casey Chen'],type,department,semester,status:'APPROVED',screenshots:['campus-connect','ecotrack','study-space'].includes(id)?['/examples/'+id+'.png']:[],ownerId:student.id,views:0}});
 console.log('Created fictional development accounts and eight approved sample projects. Password is the supplied DEV_SEED_PASSWORD.');
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exit(1);});
