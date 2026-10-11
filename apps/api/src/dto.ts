import { Transform } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsInt, IsString, Length, Max, MaxLength, Min, ArrayMaxSize, Matches, ValidateIf } from 'class-validator';

// Omitted optional fields are allowed; explicit nulls are invalid because the
// corresponding database columns are not nullable.
const OptionalField = () => ValidateIf((_object, value) => value !== undefined);
const Trimmed = () => Transform(({ value }) => typeof value === 'string' ? value.trim() : value);
const TrimmedItems = () => Transform(({ value }) => Array.isArray(value)
  ? value.map(item => typeof item === 'string' ? item.trim() : item)
  : value);
export class LoginDto {
 @Trimmed() @IsEmail() @MaxLength(254) email!: string;
 @IsString() @Length(10,128) password!: string;
}
export class SignupDto extends LoginDto {
 @Trimmed() @IsString() @Length(2,80) name!: string;
 @Trimmed() @IsString() @Length(2,80) department!: string;
 @IsInt() @Min(1) @Max(12) semester!: number;
}
export class ProfileDto {
 @OptionalField() @Trimmed() @IsString() @Length(2,80) name?: string;
 @OptionalField() @Trimmed() @IsString() @Length(2,80) department?: string;
 @OptionalField() @IsInt() @Min(1) @Max(12) semester?: number;
 @OptionalField() @Trimmed() @IsString() @MaxLength(1000) bio?: string;
}
export class ProjectDto {
 @Trimmed() @IsString() @Length(3,120) title!: string;
 @Trimmed() @IsString() @Length(20,20000) description!: string;
 @Trimmed() @IsString() @Length(2,80) department!: string;
 @IsInt() @Min(1) @Max(12) semester!: number;
 @Trimmed() @IsString() @Length(2,60) type!: string;
 @TrimmedItems() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @Length(1,40,{each:true}) techStack!: string[];
 @TrimmedItems() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @Length(1,80,{each:true}) teamMembers!: string[];
 @OptionalField() @Trimmed() @IsString() @MaxLength(2000) @Matches(/^(https?:\/\/\S+)?$/) githubUrl?: string;
 @OptionalField() @Trimmed() @IsString() @MaxLength(2000) @Matches(/^(https?:\/\/\S+)?$/) demoUrl?: string;
 @OptionalField() @IsArray() @ArrayMaxSize(8) @Matches(/^(\/api\/uploads\/[a-f0-9-]+\.webp|\/examples\/(campus-connect|ecotrack|study-space)\.png)$/,{each:true}) screenshots?: string[];
}
export class ProjectVersionDto {
 @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
}
export class UpdateProjectDto extends ProjectDto {
 @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
}
export class ModerationDto extends ProjectVersionDto {
 @IsIn(['APPROVED','CHANGES_REQUESTED','HIDDEN']) status!: 'APPROVED'|'CHANGES_REQUESTED'|'HIDDEN';
 @OptionalField() @Trimmed() @IsString() @MaxLength(2000) feedback?: string;
}
export class RoleDto { @IsIn(['STUDENT','FACULTY','ADMIN']) role!: 'STUDENT'|'FACULTY'|'ADMIN'; }
