import { NextResponse } from 'next/server';
import { listJobs, getJobPost } from '@/lib/greenhouse';

export async function GET() {
  try {
    const jobs = await listJobs('open');

    const formatted = jobs
      .filter((job) => !job.is_template) // Exclude templates
      .map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        department: (job.departments?.find((d) => d !== null) as { name: string } | undefined)?.name || 'No Department',
        office: (job.offices?.find((o) => o !== null) as { name: string } | undefined)?.name || 'No Office',
        openings: job.openings?.filter((o) => o.status === 'open').length || 0,
        opened_at: job.opened_at,
      }));

    // Sort by most recently opened
    formatted.sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());

    return NextResponse.json({ jobs: formatted });
  } catch (error) {
    console.error('Greenhouse jobs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// Get job description content for a specific job
export async function POST(request: Request) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const jobPost = await getJobPost(jobId);

    if (!jobPost) {
      return NextResponse.json({ error: 'No job post found for this job' }, { status: 404 });
    }

    // Use content, fall back to internal_content
    const rawContent = jobPost.content || jobPost.internal_content || '';

    if (!rawContent) {
      return NextResponse.json({ error: 'Job post has no content' }, { status: 404 });
    }

    // Strip HTML tags from content to get plain text
    const plainContent = rawContent
      .replace(/<[^>]*>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return NextResponse.json({
      title: jobPost.title,
      content: plainContent,
      location: jobPost.location?.name || null,
    });
  } catch (error) {
    console.error('Greenhouse job post error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch job post' },
      { status: 500 }
    );
  }
}
