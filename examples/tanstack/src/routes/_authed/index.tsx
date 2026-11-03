import { TodoList } from '@/components/TodoList'
import { createFileRoute, Link } from '@tanstack/react-router'
import { UserProfile } from '@/components/UserProfile'
import { SignOutButton } from '@/components/client'
import { api } from '~/convex/_generated/api'
import { convexQuery } from '@convex-dev/react-query'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { useSuspenseQuery } from '@tanstack/react-query'

export const Route = createFileRoute('/_authed/')({
  component: App,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getCurrentUser, {}),
      ),
      context.queryClient.ensureQueryData(convexQuery(api.todos.get, {})),
    ])
  },
})

function App() {
  const user = useSuspenseQuery(convexQuery(api.auth.getCurrentUser, {}))
  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: async () => {
          // for now, recommend reloading on sign out as Convex client
          // expectAuth only works on initial load
          location.reload()
        },
      },
    })
  }

  return (
    <div className="min-h-screen w-full p-4 space-y-8">
      <header className="flex items-center justify-between max-w-2xl mx-auto">
        <UserProfile user={user.data} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings">
              <div className="flex items-center gap-2">
                <Settings size={16} />
                Settings
              </div>
            </Link>
          </Button>
          <SignOutButton onClick={handleSignOut} />
        </div>
      </header>
      <TodoList />
    </div>
  )
}
