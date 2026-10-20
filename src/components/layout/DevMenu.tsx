// Dev-only controls for demos and UAT: scenarios page, switch user, time warp, simulated network, reset demo data.
import { useNavigate } from 'react-router'
import { FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useNow } from '@/hooks/useNow'
import { useUsers } from '@/hooks/useUsers'
import { formatMyt, formatOffset } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/labels'
import { devService } from '@/services/devService'
import { useDevFlags } from '@/stores/devFlagsStore'
import { useSession } from '@/stores/sessionStore'

const WARPS = [
  { label: '+1 min', ms: 60_000 },
  { label: '+5 min', ms: 5 * 60_000 },
  { label: '+15 min', ms: 15 * 60_000 },
  { label: '+30 min', ms: 30 * 60_000 },
  { label: '+1 hour', ms: 60 * 60_000 },
]

export function DevMenu() {
  const users = useUsers()
  const actor = useSession((s) => s.actor)
  const switchUser = useSession((s) => s.switchUser)
  const flags = useDevFlags()
  const now = useNow(15_000)
  const navigate = useNavigate()

  const onSwitch = (userId: string) => {
    const u = users.find((x) => x.userId === userId)
    if (!u) return
    switchUser(u)
    toast.success(`Signed in as ${u.fullName}`, { description: ROLE_LABELS[u.role] })
  }

  const onReset = async () => {
    if (!window.confirm('Reset all demo data? Claims, decisions, config drafts and audit entries made in this browser will be lost.')) return
    await devService.resetDemoData()
    window.location.reload() // simplest way to make every open page refetch
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="border-amber-400 text-amber-700 dark:border-amber-500/60 dark:text-amber-300" aria-label="Developer menu">
            <FlaskConical aria-hidden />
            Dev
            {flags.timeOffsetMs !== 0 && <span className="rounded bg-amber-100 px-1 text-[11px] dark:bg-amber-500/20">{formatOffset(flags.timeOffsetMs)}</span>}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mock only — not in the real portal</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => navigate('/uat')}>UAT scenarios & data coverage</DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Switch user <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{actor.fullName}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-96">
            <DropdownMenuRadioGroup value={actor.userId} onValueChange={(v) => onSwitch(String(v))}>
              {users.map((u) => (
                <DropdownMenuRadioItem key={u.userId} value={u.userId} closeOnClick disabled={!u.active}>
                  <div className="min-w-0">
                    <div className="truncate">{u.fullName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.userId} · {ROLE_LABELS[u.role]}
                      {u.merchantId ? ` · ${u.merchantId}` : ''}
                      {!u.active && ' · inactive'}
                    </div>
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Time warp <span className="ml-auto pl-2 text-xs text-muted-foreground">{formatOffset(flags.timeOffsetMs)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Mock clock: {formatMyt(now)} MYT</DropdownMenuLabel>
            </DropdownMenuGroup>
            {WARPS.map((w) => (
              <DropdownMenuItem key={w.label} onClick={() => flags.advanceTime(w.ms)}>
                Skip ahead {w.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={flags.timeOffsetMs === 0} onClick={flags.resetTime}>
              Back to real time
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={flags.simulateLatency} onCheckedChange={(v) => flags.setFlags({ simulateLatency: v })}>
          Simulate latency ({flags.latencyMs[0]}–{flags.latencyMs[1]} ms)
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={flags.simulateErrors} onCheckedChange={(v) => flags.setFlags({ simulateErrors: v })}>
          Simulate errors ({Math.round(flags.errorRate * 100)}% of calls)
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={!flags.uiClaimChecks} onCheckedChange={(v) => flags.setFlags({ uiClaimChecks: !v })}>
          Skip UI claim checks (test server-side check)
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onReset}>
          Reset demo data…
        </DropdownMenuItem>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Seeded {formatMyt(devService.seededAt())} MYT</DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
