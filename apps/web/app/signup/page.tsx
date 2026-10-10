import type {Metadata} from 'next';
import {AuthForm} from '@/components/auth-form';

export const metadata: Metadata = {title: 'Create an account · ProjectHub'};
export default function Signup() { return <AuthForm signup/>; }
