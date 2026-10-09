import {ProjectDetail} from '@/components/project-detail';
export default async function Detail({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ProjectDetail id={id}/>}
