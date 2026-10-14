import { NextResponse } from 'next/server';
import { getRegisteredProviders } from '@/lib/providers';
import { isProviderExecutable } from '@/lib/providers/config';

export async function GET() {
  return NextResponse.json({
    providers: getRegisteredProviders().filter(isProviderExecutable),
  });
}
