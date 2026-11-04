import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Id } from "convex/_generated/dataModel";

// Optimistic todos get a placeholder id until the server assigns a real one.
// Buttons on a placeholder are disabled, since the server can't act on it.
const isPlaceholder = (id: string) => id.startsWith("optimistic:");

// Mutations w/ optimistic updates
const useCreateTodo = () =>
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
      })
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

export function TodoList() {
  const todos = useQuery(api.todos.get);
  const create = useCreateTodo();
  const toggle = useToggleCompleted();
  const remove = useRemoveTodo();
  const [newTodo, setNewTodo] = useState("");

  if (!todos) {
    return <div className="text-neutral-400">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newTodo.trim()) return;
          create({ text: newTodo.trim() });
          setNewTodo("");
        }}
      >
        <Input
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          placeholder="Add a new todo..."
          className="bg-neutral-900 border-neutral-800 text-neutral-100 placeholder:text-neutral-500"
        />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>

      <ul className="space-y-3">
        {todos.map((todo) => (
          <li
            key={todo._id}
            className="flex items-center gap-3 p-3 bg-neutral-900/50 border border-neutral-800 rounded-lg group hover:bg-neutral-900 transition-colors"
          >
            <Button
              variant="ghost"
              size="icon"
              disabled={isPlaceholder(todo._id)}
              onClick={() => toggle({ id: todo._id })}
              className="text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
            >
              {todo.completed ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <X size={16} />
              )}
            </Button>
            <span
              className={
                todo.completed
                  ? "flex-1 line-through text-neutral-500"
                  : "flex-1 text-neutral-100"
              }
            >
              {todo.text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={isPlaceholder(todo._id)}
              onClick={() => remove({ id: todo._id })}
              className="text-neutral-500 hover:text-red-400 hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 size={16} />
            </Button>
          </li>
        ))}
      </ul>

      {todos.length === 0 && (
        <p className="text-center text-neutral-500 py-8">
          No todos yet. Add one above!
        </p>
      )}
    </div>
  );
}
