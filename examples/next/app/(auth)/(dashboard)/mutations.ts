import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";

// Optimistic todos get a placeholder id until the server assigns a real one.
// Buttons on a placeholder are disabled, since the server can't act on it.
export const isPlaceholder = (id: string) => id.startsWith("optimistic:");

// Mutations w/ optimistic updates
export const useCreateTodo = () =>
  useMutation(api.todos.create).withOptimisticUpdate((localStore, args) => {
    const todos = localStore.getQuery(api.todos.get);
    if (!todos) {
      return;
    }
    const user = localStore.getQuery(api.auth.getCurrentUser);
    if (!user) {
      return;
    }
    localStore.setQuery(api.todos.get, {}, [
      {
        _id: `optimistic:${crypto.randomUUID()}` as Id<"todos">,
        _creationTime: Date.now(),
        text: args.text,
        completed: false,
        userId: user._id,
      },
      ...todos,
    ]);
  });

export const useToggleCompleted = () =>
  useMutation(api.todos.toggle).withOptimisticUpdate((localStore, args) => {
    const todos = localStore.getQuery(api.todos.get);
    if (!todos) {
      return;
    }
    const index = todos.findIndex((todo) => todo._id === args.id);
    const todo = todos[index];
    if (!todo) {
      return;
    }
    localStore.setQuery(
      api.todos.get,
      {},
      todos.toSpliced(index, 1, {
        ...todo,
        completed: !todo.completed,
      }),
    );
  });

export const useRemoveTodo = () =>
  useMutation(api.todos.remove).withOptimisticUpdate((localStore, args) => {
    const todos = localStore.getQuery(api.todos.get);
    if (!todos) {
      return;
    }
    const index = todos.findIndex((todo) => todo._id === args.id);
    localStore.setQuery(api.todos.get, {}, todos.toSpliced(index, 1));
  });
