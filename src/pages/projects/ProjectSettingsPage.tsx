import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useAccess } from '@/app/access'
import { FormField } from '@/components/common/FormField'
import { NativeSelect } from '@/components/common/NativeSelect'
import { OpenQuestionTag } from '@/components/common/OpenQuestionTag'
import { RequireProject } from '@/components/common/RequireProject'
import { ErrorState } from '@/components/common/States'
import { Tabs, tabPanelProps } from '@/components/common/Tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { canInProject } from '@/domain/access'
import { revisionLabel } from '@/domain/flowRules'
import { DEFAULT_CLAIM_WARNING_MIN } from '@/domain/openQuestions'
import { LANGUAGES, type Language } from '@/domain/projectSettings'
import type { Flow, Project } from '@/domain/types'
import { errorMessage, useLoad } from '@/hooks/useLoad'
import { flowService } from '@/services/flowService'
import { projectService, type MyProject } from '@/services/projectService'
import { useSession } from '@/stores/sessionStore'
import { IntegrationTab } from './IntegrationTab'
import { MembersTab } from './MembersTab'
import { Card } from './settingsUi'

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'integration', label: 'Integration' },
  { value: 'review', label: 'Review operations' },
  { value: 'routing', label: 'Routing' },
  { value: 'members', label: 'Members' },
] as const
type Tab = (typeof TABS)[number]['value']

const ReadOnlyNote = ({ children }: { children: React.ReactNode }) => <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{children}</p>

