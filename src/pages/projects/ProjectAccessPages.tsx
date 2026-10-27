// REQ: DEC-77 / DEC-104 / DEC-109 — Members and Roles of the project in the header, in the project's sidebar
// (User Management). Members: who has access here and their project roles. Roles: this project's role table.
import type { ReactNode } from 'react'
import { useAccess } from '@/app/access'
import { ErrorState } from '@/components/common/States'
import type { Project } from '@/domain/types'
import { useLoad } from '@/hooks/useLoad'
import { projectService } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'
import { MembersTab } from './MembersTab'
import { ProjectRolesTab } from './ProjectRolesTab'

function ProjectPage({ title, intro, children }: { title: string; intro: string; children: (project: Project) => ReactNode }) {
  const actor = useSession((s) => s.actor)
  const { selected } = useAccess()
  const projectId = selected?.projectId ?? ''
  const project = useLoad(() => projectService.get(projectId, actor), [projectId, actor.userId])
  if (project.error && !project.data) return <ErrorState message={project.error} onRetry={project.reload} />
  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {selected?.name} · {intro}
        </p>
      </header>
      {project.data ? children(project.data) : <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy aria-label={`Loading ${title}`} />}
    </div>
  )
}

export function MembersPage() {
  return (
    <ProjectPage title="Members" intro="everyone with access to this project; project roles are given here and apply in this project only.">
      {(p) => <MembersTab key={p.projectId} project={p} />}
    </ProjectPage>
  )
}

export function ProjectRolesPage() {
  return (
    <ProjectPage title="Roles" intro="this project's roles, given in Members. Merchant roles are in Merchant settings.">
      {(p) => <ProjectRolesTab key={p.projectId} project={p} />}
    </ProjectPage>
  )
}
