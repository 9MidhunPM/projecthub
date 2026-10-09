import { IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, MaxLength, Min, ArrayMaxSize, Matches } from 'class-validator';
export class LoginDto {
 @IsEmail() @MaxLength(254) email!: string;
 @IsString() @Length(10,128) password!: string;
}
export class SignupDto extends LoginDto {
 @IsString() @Length(2,80) name!: string;
 @IsString() @Length(2,80) department!: string;
 @IsInt() @Min(1) @Max(12) semester!: number;
}
export class ProfileDto {
 @IsOptional() @IsString() @Length(2,80) name?: string;
 @IsOptional() @IsString() @Length(2,80) department?: string;
 @IsOptional() @IsInt() @Min(1) @Max(12) semester?: number;
 @IsOptional() @IsString() @MaxLength(1000) bio?: string;
}
export class ProjectDto {
 @IsString() @Length(3,120) title!: string;
 @IsString() @Length(20,20000) description!: string;
 @IsString() @Length(2,80) department!: string;
 @IsInt() @Min(1) @Max(12) semester!: number;
 @IsString() @Length(2,60) type!: string;
 @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @Length(1,40,{each:true}) techStack!: string[];
 @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @Length(1,80,{each:true}) teamMembers!: string[];
 @IsOptional() @IsString() @MaxLength(2000) @Matches(/^(https?:\/\/\S+)?$/) githubUrl?: string;
 @IsOptional() @IsString() @MaxLength(2000) @Matches(/^(https?:\/\/\S+)?$/) demoUrl?: string;
 @IsOptional() @IsArray() @ArrayMaxSize(8) @Matches(/^(\/api\/uploads\/[a-f0-9-]+\.webp|\/examples\/(campus-connect|ecotrack|study-space)\.png)$/,{each:true}) screenshots?: string[];
}
export class ModerationDto {
 @IsIn(['APPROVED','CHANGES_REQUESTED','HIDDEN']) status!: 'APPROVED'|'CHANGES_REQUESTED'|'HIDDEN';
 @IsOptional() @IsString() @MaxLength(2000) feedback?: string;
}
export class RoleDto { @IsIn(['STUDENT','FACULTY','ADMIN']) role!: 'STUDENT'|'FACULTY'|'ADMIN'; }