function GeneralTab({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [color, setColor] = useState(project.branding.primaryColor ?? '')
  const [logo, setLogo] = useState(project.branding.logoUrl ?? '')
  const [language, setLanguage] = useState<Language | ''>(project.language ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = async () => {
    setErrors({})
    try {
      await projectService.updateGeneral(project.projectId, { branding: { primaryColor: color, logoUrl: logo }, language: language || undefined }, actor)
      toast.success('General settings saved')
      onSaved()
    } catch (e) {
      const details = (e as { details?: { field: string; message: string }[] }).details
      if (Array.isArray(details)) setErrors(Object.fromEntries(details.map((x) => [x.field, x.message])))
      else toast.error(errorMessage(e))
    }
  }
  return (
    <Card title="General">
      <fieldset disabled={!canEdit} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <legend className="sr-only">General settings</legend>
        <FormField id="g-name" label="Project name" hint="Rename on the Projects screen (Platform Admin, Merchant Owner).">
          <Input id="g-name" value={project.name} readOnly />
        </FormField>
        <FormField id="g-language" label="Language" hint="Blank uses the merchant default.">
          <NativeSelect id="g-language" value={language} onChange={(e) => setLanguage(e.target.value as Language | '')}>
            <option value="">Merchant default</option>
            {Object.entries(LANGUAGES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="g-color" label="Branding colour" hint="Blank uses the merchant default." error={errors.primaryColor}>
          <div className="flex gap-2">
            <Input id="g-color" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#1D4ED8" aria-invalid={!!errors.primaryColor} />
            <span className="size-8 shrink-0 rounded-md border" style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : 'transparent' }} aria-hidden />
          </div>
        </FormField>
        <FormField id="g-logo" label="Logo URL" hint="HTTPS. Blank uses the merchant default." error={errors.logoUrl}>
          <Input id="g-logo" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://" aria-invalid={!!errors.logoUrl} />
        </FormField>
        <div className="sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Data retention</span>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            Not set <OpenQuestionTag id="OQ-21" />
          </p>
        </div>
      </fieldset>
      {canEdit ? (
        <Button className="mt-4" size="sm" onClick={() => void save()}>
          Save general settings
        </Button>
      ) : (
        <div className="mt-4">
          <ReadOnlyNote>Read-only for your role.</ReadOnlyNote>
        </div>
      )}
    </Card>
  )
}

// REQ: DEC-22 / DEC-53 — auto-release claim timeout per project.
function ReviewTab({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => void }) {
  const actor = useSession((s) => s.actor)
  const [value, setValue] = useState(String(project.claimTimeoutMin))
  const [error, setError] = useState<string>()
  const save = async () => {
    setError(undefined)
    try {
      await projectService.updateClaimTimeout(project.projectId, Number(value), actor)
      toast.success('Claim timeout saved', { description: 'Applies to claims made from now on.' })
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Card title="Review operations">
      <div className="max-w-sm space-y-3">
        <FormField id="r-timeout" label="Auto-release claim timeout (minutes)" error={error} hint={`Claims end by Release, this timeout, a decision, or removal from the project. Reviewers are warned ${DEFAULT_CLAIM_WARNING_MIN} min before expiry.`}>
          <Input id="r-timeout" type="number" min={1} step={1} value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
        </FormField>
        {canEdit ? (
          <Button size="sm" onClick={() => void save()}>
            Save
          </Button>
        ) : (
          <ReadOnlyNote>Read-only for your role.</ReadOnlyNote>
        )}
      </div>
    </Card>
  )
}

const routingText = (f: Flow, project: Project) => {
  if (f.routing.kind === 'RULE') return `Rule · priority ${f.routing.priority} · ${f.routing.summary}`
  if (f.routing.kind === 'SHARE') return `Share · ${f.routing.percent}% of new sessions`
  return project.defaultFlowId === f.flowId ? 'Default: every session no rule or share sends elsewhere' : '—'
}

// REQ: DEC-95 — routing is set by the merchant through the API; read-only here (OQ-18).
function RoutingTab({ project }: { project: Project }) {
  const actor = useSession((s) => s.actor)
  const flows = useLoad(() => flowService.list(project.projectId, actor), [project.projectId, actor.userId])
  if (flows.error) return <ErrorState message={flows.error} onRetry={flows.reload} />
  const rows = (flows.data ?? []).filter((f) => f.status !== 'DRAFT').sort((a, b) => Number(b.flowId === project.defaultFlowId) - Number(a.flowId === project.defaultFlowId))
  return (
    <Card title="Routing" aside={<OpenQuestionTag id="OQ-18" />}>
      <p className="mb-3 text-sm text-muted-foreground">Which flow a new session uses is set through the API. Set the default flow on the Flows screen.</p>
      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['Flow', 'Status', 'Rules applied', 'Routing'].map((h) => (
                <th key={h} scope="col" className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.flowId} className="border-t">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {f.name}
                  {project.defaultFlowId === f.flowId && <span className="ml-2 rounded bg-blue-100 px-1.5 text-[10px] font-medium text-blue-800 uppercase dark:bg-blue-500/20 dark:text-blue-200">Default</span>}
                </th>
                <td className="px-4 py-2">{f.status.charAt(0) + f.status.slice(1).toLowerCase()}</td>
                <td className="px-4 py-2 font-mono text-xs">{revisionLabel(f) ?? '—'}</td>
                <td className="px-4 py-2">{routingText(f, project)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Settings({ selected }: { selected: MyProject }) {
  const actor = useSession((s) => s.actor)
  const { account } = useAccess()
  const [sp, setSp] = useSearchParams()
  const tab = (TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'general') as Tab
  const project = useLoad(() => projectService.get(selected.projectId, actor), [selected.projectId, actor.userId])
  if (project.error && !project.data) return <ErrorState message={project.error} onRetry={project.reload} />
  const p = project.data
  const may = (a: Parameters<typeof canInProject>[1]) => !!account && canInProject(account, a, selected)

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Project Settings</h1>
        <p className="text-sm text-muted-foreground">
          {selected.name} · changes are audited with old and new values.
        </p>
      </header>
      <Tabs label="Project settings" tabs={TABS} value={tab} onChange={(t) => setSp(t === 'general' ? {} : { tab: t }, { replace: true })} />
      {!p ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy />
      ) : (
        <div {...tabPanelProps(tab)}>
          {tab === 'general' && <GeneralTab key={p.projectId} project={p} canEdit={may('manageProjectSettings')} onSaved={project.reload} />}
          {tab === 'integration' &&
            (may('manageIntegration') ? (
              <IntegrationTab project={p} />
            ) : (
              <ReadOnlyNote>API keys and webhooks carry the merchant’s secrets, so only the Merchant Owner and the project’s Project Admin manage them (DEC-75).</ReadOnlyNote>
            ))}
          {tab === 'review' && <ReviewTab key={p.projectId} project={p} canEdit={may('manageProjectSettings')} onSaved={project.reload} />}
          {tab === 'routing' && <RoutingTab project={p} />}
          {tab === 'members' && (may('manageMembers') ? <MembersTab project={p} /> : <ReadOnlyNote>Members are managed by users with the Manage project members permission (DEC-77).</ReadOnlyNote>)}
        </div>
      )}
    </div>
  )
}

// REQ: DEC-54 / DEC-77 / DEC-96 — one selected project; tabs General, Integration, Review operations, Routing, Members.
export function ProjectSettingsPage() {
  return <RequireProject action="manageFlows" title="Project Settings">{(p) => <Settings key={p.projectId} selected={p} />}</RequireProject>
}
