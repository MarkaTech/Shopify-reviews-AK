import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { storeId } = withAuth(request);
    const widgets = await db.widgetConfig.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ widgets });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to fetch widgets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const body = await request.json();
    const widget = await db.widgetConfig.create({
      data: {
        storeId,
        name: body.name,
        widgetType: body.widgetType,
        placement: body.placement || null,
        config: body.config ? JSON.stringify(body.config) : '{}',
        schemaName: body.schemaName || null,
        isActive: body.isActive !== undefined ? body.isActive : true,
      },
    });
    return NextResponse.json(widget, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to create widget' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const { id, ...data } = await request.json();
    if (!id) return NextResponse.json({ error: 'Widget ID required' }, { status: 400 });

    const widget = await db.widgetConfig.findFirst({ where: { id, storeId } });
    if (!widget) return NextResponse.json({ error: 'Widget not found' }, { status: 404 });

    const updated = await db.widgetConfig.update({
      where: { id },
      data: { ...data, config: data.config ? JSON.stringify(data.config) : undefined },
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to update widget' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Widget ID required' }, { status: 400 });

    const widget = await db.widgetConfig.findFirst({ where: { id, storeId } });
    if (!widget) return NextResponse.json({ error: 'Widget not found' }, { status: 404 });

    await db.widgetConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to delete widget' }, { status: 500 });
  }
}
