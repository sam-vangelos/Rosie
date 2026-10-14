import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  return NextResponse.json({
    ok: true,
    role: request.headers.get('x-rosie-auth-role') || 'operator',
    email: request.headers.get('x-rosie-auth-email') || null,
  });
}
