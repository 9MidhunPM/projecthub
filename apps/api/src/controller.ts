import { Body, Controller, Delete, Get, Post, Put, Patch, Param, Query, Req, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, ServiceUnavailableException, Header } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeUpload } from './images';
import { Prisma, ProjectStatus } from '@prisma/client';
import { Db } from './db';
import { AuthRequest, AuthGuard, AuthService, userSelect } from './auth';
import { LoginDto, SignupDto, ProfileDto, ProjectDto, UpdateProjectDto, ProjectVersionDto, ModerationDto, RoleDto } from './dto';
import { digest, hashPassword, verifyPassword, ensureOwner, ensureReviewer, ensureVisible, secureCookie, sessionTokenId, DUMMY_PASSWORD_HASH } from './security';
import { parseProjectQuery } from './project-query';
import { projectInclude as include, ProjectWithCounts, shapeProjects } from './project-shape';
import { ensureExpectedVersion, ensureModerationTransition, guardProjectWrite } from './project-state';
import { persistUpload, UploadCapacityInterceptor } from './uploads';
import { createSession, SESSION_LIFETIME_MS } from './sessions';
import { changeUserRole } from './roles';
import { parseProjectCollectionQuery } from './collection-query';
import { pageResult } from './query-params';
export const uploadDir=resolve(process.env.UPLOAD_DIR||'var/uploads');
@Controller()
export class ApiController {
 constructor(private db:Db,private auth:AuthService){}
 private async session(userId:string,res:Response) {
  const {token}=await createSession(this.db,userId);
  res.cookie('ph_session',token,{httpOnly:true,secure:secureCookie(),sameSite:'lax',path:'/api',maxAge:SESSION_LIFETIME_MS});
 }
 private async current(req:AuthRequest){await this.auth.resolve(req);return req.user;}
 private async project(id:string,req:AuthRequest){const p=await this.db.project.findUnique({where:{id},include});if(!p)throw new NotFoundException('Project not found');ensureVisible(p,await this.current(req));return p;}
 private async shape(project:ProjectWithCounts,userId?:string){return (await shapeProjects(this.db,[project],userId))[0];}
 @Get('health') health(){return {ok:true};}
 @Get('health/ready')
 @Header('Cache-Control','no-store')
 async readiness() {
  try {
   await this.db.$queryRaw`SELECT 1`;
   return {ok:true,database:'up'};
  } catch {
   throw new ServiceUnavailableException('Database is unavailable');
  }
 }
 @Post('auth/signup') async signup(@Body() body:SignupDto,@Res({passthrough:true}) res:Response){const email=body.email.trim().toLowerCase();try{const user=await this.db.user.create({data:{email,name:body.name,department:body.department,semester:body.semester,passwordHash:await hashPassword(body.password)},select:userSelect});await this.session(user.id,res);return user;}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError && e.code==='P2002')throw new ConflictException('An account with this email already exists');throw e;}}
 @Post('auth/login')
 async login(@Body() body:LoginDto,@Res({passthrough:true}) res:Response) {
  const user=await this.db.user.findUnique({where:{email:body.email.trim().toLowerCase()}});
  // Run the same password derivation for an unknown email to reduce the obvious
  // account-existence timing distinction. Error responses are identical too.
  const valid=await verifyPassword(body.password,user?.passwordHash??DUMMY_PASSWORD_HASH);
  if(!user||!valid) throw new UnauthorizedException('Invalid email or password');
  await this.session(user.id,res);
  const {passwordHash,...safe}=user;
  return safe;
 }
 @Post('auth/logout')
 async logout(@Req() req:AuthRequest,@Res({passthrough:true}) res:Response) {
  const id=sessionTokenId(req.cookies?.ph_session);
  if(id) await this.db.session.deleteMany({where:{id}});
  res.clearCookie('ph_session',{path:'/api',httpOnly:true,secure:secureCookie(),sameSite:'lax'});
  return {ok:true};
 }
 @Get('auth/me') @UseGuards(AuthGuard) me(@Req() req:AuthRequest){const {passwordHash,...safe}=req.user!;return safe;}
 @Patch('profile') @UseGuards(AuthGuard) profile(@Req() req:AuthRequest,@Body() body:ProfileDto){return this.db.user.update({where:{id:req.user!.id},data:body,select:userSelect});}
 @Get('projects')
 async list(@Query() query:Record<string,unknown>,@Req() req:AuthRequest) {
  const {page,limit,where,orderBy}=parseProjectQuery(query);
  const user=await this.current(req);
  const [items,total]=await Promise.all([
   this.db.project.findMany({where,include,skip:(page-1)*limit,take:limit,orderBy}),
   this.db.project.count({where}),
  ]);
  return {items:await shapeProjects(this.db,items,user?.id),total,page,limit,pages:Math.ceil(total/limit)};
 }
 private async projectPage(where:Prisma.ProjectWhereInput,orderBy:Prisma.ProjectOrderByWithRelationInput[],pagination:{page:number;limit:number;skip:number},userId:string) {
  return this.db.$transaction(async tx=>{
   const [items,total]=await Promise.all([
    tx.project.findMany({where,include,orderBy,skip:pagination.skip,take:pagination.limit}),
    tx.project.count({where}),
   ]);
   return pageResult(await shapeProjects(tx,items,userId),total,pagination);
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 @Get('my/projects') @UseGuards(AuthGuard)
 async mine(@Req() req:AuthRequest,@Query() query:Record<string,unknown>) {
  const pagination=parseProjectCollectionQuery(query,'workspace');
  const ownerId=req.user!.id;
  return this.db.$transaction(async tx=>{
   const [items,groups]=await Promise.all([
    tx.project.findMany({where:{ownerId,...(pagination.status?{status:pagination.status}:{})},include,orderBy:[{updatedAt:'desc'},{id:'desc'}],skip:pagination.skip,take:pagination.limit}),
    tx.project.groupBy({by:['status'],where:{ownerId},_count:{_all:true}}),
   ]);
   const byStatus:Record<ProjectStatus,number>={DRAFT:0,PENDING:0,APPROVED:0,CHANGES_REQUESTED:0,HIDDEN:0};
   for(const group of groups) byStatus[group.status]=group._count._all;
   const total=Object.values(byStatus).reduce((sum,count)=>sum+count,0);
   return {
    ...pageResult(await shapeProjects(tx,items,ownerId),pagination.status?byStatus[pagination.status]:total,pagination),
    summary:{total,published:byStatus.APPROVED,pending:byStatus.PENDING,byStatus},
   };
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 @Get('my/bookmarks') @UseGuards(AuthGuard)
 bookmarks(@Req() req:AuthRequest,@Query() query:Record<string,unknown>) {
  const pagination=parseProjectCollectionQuery(query,'bookmarks');
  return this.projectPage({status:'APPROVED',bookmarks:{some:{userId:req.user!.id}}},[{createdAt:'desc'},{id:'desc'}],pagination,req.user!.id);
 }
 @Get('projects/:id') async detail(@Param('id') id:string,@Req() req:AuthRequest){return this.shape(await this.project(id,req),req.user?.id);}
 private async validateScreenshots(body:ProjectDto,userId:string){for(const url of body.screenshots||[]){if(['/examples/campus-connect.png','/examples/ecotrack.png','/examples/study-space.png'].includes(url))continue;try{const filename=url.split('/').pop()!;const upload=await this.db.upload.findUnique({where:{filename}});if(!upload||upload.ownerId!==userId)throw Error();await stat(resolve(uploadDir,filename));}catch{throw new BadRequestException('Screenshot does not exist');}}for(const value of [body.githubUrl,body.demoUrl])if(value){try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{throw new BadRequestException('Links must be valid HTTP or HTTPS URLs');}}}
 @Post('projects') @UseGuards(AuthGuard) async create(@Body() body:ProjectDto,@Req() req:AuthRequest){await this.validateScreenshots(body,req.user!.id);return this.shape(await this.db.project.create({data:{...body,screenshots:body.screenshots||[],ownerId:req.user!.id},include}),req.user!.id);}
 @Patch('projects/:id') @UseGuards(AuthGuard)
 async update(@Param('id') id:string,@Body() body:UpdateProjectDto,@Req() req:AuthRequest) {
  const project=await this.project(id,req);
  ensureOwner(project,req.user!);
  const {expectedVersion,...changes}=body;
  ensureExpectedVersion(project,expectedVersion);
  await this.validateScreenshots(changes,req.user!.id);
  const updated=await guardProjectWrite(()=>this.db.project.update({
   where:{id,ownerId:req.user!.id,version:project.version,status:project.status},
   data:{...changes,status:'DRAFT',feedback:'',version:{increment:1}},include,
  }));
  return this.shape(updated,req.user!.id);
 }
 @Delete('projects/:id') @UseGuards(AuthGuard)
 async remove(@Param('id') id:string,@Req() req:AuthRequest,@Body() body:ProjectVersionDto) {
  const project=await this.project(id,req);
  ensureOwner(project,req.user!);
  ensureExpectedVersion(project,body.expectedVersion);
  await guardProjectWrite(()=>this.db.project.delete({where:{id,ownerId:req.user!.id,version:project.version,status:project.status}}));
  return {ok:true};
 }
 @Post('projects/:id/submit') @UseGuards(AuthGuard)
 async submit(@Param('id') id:string,@Req() req:AuthRequest,@Body() body:ProjectVersionDto) {
  const project=await this.project(id,req);
  ensureOwner(project,req.user!);
  ensureExpectedVersion(project,body.expectedVersion);
  if(!['DRAFT','CHANGES_REQUESTED'].includes(project.status)) throw new BadRequestException('Only drafts or changes-requested projects can be submitted');
  const updated=await guardProjectWrite(()=>this.db.project.update({
   where:{id,ownerId:req.user!.id,version:project.version,status:project.status},
   data:{status:'PENDING',feedback:'',version:{increment:1}},include,
  }));
  return this.shape(updated,req.user!.id);
 }
 @Post('projects/:id/view') async view(@Param('id') id:string,@Req() req:AuthRequest,@Res({passthrough:true}) res:Response){const p=await this.project(id,req);if(p.status!=='APPROVED')return {views:p.views};let visitor=req.cookies?.ph_visitor;if(typeof visitor!=='string'||!/^[a-f0-9]{64}$/.test(visitor)){visitor=randomBytes(32).toString('hex');res.cookie('ph_visitor',visitor,{httpOnly:true,sameSite:'lax',secure:secureCookie(),path:'/api',maxAge:365*86400000});}const key={projectId:id,visitor:digest(req.user?.id||visitor),day:new Date().toISOString().slice(0,10)};try{await this.db.$transaction([this.db.viewEvent.create({data:key}),this.db.project.update({where:{id},data:{views:{increment:1}}})]);}catch(e){if(!(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002'))throw e;}return {views:(await this.db.project.findUniqueOrThrow({where:{id}})).views};}
 private async toggle(id:string,req:AuthRequest,kind:'like'|'bookmark',on:boolean){const p=await this.project(id,req);if(p.status!=='APPROVED')throw new BadRequestException('Project must be approved');const key={userId:req.user!.id,projectId:id};if(kind==='like'){if(on)await this.db.like.upsert({where:{userId_projectId:key},create:key,update:{}});else await this.db.like.deleteMany({where:key});}else{if(on)await this.db.bookmark.upsert({where:{userId_projectId:key},create:key,update:{}});else await this.db.bookmark.deleteMany({where:key});}const shaped=await this.shape(await this.db.project.findUniqueOrThrow({where:{id},include}),req.user!.id);return {liked:shaped.liked,bookmarked:shaped.bookmarked,likes:shaped.likes};}
 @Put('projects/:id/like') @UseGuards(AuthGuard) like(@Param('id') id:string,@Req() req:AuthRequest){return this.toggle(id,req,'like',true);}
 @Delete('projects/:id/like') @UseGuards(AuthGuard) unlike(@Param('id') id:string,@Req() req:AuthRequest){return this.toggle(id,req,'like',false);}
 @Put('projects/:id/bookmark') @UseGuards(AuthGuard) bookmark(@Param('id') id:string,@Req() req:AuthRequest){return this.toggle(id,req,'bookmark',true);}
 @Delete('projects/:id/bookmark') @UseGuards(AuthGuard) unbookmark(@Param('id') id:string,@Req() req:AuthRequest){return this.toggle(id,req,'bookmark',false);}
 @Post('uploads') @UseGuards(AuthGuard)
 @UseInterceptors(UploadCapacityInterceptor,FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1,fieldNameSize:64}}))
 async upload(@UploadedFile() file:Express.Multer.File,@Req() req:AuthRequest) {
  if(!file) throw new BadRequestException('Choose an image');
  let buffer:Buffer;
  try { buffer=await normalizeUpload(file.buffer); }
  catch { throw new BadRequestException('Use a valid PNG, JPEG or WebP image'); }
  return persistUpload(this.db,uploadDir,req.user!.id,buffer);
 }
 @Get('uploads/:filename')
 async image(@Param('filename') filename:string,@Req() req:AuthRequest,@Res() res:Response) {
  if(!/^[a-f0-9-]+\.webp$/.test(filename)) throw new NotFoundException();
  const upload=await this.db.upload.findUnique({where:{filename}});
  if(!upload) throw new NotFoundException();
  const user=await this.current(req);
  const published=await this.db.project.findFirst({where:{status:'APPROVED',screenshots:{has:'/api/uploads/'+filename}},select:{id:true}});
  if(!published&&user?.id!==upload.ownerId&&!['FACULTY','ADMIN'].includes(user?.role||'')) throw new NotFoundException();
  res.setHeader('Cache-Control','private, no-store');
  try {
   await new Promise<void>((done,fail)=>res.sendFile(resolve(uploadDir,filename),error=>error?fail(error):done()));
  } catch(error) {
   if(res.headersSent) { res.destroy(); return; }
   if((error as NodeJS.ErrnoException).code==='ENOENT') throw new NotFoundException('Image not found');
   throw error;
  }
 }
 @Get('moderation/projects') @UseGuards(AuthGuard)
 queue(@Req() req:AuthRequest,@Query() query:Record<string,unknown>) {
  ensureReviewer(req.user!);
  const pagination=parseProjectCollectionQuery(query,'moderation');
  return this.projectPage({status:pagination.status},[{updatedAt:'asc'},{id:'asc'}],pagination,req.user!.id);
 }
 @Patch('moderation/projects/:id') @UseGuards(AuthGuard)
 async moderate(@Param('id') id:string,@Req() req:AuthRequest,@Body() body:ModerationDto) {
  ensureReviewer(req.user!);
  const current=await this.project(id,req);
  if(current.ownerId===req.user!.id) throw new ForbiddenException('You cannot review your own project');
  ensureExpectedVersion(current,body.expectedVersion);
  ensureModerationTransition(current.status,body.status,body.feedback);
  const [project]=await guardProjectWrite(()=>this.db.$transaction([
   this.db.project.update({
    where:{id,version:current.version,status:current.status},
    data:{status:body.status,feedback:body.feedback||'',version:{increment:1}},include,
   }),
   this.db.audit.create({data:{actorId:req.user!.id,action:'MODERATE_PROJECT',targetId:id,details:JSON.stringify(body)}}),
  ]));
  return this.shape(project,req.user!.id);
 }
 private admin(req:AuthRequest){if(req.user!.role!=='ADMIN')throw new ForbiddenException('Administrator access required');}
 @Get('admin/users') @UseGuards(AuthGuard) users(@Req() req:AuthRequest){this.admin(req);return this.db.user.findMany({select:userSelect,orderBy:{createdAt:'desc'},take:500});}
 @Patch('admin/users/:id/role') @UseGuards(AuthGuard)
 role(@Param('id') id:string,@Body() body:RoleDto,@Req() req:AuthRequest) {
  this.admin(req);
  return changeUserRole(this.db,req.user!.id,id,body.role);
 }
 @Get('admin/audit') @UseGuards(AuthGuard) audits(@Req() req:AuthRequest){this.admin(req);return this.db.audit.findMany({orderBy:{createdAt:'desc'},take:200});}
}
