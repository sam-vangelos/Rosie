import type { JobAccess } from '@/lib/job-access';
import type { ViewerIdentity } from '@/lib/require-viewer';
import { displayNameFromEmail, pluralize } from '@/lib/viewer-format';

interface ViewerMastheadProps {
  viewer: ViewerIdentity;
  access: JobAccess;
}

export function ViewerMasthead({
  viewer,
  access,
}: ViewerMastheadProps) {
  const displayName = viewer.email
    ? displayNameFromEmail(viewer.email)
    : viewer.role === 'operator'
      ? 'Operator'
      : 'Viewer';
  const scope =
    access.kind === 'all'
      ? 'all requisitions'
      : `${access.jobIds.size} ${pluralize(
          access.jobIds.size,
          'requisition'
        )}`;

  return (
    <header className="viewer-masthead">
      <span className="text-v-row font-semibold tracking-[var(--v-track-label)] text-v-ink">
        ROSIE
      </span>
      <p className="min-w-0 break-words text-right text-v-meta text-v-ink-3">
        {displayName} · {scope}
      </p>
    </header>
  );
}
