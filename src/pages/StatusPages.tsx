import { Link, isRouteErrorResponse, useRouteError } from 'react-router'

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl space-y-2 py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-sm text-muted-foreground">{children}</div>
      <Link to="/" className="inline-block text-sm text-blue-700 underline-offset-2 hover:underline dark:text-blue-400">
        Back to Overview
      </Link>
    </div>
  )
}

export function NotFoundPage() {
  return <Message title="Page not found">This page doesn’t exist in the mock. The Manual Review Queue was removed; use Verifications instead.</Message>
}

export function ForbiddenPage({ page }: { page: string }) {
  return <Message title="No access">Your role can’t open {page}. Use Dev → Switch user to try another role.</Message>
}

export function RouteErrorPage() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error)
  return <Message title="Something went wrong">{detail}</Message>
}
