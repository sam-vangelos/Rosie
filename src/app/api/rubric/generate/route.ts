import { NextResponse } from 'next/server';
import { makeRubricVersion } from '@/lib/cache';
import { ANTHROPIC_RUBRIC_MODEL, generateRubric } from '@/lib/anthropic';
import { getProvider, getRegisteredProviders } from '@/lib/providers';
import {
  assertProviderExecutable,
  ProviderNotExecutableError,
} from '@/lib/providers/config';
import type { ProviderName } from '@/lib/providers/types';
import { getRubricRecord, saveRubricRecord } from '@/lib/rubric-store';
import type { ScoringRubric } from '@/lib/types';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobDescription, intakeNotes, provider: requestedProvider } =
      (await request.json()) as {
        jobDescription?: string;
        intakeNotes?: string;
        provider?: unknown;
      };

    if (!jobDescription?.trim()) {
      return NextResponse.json({ error: 'jobDescription is required' }, { status: 400 });
    }

    const provider = requestedProvider ?? 'api';
    if (
      typeof provider !== 'string' ||
      !getRegisteredProviders().includes(provider as ProviderName)
    ) {
      return NextResponse.json(
        { error: 'Unknown or unregistered provider' },
        { status: 400 }
      );
    }
    const providerName = provider as ProviderName;
    assertProviderExecutable(providerName);
    const model =
      providerName === 'api'
        ? ANTHROPIC_RUBRIC_MODEL
        : getProvider(providerName).models.full;

    const rubricVersion = makeRubricVersion({
      jobDescription: jobDescription.trim(),
      intakeNotes: (intakeNotes || '').trim(),
      model,
      provider: providerName === 'api' ? undefined : providerName,
    });

    let rubric: ScoringRubric;
    const cached = await getRubricRecord(rubricVersion, null);
    if (cached) {
      rubric = cached.rubric;
    } else {
      rubric = await generateRubric(jobDescription, intakeNotes || '', {
        model,
        provider: providerName,
      });
      await saveRubricRecord({
        rubricVersion,
        calibrationVersion: null,
        rubric,
        idealPatterns: null,
      });
    }

    return NextResponse.json({ rubric, rubricVersion });
  } catch (error) {
    if (error instanceof ProviderNotExecutableError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Rubric generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate rubric' },
      { status: 500 }
    );
  }
}
