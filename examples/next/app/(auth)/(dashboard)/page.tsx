import { api } from "@/convex/_generated/api";
import { TodoList } from "./todo-list";
import { Header } from "./header";
import { preloadAuthQuery } from "@/lib/auth-server";

const Page = async () => {
  // Preload queries for SSR
  const [preloadedUserQuery, preloadedTodosQuery] = await Promise.all([
    preloadAuthQuery(api.auth.getCurrentUser),
    preloadAuthQuery(api.todos.get),
  ]);

  return (
    <div className="min-h-screen w-full p-4 space-y-8">
      <Header preloadedUserQuery={preloadedUserQuery} />
      <TodoList preloadedTodosQuery={preloadedTodosQuery} />
    </div>
  );
};

export default Page;
