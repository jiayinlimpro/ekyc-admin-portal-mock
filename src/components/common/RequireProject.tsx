import type { ReactNode } from 'react'
import { FolderKanban } from 'lucide-react'
import { useAccess } from '@/app/access'
import { canInProject, type ProjectAction } from '@/domain/access'
import type { MyProject } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'

/**
 * REQ: DEC-96 — settings pages always work on one selected project. Under "All my projects", ask which one (only the
 * projects where the user may do `action`); picking one sets the header's switcher.
 */
export function RequireProject({ action, title, children }: { action: ProjectAction; title: string; children: (project: MyProject) => ReactNode }) {
  const { selected, inView, account } = useAccess()
  const selectProject = useSession((s) => s.selectProject)
  if (selected) return <>{children(selected)}</>
  const options = account ? inView.filter((p) => canInProject(account, action, p)) : []
  return (
    <div className="mx-auto max-w-xl space-y-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">Settings work on one project. Choose it here or in the header.</p>
      </div>
      <ul aria-label="Choose a project" className="divide-y rounded-lg border bg-card">
        {options.map((p) => (
          <li key={p.projectId}>
            <button
              type="button"
              onClick={() => selectProject(p.projectId, p.merchantId)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1">{p.name}</span>
              {p.status === 'ARCHIVED' && <span className="text-xs text-muted-foreground">Archived</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
