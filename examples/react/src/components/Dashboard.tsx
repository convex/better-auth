import { useQuery } from "convex/react";
import { TodoList } from "./TodoList";
import { Button } from "./ui/button";
import { LogOut, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";

export function Dashboard() {
  const user = useQuery(api.auth.getCurrentUser);

  if (!user) {
    return <div>Loading dashboard...</div>;
  }

  const handleDeleteAccount = async () => {
    if (
      window.confirm(
        "Are you sure you want to delete your account? This action cannot be undone."
      )
    ) {
      await authClient.deleteUser();
    }
  };

  return (
    <div className="min-h-screen w-full p-4 space-y-8">
      <header className="flex items-center justify-between max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center text-orange-600 dark:text-orange-200 font-medium">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-medium">{user.name}</h1>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={handleDeleteAccount}>
            <Trash2 size={16} className="mr-2" />
            Delete Account
          </Button>
          <Button variant="ghost" onClick={() => authClient.signOut()}>
            <LogOut size={16} className="mr-2" />
            Sign out
          </Button>
        </div>
      </header>

      <main>
        <TodoList />
      </main>
    </div>
  );
}
