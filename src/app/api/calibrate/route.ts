import { NextResponse } from 'next/server';
import { extractPatterns, calibrateRubric } from '@/lib/anthropic';
import mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse');

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('resumes') as File[];
    const rubricJson = formData.get('rubric') as string | null;
    const jobDescription = formData.get('jobDescription') as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: 'No resume files provided' }, { status: 400 });
    }

    if (files.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 resumes allowed' }, { status: 400 });
    }

    // Read all file buffers first
    const fileEntries = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        nameLower: file.name.toLowerCase(),
        buffer: Buffer.from(await file.arrayBuffer()),
      }))
    );

    console.log(`[calibrate] Processing ${fileEntries.length} files: ${fileEntries.map(f => f.name).join(', ')}`);

    // Extract text from all files in parallel — no Claude calls, just local parsing
    const extractionPromises = fileEntries.map(async ({ name, nameLower, buffer }) => {
      let text = '';

      try {
        if (nameLower.endsWith('.pdf')) {
          const result = await pdfParse(buffer);
          text = result.text;
        } else if (nameLower.endsWith('.docx')) {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        } else if (nameLower.endsWith('.doc')) {
          try {
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
          } catch {
            text = '';
          }
        } else if (nameLower.endsWith('.txt')) {
          text = buffer.toString('utf-8');
        }
      } catch (err) {
        console.warn(`[calibrate] Failed to extract text from ${name}:`, err);
        text = '';
      }

      return { name, text };
    });

    const results = await Promise.all(extractionPromises);

    const resumeTexts: string[] = [];
    const processedFiles: string[] = [];

    for (const { name, text } of results) {
      if (text.trim().length > 0) {
        resumeTexts.push(text);
        processedFiles.push(name);
      }
    }

    console.log(`[calibrate] Extracted text from ${resumeTexts.length}/${fileEntries.length} files`);

    if (resumeTexts.length === 0) {
      return NextResponse.json(
        { error: 'Could not extract text from any uploaded files. Supported: PDF, DOCX, TXT' },
        { status: 400 }
      );
    }

    // Step 1: Extract patterns from ideal resumes
    const patterns = await extractPatterns(resumeTexts);
    console.log(`[calibrate] Patterns extracted. ${patterns.commonSkills.length} skills, ${patterns.careerPatterns.length} patterns`);

    // Step 2: If rubric was provided, calibrate it with the extracted patterns
    let calibratedRubric = null;
    if (rubricJson && jobDescription) {
      try {
        const rubric = JSON.parse(rubricJson);
        calibratedRubric = await calibrateRubric(rubric, patterns, jobDescription);
        console.log(`[calibrate] Rubric calibrated. Summary: ${calibratedRubric.calibrationSummary?.slice(0, 100)}...`);
      } catch (err) {
        console.error('[calibrate] Rubric calibration failed, returning uncalibrated:', err);
      }
    }

    return NextResponse.json({
      patterns,
      calibratedRubric,
      filesProcessed: processedFiles,
      totalFiles: files.length,
    });
  } catch (error) {
    console.error('Calibration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process resumes' },
      { status: 500 }
    );
  }
}
